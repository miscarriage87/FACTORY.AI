import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO, differenceInDays } from 'date-fns';
import getOpenAIService, { OpenAIServiceError, APIKeyError } from './openai';
import getKnowledgeBaseService, { 
  SearchResult, 
  DocumentMetadata,
  KnowledgeBaseError
} from './knowledgeBase';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { pipeline } from '@xenova/transformers';
import CryptoJS from 'crypto-js';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Octokit } from '@octokit/rest';

// Type definitions for AGI Companion
export type MessageRole = 'user' | 'assistant' | 'system' | 'function';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  functionCall?: FunctionCall;
  functionName?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created: Date;
  lastUpdated: Date;
  summary?: string;
  topic?: string;
  context?: string;
  projectId?: string;
  tags?: string[];
}

export interface FunctionCall {
  name: string;
  arguments: Record<string, any>;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>, context: ConversationContext) => Promise<any>;
}

export interface ConversationContext {
  conversation: Conversation;
  userContext: UserContext;
  systemContext: SystemContext;
  knowledgeContext?: KnowledgeContext;
}

export interface UserContext {
  preferences: Record<string, any>;
  expertise: Record<string, number>; // Domain -> confidence level (0-1)
  projects: Project[];
  patterns: UserPattern[];
  recentDocuments: DocumentReference[];
  recentTopics: string[];
}

export interface SystemContext {
  currentDate: Date;
  availableFunctions: string[];
  capabilities: string[];
  limitations: string[];
}

export interface KnowledgeContext {
  relevantDocuments: DocumentReference[];
  relatedConcepts: string[];
  projectContext?: string;
}

export interface DocumentReference {
  id: string;
  title: string;
  type: string;
  relevance: number;
  lastAccessed?: Date;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'completed' | 'planned';
  tasks?: Task[];
  tags?: string[];
  created: Date;
  lastUpdated: Date;
}

export interface Task {
  id: string;
  description: string;
  status: 'todo' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: Date;
  projectId?: string;
  tags?: string[];
}

export interface UserPattern {
  id: string;
  type: 'communication' | 'tool_usage' | 'workflow' | 'topic_interest';
  description: string;
  confidence: number;
  lastObserved: Date;
  examples: string[];
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  filters?: {
    documentTypes?: string[];
    dateRange?: { start?: Date; end?: Date };
    tags?: string[];
  };
  useSemanticSearch?: boolean;
}

export interface ResearchResult {
  query: string;
  sources: {
    title: string;
    url?: string;
    snippet: string;
    relevance: number;
  }[];
  summary: string;
  keyPoints: string[];
  timestamp: Date;
}

export interface CodeAnalysisResult {
  code: string;
  language: string;
  analysis: {
    summary: string;
    complexity: number;
    suggestions: {
      type: 'improvement' | 'bug' | 'performance' | 'security';
      description: string;
      lineNumbers?: number[];
      suggestedCode?: string;
      confidence: number;
    }[];
    bestPractices: string[];
  };
  timestamp: Date;
}

export interface MeetingPreparation {
  title: string;
  date: Date;
  participants: string[];
  agenda: string[];
  relevantDocuments: DocumentReference[];
  keyPoints: string[];
  questions: string[];
  background: string;
}

export interface DocumentGeneration {
  type: 'email' | 'report' | 'summary' | 'proposal' | 'documentation';
  title: string;
  content: string;
  metadata: {
    audience: string;
    purpose: string;
    tone: string;
    length: 'short' | 'medium' | 'long';
  };
  sources?: DocumentReference[];
}

// Error types
export class AGICompanionError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = 'AGICompanionError';
  }
}

export class MemoryError extends AGICompanionError {
  constructor(message: string, originalError?: any) {
    super(`Memory error: ${message}`, originalError);
    this.name = 'MemoryError';
  }
}

export class KnowledgeIntegrationError extends AGICompanionError {
  constructor(message: string, originalError?: any) {
    super(`Knowledge integration error: ${message}`, originalError);
    this.name = 'KnowledgeIntegrationError';
  }
}

export class FunctionExecutionError extends AGICompanionError {
  constructor(message: string, originalError?: any) {
    super(`Function execution error: ${message}`, originalError);
    this.name = 'FunctionExecutionError';
  }
}

// Main AGI Companion class
export class AGICompanion {
  private db: Database.Database;
  private embeddingModel: any;
  private openAIService: any;
  private knowledgeBaseService: any;
  private conversations: Map<string, Conversation> = new Map();
  private userContext: UserContext;
  private systemContext: SystemContext;
  private functions: Map<string, FunctionDefinition> = new Map();
  private dbPath: string;
  private initialized: boolean = false;
  private githubClient: Octokit | null = null;
  
  constructor(options: {
    dbPath?: string;
    openAIApiKey?: string;
    githubToken?: string;
  } = {}) {
    this.dbPath = options.dbPath || 'agi-companion.db';
    
    // Initialize database
    this.db = new Database(this.dbPath);
    
    // Initialize OpenAI service
    if (options.openAIApiKey) {
      this.openAIService = getOpenAIService(options.openAIApiKey);
    } else {
      this.openAIService = getOpenAIService();
    }
    
    // Initialize Knowledge Base service
    this.knowledgeBaseService = getKnowledgeBaseService();
    
    // Initialize GitHub client if token provided
    if (options.githubToken) {
      this.githubClient = new Octokit({
        auth: options.githubToken
      });
    }
    
    // Initialize default user context
    this.userContext = {
      preferences: {},
      expertise: {},
      projects: [],
      patterns: [],
      recentDocuments: [],
      recentTopics: []
    };
    
    // Initialize system context
    this.systemContext = {
      currentDate: new Date(),
      availableFunctions: [],
      capabilities: [
        'conversation', 'memory', 'knowledge_search', 
        'code_analysis', 'research', 'document_generation',
        'meeting_preparation', 'task_management'
      ],
      limitations: [
        'cannot_browse_internet_directly',
        'requires_explicit_knowledge_sources',
        'limited_to_knowledge_cutoff_date'
      ]
    };
    
    // Register built-in functions
    this.registerBuiltInFunctions();
  }
  
  // Initialize the AGI Companion
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Create database schema
      this.createSchema();
      
      // Load embedding model
      this.embeddingModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      
      // Load user context from database
      await this.loadUserContext();
      
      // Initialize knowledge base service
      await this.knowledgeBaseService.initialize();
      
      this.initialized = true;
    } catch (error) {
      throw new AGICompanionError('Failed to initialize AGI Companion', error);
    }
  }
  
  // Create database schema
  private createSchema(): void {
    try {
      // Conversations table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created TEXT NOT NULL,
          last_updated TEXT NOT NULL,
          summary TEXT,
          topic TEXT,
          context TEXT,
          project_id TEXT,
          tags TEXT
        )
      `);
      
      // Messages table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          metadata TEXT,
          function_call TEXT,
          function_name TEXT,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
      `);
      
      // User preferences table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          last_updated TEXT NOT NULL
        )
      `);
      
      // User expertise table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_expertise (
          domain TEXT PRIMARY KEY,
          confidence REAL NOT NULL,
          last_updated TEXT NOT NULL
        )
      `);
      
      // Projects table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          tags TEXT,
          created TEXT NOT NULL,
          last_updated TEXT NOT NULL
        )
      `);
      
      // Tasks table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          status TEXT NOT NULL,
          priority TEXT NOT NULL,
          due_date TEXT,
          project_id TEXT,
          tags TEXT,
          created TEXT NOT NULL,
          last_updated TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        )
      `);
      
      // User patterns table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_patterns (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          description TEXT NOT NULL,
          confidence REAL NOT NULL,
          last_observed TEXT NOT NULL,
          examples TEXT NOT NULL
        )
      `);
      
      // Recent documents table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS recent_documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          relevance REAL NOT NULL,
          last_accessed TEXT NOT NULL
        )
      `);
      
      // Recent topics table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS recent_topics (
          topic TEXT PRIMARY KEY,
          frequency INTEGER NOT NULL,
          last_mentioned TEXT NOT NULL
        )
      `);
      
      // Research cache table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS research_cache (
          query TEXT PRIMARY KEY,
          results TEXT NOT NULL,
          timestamp TEXT NOT NULL
        )
      `);
      
      // Create indexes for better performance
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
      `);
      
    } catch (error) {
      throw new AGICompanionError('Failed to create database schema', error);
    }
  }
  
  // Load user context from database
  private async loadUserContext(): Promise<void> {
    try {
      // Load preferences
      const preferences = this.db.prepare('SELECT key, value FROM user_preferences').all();
      for (const pref of preferences) {
        try {
          this.userContext.preferences[pref.key] = JSON.parse(pref.value);
        } catch (e) {
          this.userContext.preferences[pref.key] = pref.value;
        }
      }
      
      // Load expertise
      const expertise = this.db.prepare('SELECT domain, confidence FROM user_expertise').all();
      for (const exp of expertise) {
        this.userContext.expertise[exp.domain] = exp.confidence;
      }
      
      // Load projects
      const projects = this.db.prepare(`
        SELECT id, name, description, status, tags, created, last_updated
        FROM projects
      `).all();
      
      this.userContext.projects = projects.map(proj => ({
        id: proj.id,
        name: proj.name,
        description: proj.description,
        status: proj.status as 'active' | 'completed' | 'planned',
        tags: proj.tags ? JSON.parse(proj.tags) : [],
        created: parseISO(proj.created),
        lastUpdated: parseISO(proj.last_updated),
        tasks: []
      }));
      
      // Load tasks for each project
      for (const project of this.userContext.projects) {
        const tasks = this.db.prepare(`
          SELECT id, description, status, priority, due_date, tags
          FROM tasks
          WHERE project_id = ?
        `).all(project.id);
        
        project.tasks = tasks.map(task => ({
          id: task.id,
          description: task.description,
          status: task.status as 'todo' | 'in_progress' | 'completed',
          priority: task.priority as 'low' | 'medium' | 'high' | 'urgent',
          dueDate: task.due_date ? parseISO(task.due_date) : undefined,
          projectId: project.id,
          tags: task.tags ? JSON.parse(task.tags) : []
        }));
      }
      
      // Load user patterns
      const patterns = this.db.prepare(`
        SELECT id, type, description, confidence, last_observed, examples
        FROM user_patterns
      `).all();
      
      this.userContext.patterns = patterns.map(pattern => ({
        id: pattern.id,
        type: pattern.type as 'communication' | 'tool_usage' | 'workflow' | 'topic_interest',
        description: pattern.description,
        confidence: pattern.confidence,
        lastObserved: parseISO(pattern.last_observed),
        examples: JSON.parse(pattern.examples)
      }));
      
      // Load recent documents
      const recentDocs = this.db.prepare(`
        SELECT id, title, type, relevance, last_accessed
        FROM recent_documents
        ORDER BY last_accessed DESC
        LIMIT 10
      `).all();
      
      this.userContext.recentDocuments = recentDocs.map(doc => ({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        relevance: doc.relevance,
        lastAccessed: parseISO(doc.last_accessed)
      }));
      
      // Load recent topics
      const recentTopics = this.db.prepare(`
        SELECT topic
        FROM recent_topics
        ORDER BY frequency DESC, last_mentioned DESC
        LIMIT 10
      `).all();
      
      this.userContext.recentTopics = recentTopics.map(t => t.topic);
      
    } catch (error) {
      throw new MemoryError('Failed to load user context from database', error);
    }
  }
  
  // Register built-in functions
  private registerBuiltInFunctions(): void {
    // Search knowledge base
    this.registerFunction({
      name: 'search_knowledge_base',
      description: 'Search the knowledge base for relevant documents',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          max_results: {
            type: 'integer',
            description: 'Maximum number of results to return',
            default: 5
          },
          document_types: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Filter by document types (pdf, excel, csv, word, text, markdown)',
            default: []
          },
          use_semantic_search: {
            type: 'boolean',
            description: 'Whether to use semantic search or keyword search',
            default: true
          }
        },
        required: ['query']
      },
      handler: async (args, context) => {
        return await this.searchKnowledgeBase({
          query: args.query,
          maxResults: args.max_results,
          filters: {
            documentTypes: args.document_types
          },
          useSemanticSearch: args.use_semantic_search
        });
      }
    });
    
    // Perform web research
    this.registerFunction({
      name: 'perform_web_research',
      description: 'Research a topic on the web and summarize findings',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The research query'
          },
          max_sources: {
            type: 'integer',
            description: 'Maximum number of sources to consult',
            default: 3
          },
          depth: {
            type: 'string',
            enum: ['basic', 'detailed', 'comprehensive'],
            description: 'Depth of research',
            default: 'detailed'
          }
        },
        required: ['query']
      },
      handler: async (args, context) => {
        return await this.performWebResearch(args.query, args.max_sources, args.depth);
      }
    });
    
    // Analyze code
    this.registerFunction({
      name: 'analyze_code',
      description: 'Analyze code for improvements, bugs, and best practices',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The code to analyze'
          },
          language: {
            type: 'string',
            description: 'The programming language of the code'
          },
          analysis_type: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['performance', 'security', 'best_practices', 'bugs', 'all']
            },
            description: 'Types of analysis to perform',
            default: ['all']
          }
        },
        required: ['code', 'language']
      },
      handler: async (args, context) => {
        return await this.analyzeCode(args.code, args.language, args.analysis_type);
      }
    });
    
    // Generate document
    this.registerFunction({
      name: 'generate_document',
      description: 'Generate a document based on provided information',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['email', 'report', 'summary', 'proposal', 'documentation'],
            description: 'Type of document to generate'
          },
          title: {
            type: 'string',
            description: 'Title or subject of the document'
          },
          audience: {
            type: 'string',
            description: 'Target audience for the document'
          },
          purpose: {
            type: 'string',
            description: 'Purpose of the document'
          },
          tone: {
            type: 'string',
            enum: ['formal', 'informal', 'technical', 'friendly', 'persuasive'],
            description: 'Tone of the document',
            default: 'formal'
          },
          length: {
            type: 'string',
            enum: ['short', 'medium', 'long'],
            description: 'Length of the document',
            default: 'medium'
          },
          key_points: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Key points to include in the document'
          },
          source_documents: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'IDs of source documents to reference',
            default: []
          }
        },
        required: ['type', 'title', 'audience', 'purpose']
      },
      handler: async (args, context) => {
        const sourceDocuments: DocumentReference[] = [];
        
        // Fetch source documents if provided
        if (args.source_documents && args.source_documents.length > 0) {
          for (const docId of args.source_documents) {
            try {
              const doc = await this.knowledgeBaseService.getDocument(docId);
              if (doc) {
                sourceDocuments.push({
                  id: doc.id,
                  title: doc.title,
                  type: doc.type,
                  relevance: 1.0
                });
              }
            } catch (error) {
              console.error(`Failed to fetch source document ${docId}:`, error);
            }
          }
        }
        
        return await this.generateDocument({
          type: args.type as any,
          title: args.title,
          metadata: {
            audience: args.audience,
            purpose: args.purpose,
            tone: args.tone || 'formal',
            length: args.length || 'medium'
          },
          content: '',
          sources: sourceDocuments
        }, args.key_points);
      }
    });
    
    // Prepare for meeting
    this.registerFunction({
      name: 'prepare_for_meeting',
      description: 'Prepare for a meeting by gathering relevant information',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title of the meeting'
          },
          date: {
            type: 'string',
            description: 'Date and time of the meeting (ISO format)'
          },
          participants: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'List of meeting participants'
          },
          agenda: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Meeting agenda items',
            default: []
          },
          context: {
            type: 'string',
            description: 'Additional context for the meeting',
            default: ''
          }
        },
        required: ['title', 'participants']
      },
      handler: async (args, context) => {
        return await this.prepareForMeeting({
          title: args.title,
          date: args.date ? new Date(args.date) : new Date(),
          participants: args.participants,
          agenda: args.agenda || [],
          context: args.context
        });
      }
    });
    
    // Manage tasks
    this.registerFunction({
      name: 'manage_tasks',
      description: 'Create, update, or list tasks',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'list', 'get', 'delete'],
            description: 'Action to perform on tasks'
          },
          task_id: {
            type: 'string',
            description: 'ID of the task (for update, get, delete)'
          },
          description: {
            type: 'string',
            description: 'Description of the task (for create, update)'
          },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'completed'],
            description: 'Status of the task (for create, update)'
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'urgent'],
            description: 'Priority of the task (for create, update)',
            default: 'medium'
          },
          due_date: {
            type: 'string',
            description: 'Due date of the task (ISO format, for create, update)'
          },
          project_id: {
            type: 'string',
            description: 'ID of the project to associate with the task (for create, update)'
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Tags for the task (for create, update)',
            default: []
          },
          filter: {
            type: 'object',
            properties: {
              status: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['todo', 'in_progress', 'completed']
                }
              },
              priority: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['low', 'medium', 'high', 'urgent']
                }
              },
              project_id: {
                type: 'string'
              },
              due_before: {
                type: 'string'
              },
              due_after: {
                type: 'string'
              },
              tags: {
                type: 'array',
                items: {
                  type: 'string'
                }
              }
            },
            description: 'Filters for listing tasks'
          }
        },
        required: ['action']
      },
      handler: async (args, context) => {
        switch (args.action) {
          case 'create':
            if (!args.description) {
              throw new FunctionExecutionError('Task description is required for create action');
            }
            return await this.createTask({
              description: args.description,
              status: args.status as any || 'todo',
              priority: args.priority as any || 'medium',
              dueDate: args.due_date ? new Date(args.due_date) : undefined,
              projectId: args.project_id,
              tags: args.tags || []
            });
            
          case 'update':
            if (!args.task_id) {
              throw new FunctionExecutionError('Task ID is required for update action');
            }
            return await this.updateTask(args.task_id, {
              description: args.description,
              status: args.status as any,
              priority: args.priority as any,
              dueDate: args.due_date ? new Date(args.due_date) : undefined,
              projectId: args.project_id,
              tags: args.tags
            });
            
          case 'list':
            return await this.listTasks(args.filter);
            
          case 'get':
            if (!args.task_id) {
              throw new FunctionExecutionError('Task ID is required for get action');
            }
            return await this.getTask(args.task_id);
            
          case 'delete':
            if (!args.task_id) {
              throw new FunctionExecutionError('Task ID is required for delete action');
            }
            return await this.deleteTask(args.task_id);
            
          default:
            throw new FunctionExecutionError(`Unknown action: ${args.action}`);
        }
      }
    });
    
    // Manage projects
    this.registerFunction({
      name: 'manage_projects',
      description: 'Create, update, or list projects',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'list', 'get', 'delete'],
            description: 'Action to perform on projects'
          },
          project_id: {
            type: 'string',
            description: 'ID of the project (for update, get, delete)'
          },
          name: {
            type: 'string',
            description: 'Name of the project (for create, update)'
          },
          description: {
            type: 'string',
            description: 'Description of the project (for create, update)'
          },
          status: {
            type: 'string',
            enum: ['active', 'completed', 'planned'],
            description: 'Status of the project (for create, update)'
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Tags for the project (for create, update)',
            default: []
          }
        },
        required: ['action']
      },
      handler: async (args, context) => {
        switch (args.action) {
          case 'create':
            if (!args.name) {
              throw new FunctionExecutionError('Project name is required for create action');
            }
            return await this.createProject({
              name: args.name,
              description: args.description,
              status: args.status as any || 'active',
              tags: args.tags || []
            });
            
          case 'update':
            if (!args.project_id) {
              throw new FunctionExecutionError('Project ID is required for update action');
            }
            return await this.updateProject(args.project_id, {
              name: args.name,
              description: args.description,
              status: args.status as any,
              tags: args.tags
            });
            
          case 'list':
            return await this.listProjects();
            
          case 'get':
            if (!args.project_id) {
              throw new FunctionExecutionError('Project ID is required for get action');
            }
            return await this.getProject(args.project_id);
            
          case 'delete':
            if (!args.project_id) {
              throw new FunctionExecutionError('Project ID is required for delete action');
            }
            return await this.deleteProject(args.project_id);
            
          default:
            throw new FunctionExecutionError(`Unknown action: ${args.action}`);
        }
      }
    });
    
    // Update available functions in system context
    this.systemContext.availableFunctions = Array.from(this.functions.keys());
  }
  
  // Register a function
  public registerFunction(functionDef: FunctionDefinition): void {
    this.functions.set(functionDef.name, functionDef);
    
    // Update available functions in system context
    this.systemContext.availableFunctions = Array.from(this.functions.keys());
  }
  
  // Create a new conversation
  public async createConversation(title?: string): Promise<string> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const conversationId = uuidv4();
      const now = new Date();
      
      // Create default title if not provided
      const conversationTitle = title || `Conversation ${format(now, 'yyyy-MM-dd HH:mm')}`;
      
      // Create conversation in database
      this.db.prepare(`
        INSERT INTO conversations (
          id, title, created, last_updated, summary, topic, context, project_id, tags
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
      `).run(
        conversationId,
        conversationTitle,
        now.toISOString(),
        now.toISOString()
      );
      
      // Create conversation in memory
      const conversation: Conversation = {
        id: conversationId,
        title: conversationTitle,
        messages: [],
        created: now,
        lastUpdated: now
      };
      
      this.conversations.set(conversationId, conversation);
      
      // Add system message with context
      await this.addSystemMessageWithContext(conversationId);
      
      return conversationId;
    } catch (error) {
      throw new AGICompanionError('Failed to create conversation', error);
    }
  }
  
  // Add system message with context
  private async addSystemMessageWithContext(conversationId: string): Promise<void> {
    try {
      const conversation = await this.getConversation(conversationId);
      
      // Create system message with context
      const systemMessage: Message = {
        id: uuidv4(),
        role: 'system',
        content: this.generateSystemPrompt(),
        timestamp: new Date()
      };
      
      // Add to database
      this.db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, timestamp, metadata, function_call, function_name
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        systemMessage.id,
        conversationId,
        systemMessage.role,
        systemMessage.content,
        systemMessage.timestamp.toISOString()
      );
      
      // Add to memory
      conversation.messages.push(systemMessage);
      
    } catch (error) {
      throw new AGICompanionError(`Failed to add system message to conversation ${conversationId}`, error);
    }
  }
  
  // Generate system prompt based on context
  private generateSystemPrompt(): string {
    const expertiseAreas = Object.entries(this.userContext.expertise)
      .filter(([_, confidence]) => confidence > 0.6)
      .map(([domain, _]) => domain)
      .join(', ');
    
    const activeProjects = this.userContext.projects
      .filter(p => p.status === 'active')
      .map(p => p.name)
      .join(', ');
    
    const recentTopics = this.userContext.recentTopics.slice(0, 5).join(', ');
    
    return `You are an advanced AI companion designed to assist with a wide range of tasks.

Current date: ${format(this.systemContext.currentDate, 'yyyy-MM-dd')}

User expertise areas: ${expertiseAreas || 'Not enough data yet'}
Active projects: ${activeProjects || 'None'}
Recent topics of interest: ${recentTopics || 'Not enough data yet'}

Your capabilities include:
- Engaging in detailed conversations with context awareness
- Searching and retrieving information from the user's knowledge base
- Analyzing code and suggesting improvements
- Performing web research on specific topics
- Generating various types of documents
- Preparing for meetings with relevant information
- Managing tasks and projects

When appropriate, you can use functions to perform specific tasks. Always maintain a helpful, 
informative, and professional tone. Provide detailed and accurate responses based on available 
information and clearly indicate when you're unsure about something.`;
  }
  
  // Get a conversation by ID
  public async getConversation(conversationId: string): Promise<Conversation> {
    try {
      // Check if conversation is in memory
      if (this.conversations.has(conversationId)) {
        return this.conversations.get(conversationId)!;
      }
      
      // Get conversation from database
      const conversation = this.db.prepare(`
        SELECT id, title, created, last_updated, summary, topic, context, project_id, tags
        FROM conversations
        WHERE id = ?
      `).get(conversationId);
      
      if (!conversation) {
        throw new AGICompanionError(`Conversation ${conversationId} not found`);
      }
      
      // Get messages for conversation
      const messages = this.db.prepare(`
        SELECT id, role, content, timestamp, metadata, function_call, function_name
        FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp
      `).all(conversationId);
      
      // Create conversation object
      const conversationObj: Conversation = {
        id: conversation.id,
        title: conversation.title,
        messages: messages.map(msg => ({
          id: msg.id,
          role: msg.role as MessageRole,
          content: msg.content,
          timestamp: parseISO(msg.timestamp),
          metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
          functionCall: msg.function_call ? JSON.parse(msg.function_call) : undefined,
          functionName: msg.function_name
        })),
        created: parseISO(conversation.created),
        lastUpdated: parseISO(conversation.last_updated),
        summary: conversation.summary,
        topic: conversation.topic,
        context: conversation.context,
        projectId: conversation.project_id,
        tags: conversation.tags ? JSON.parse(conversation.tags) : undefined
      };
      
      // Store in memory
      this.conversations.set(conversationId, conversationObj);
      
      return conversationObj;
    } catch (error) {
      throw new AGICompanionError(`Failed to get conversation ${conversationId}`, error);
    }
  }
  
  // List conversations
  public async listConversations(options: {
    limit?: number;
    offset?: number;
    projectId?: string;
    startDate?: Date;
    endDate?: Date;
    searchTerm?: string;
  } = {}): Promise<{ conversations: Partial<Conversation>[]; total: number }> {
    try {
      const limit = options.limit || 10;
      const offset = options.offset || 0;
      
      // Build query conditions
      let conditions = [];
      const params: any[] = [];
      
      if (options.projectId) {
        conditions.push('project_id = ?');
        params.push(options.projectId);
      }
      
      if (options.startDate) {
        conditions.push('created >= ?');
        params.push(options.startDate.toISOString());
      }
      
      if (options.endDate) {
        conditions.push('created <= ?');
        params.push(options.endDate.toISOString());
      }
      
      if (options.searchTerm) {
        conditions.push('(title LIKE ? OR summary LIKE ? OR topic LIKE ?)');
        params.push(`%${options.searchTerm}%`, `%${options.searchTerm}%`, `%${options.searchTerm}%`);
      }
      
      // Build WHERE clause
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      // Get total count
      const totalResult = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM conversations
        ${whereClause}
      `).get(...params);
      
      // Get conversations
      const conversations = this.db.prepare(`
        SELECT id, title, created, last_updated, summary, topic, project_id, tags
        FROM conversations
        ${whereClause}
        ORDER BY last_updated DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);
      
      return {
        conversations: conversations.map(conv => ({
          id: conv.id,
          title: conv.title,
          created: parseISO(conv.created),
          lastUpdated: parseISO(conv.last_updated),
          summary: conv.summary,
          topic: conv.topic,
          projectId: conv.project_id,
          tags: conv.tags ? JSON.parse(conv.tags) : undefined
        })),
        total: totalResult.count
      };
    } catch (error) {
      throw new AGICompanionError('Failed to list conversations', error);
    }
  }
  
  // Delete a conversation
  public async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      // Delete from database
      const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
      
      // Delete from memory
      this.conversations.delete(conversationId);
      
      return result.changes > 0;
    } catch (error) {
      throw new AGICompanionError(`Failed to delete conversation ${conversationId}`, error);
    }
  }
  
  // Send a message to a conversation
  public async sendMessage(
    conversationId: string,
    content: string,
    role: 'user' | 'assistant' = 'user'
  ): Promise<Message> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const conversation = await this.getConversation(conversationId);
      
      // Create message
      const messageId = uuidv4();
      const timestamp = new Date();
      
      const message: Message = {
        id: messageId,
        role,
        content,
        timestamp
      };
      
      // Add to database
      this.db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, timestamp, metadata, function_call, function_name
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        messageId,
        conversationId,
        role,
        content,
        timestamp.toISOString()
      );
      
      // Add to memory
      conversation.messages.push(message);
      
      // Update conversation last_updated
      this.db.prepare(`
        UPDATE conversations
        SET last_updated = ?
        WHERE id = ?
      `).run(timestamp.toISOString(), conversationId);
      
      conversation.lastUpdated = timestamp;
      
      // If this is a user message, analyze and update context
      if (role === 'user') {
        await this.analyzeUserMessage(conversationId, message);
      }
      
      return message;
    } catch (error) {
      throw new AGICompanionError(`Failed to send message to conversation ${conversationId}`, error);
    }
  }
  
  // Generate a response to a conversation
  public async generateResponse(conversationId: string): Promise<Message> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const conversation = await this.getConversation(conversationId);
      
      // Prepare conversation context
      const context: ConversationContext = {
        conversation,
        userContext: this.userContext,
        systemContext: this.systemContext
      };
      
      // Add knowledge context if available
      if (conversation.messages.length > 0) {
        const lastUserMessage = [...conversation.messages]
          .reverse()
          .find(m => m.role === 'user');
          
        if (lastUserMessage) {
          context.knowledgeContext = await this.getKnowledgeContext(lastUserMessage.content);
        }
      }
      
      // Prepare messages for OpenAI
      const messages = this.prepareMessagesForOpenAI(conversation);
      
      // Prepare function definitions for OpenAI
      const functionDefinitions = this.prepareFunctionDefinitions();
      
      // Generate response from OpenAI
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        tools: functionDefinitions.length > 0 ? functionDefinitions : undefined,
        tool_choice: functionDefinitions.length > 0 ? 'auto' : undefined
      });
      
      const responseMessage = response.choices[0]?.message;
      
      if (!responseMessage) {
        throw new AGICompanionError('No response generated');
      }
      
      // Handle function calls
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        return await this.handleFunctionCalls(conversationId, responseMessage);
      }
      
      // Create message
      const messageId = uuidv4();
      const timestamp = new Date();
      
      const message: Message = {
        id: messageId,
        role: 'assistant',
        content: responseMessage.content || '',
        timestamp
      };
      
      // Add to database
      this.db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, timestamp, metadata, function_call, function_name
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        messageId,
        conversationId,
        'assistant',
        message.content,
        timestamp.toISOString()
      );
      
      // Add to memory
      conversation.messages.push(message);
      
      // Update conversation last_updated
      this.db.prepare(`
        UPDATE conversations
        SET last_updated = ?
        WHERE id = ?
      `).run(timestamp.toISOString(), conversationId);
      
      conversation.lastUpdated = timestamp;
      
      return message;
    } catch (error) {
      if (error instanceof OpenAIServiceError || error instanceof APIKeyError) {
        throw error;
      }
      throw new AGICompanionError(`Failed to generate response for conversation ${conversationId}`, error);
    }
  }
  
  // Prepare messages for OpenAI
  private prepareMessagesForOpenAI(conversation: Conversation): any[] {
    // Filter out function result messages that are internal
    const filteredMessages = conversation.messages.filter(msg => {
      // Keep all non-function messages
      if (msg.role !== 'function') return true;
      
      // Keep function messages that aren't marked as internal
      return !msg.metadata?.internal;
    });
    
    // Convert to OpenAI format
    return filteredMessages.map(msg => {
      const message: any = {
        role: msg.role,
        content: msg.content
      };
      
      // Add function call if present
      if (msg.functionCall) {
        message.function_call = {
          name: msg.functionCall.name,
          arguments: JSON.stringify(msg.functionCall.arguments)
        };
      }
      
      // Add function name if present (for function results)
      if (msg.role === 'function' && msg.functionName) {
        message.name = msg.functionName;
      }
      
      return message;
    });
  }
  
  // Prepare function definitions for OpenAI
  private prepareFunctionDefinitions(): any[] {
    return Array.from(this.functions.values()).map(func => ({
      type: 'function',
      function: {
        name: func.name,
        description: func.description,
        parameters: func.parameters
      }
    }));
  }
  
  // Handle function calls from OpenAI
  private async handleFunctionCalls(conversationId: string, responseMessage: any): Promise<Message> {
    try {
      const conversation = await this.getConversation(conversationId);
      
      // Prepare conversation context
      const context: ConversationContext = {
        conversation,
        userContext: this.userContext,
        systemContext: this.systemContext
      };
      
      // Process each function call
      for (const toolCall of responseMessage.tool_calls) {
        try {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          
          // Create function call message
          const functionCallMessage: Message = {
            id: uuidv4(),
            role: 'assistant',
            content: responseMessage.content || '',
            timestamp: new Date(),
            functionCall: {
              name: functionName,
              arguments: functionArgs
            }
          };
          
          // Add to database
          this.db.prepare(`
            INSERT INTO messages (
              id, conversation_id, role, content, timestamp, metadata, function_call, function_name
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            functionCallMessage.id,
            conversationId,
            'assistant',
            functionCallMessage.content,
            functionCallMessage.timestamp.toISOString(),
            JSON.stringify(functionCallMessage.functionCall),
            functionCallMessage.functionCall.name
          );
          
          // Add to memory
          conversation.messages.push(functionCallMessage);
          
          // Execute function
          const functionDef = this.functions.get(functionName);
          if (!functionDef) {
            throw new FunctionExecutionError(`Function ${functionName} not found`);
          }
          
          const result = await functionDef.handler(functionArgs, context);
          
          // Create function result message
          const functionResultMessage: Message = {
            id: uuidv4(),
            role: 'function',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            timestamp: new Date(),
            functionName,
            metadata: { internal: false } // Mark as visible to the model
          };
          
          // Add to database
          this.db.prepare(`
            INSERT INTO messages (
              id, conversation_id, role, content, timestamp, metadata, function_call, function_name
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
          `).run(
            functionResultMessage.id,
            conversationId,
            'function',
            functionResultMessage.content,
            functionResultMessage.timestamp.toISOString(),
            JSON.stringify(functionResultMessage.metadata),
            functionResultMessage.functionName
          );
          
          // Add to memory
          conversation.messages.push(functionResultMessage);
        } catch (error) {
          console.error(`Error executing function ${toolCall.function.name}:`, error);
          
          // Create error message
          const errorMessage: Message = {
            id: uuidv4(),
            role: 'function',
            content: JSON.stringify({ error: error.message || 'Unknown error' }),
            timestamp: new Date(),
            functionName: toolCall.function.name,
            metadata: { internal: false, error: true }
          };
          
          // Add to database
          this.db.prepare(`
            INSERT INTO messages (
              id, conversation_id, role, content, timestamp, metadata, function_call, function_name
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
          `).run(
            errorMessage.id,
            conversationId,
            'function',
            errorMessage.content,
            errorMessage.timestamp.toISOString(),
            JSON.stringify(errorMessage.metadata),
            errorMessage.functionName
          );
          
          // Add to memory
          conversation.messages.push(errorMessage);
        }
      }
      
      // Generate a follow-up response that incorporates the function results
      return await this.generateFollowUpResponse(conversationId);
    } catch (error) {
      throw new AGICompanionError(`Failed to handle function calls for conversation ${conversationId}`, error);
    }
  }
  
  // Generate a follow-up response after function calls
  private async generateFollowUpResponse(conversationId: string): Promise<Message> {
    try {
      const conversation = await this.getConversation(conversationId);
      
      // Prepare messages for OpenAI
      const messages = this.prepareMessagesForOpenAI(conversation);
      
      // Generate response from OpenAI
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.7,
        max_tokens: 1000
      });
      
      const responseMessage = response.choices[0]?.message;
      
      if (!responseMessage) {
        throw new AGICompanionError('No follow-up response generated');
      }
      
      // Create message
      const messageId = uuidv4();
      const timestamp = new Date();
      
      const message: Message = {
        id: messageId,
        role: 'assistant',
        content: responseMessage.content || '',
        timestamp
      };
      
      // Add to database
      this.db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, timestamp, metadata, function_call, function_name
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        messageId,
        conversationId,
        'assistant',
        message.content,
        timestamp.toISOString()
      );
      
      // Add to memory
      conversation.messages.push(message);
      
      // Update conversation last_updated
      this.db.prepare(`
        UPDATE conversations
        SET last_updated = ?
        WHERE id = ?
      `).run(timestamp.toISOString(), conversationId);
      
      conversation.lastUpdated = timestamp;
      
      return message;
    } catch (error) {
      throw new AGICompanionError(`Failed to generate follow-up response for conversation ${conversationId}`, error);
    }
  }
  
  // Analyze user message for context and learning
  private async analyzeUserMessage(conversationId: string, message: Message): Promise<void> {
    try {
      const conversation = await this.getConversation(conversationId);
      
      // Only analyze if we have enough context
      if (conversation.messages.length < 3) return;
      
      // Extract topics and entities
      await this.extractTopicsAndEntities(conversationId, message.content);
      
      // Update conversation summary and topic if needed
      await this.updateConversationMetadata(conversationId);
      
      // Identify user patterns
      await this.identifyUserPatterns(conversationId);
      
      // Update user expertise based on conversation
      await this.updateUserExpertise(message.content);
      
    } catch (error) {
      console.error(`Error analyzing user message:`, error);
      // Continue without analysis - we don't want to fail the whole operation
    }
  }
  
  // Extract topics and entities from message
  private async extractTopicsAndEntities(conversationId: string, content: string): Promise<void> {
    try {
      // Use OpenAI to extract topics and entities
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Extract the main topics and entities from the following message. 
            Return a JSON object with:
            - topics: array of main topics discussed
            - entities: array of key entities (people, organizations, technologies, concepts)
            Keep it focused and concise, max 5 topics and 10 entities.`
          },
          { role: 'user', content }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });
      
      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      // Update recent topics
      if (result.topics && Array.isArray(result.topics)) {
        date: options.date,
        participants: options.participants,
        agenda: options.agenda || [],
        relevantDocuments: searchResults.map(r => ({
          id: r.documentId,
          title: r.title,
          type: r.type,
          relevance: r.relevance
        })),
        keyPoints: result.keyPoints || [],
        questions: result.questions || [],
        background: result.background || ''
          // Check if topic exists
          const existingTopic = this.db.prepare('SELECT topic, frequency FROM recent_topics WHERE topic = ?').get(topic);
          
          if (existingTopic) {
            // Update frequency and last_mentioned

  /* -------------------------------------------------------------------------
   * Task management helpers
   * -----------------------------------------------------------------------*/

  private taskRowToObject(row: any): Task {
    return {
      id: row.id,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueDate: row.due_date ? parseISO(row.due_date) : undefined,
      projectId: row.project_id || undefined,
      tags: row.tags ? JSON.parse(row.tags) : []
    };
  }

  public async createTask(task: Omit<Task, 'id'>): Promise<Task> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tasks (
        id, description, status, priority, due_date, project_id, tags, created, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      task.description,
      task.status,
      task.priority,
      task.dueDate ? task.dueDate.toISOString() : null,
      task.projectId || null,
      JSON.stringify(task.tags || []),
      now,
      now
    );

    // update memory project list if loaded
    if (task.projectId) {
      const proj = this.userContext.projects.find(p => p.id === task.projectId);
      if (proj) {
        proj.tasks?.push({ ...task, id });
      }
    }
    return { ...task, id };
  }

  public async updateTask(taskId: string, updates: Partial<Task>): Promise<Task | null> {
    // Build SET clause dynamically
    const fields: string[] = [];
    const params: any[] = [];
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); params.push(updates.priority); }
    if (updates.dueDate !== undefined) { fields.push('due_date = ?'); params.push(updates.dueDate ? updates.dueDate.toISOString() : null); }
    if (updates.projectId !== undefined) { fields.push('project_id = ?'); params.push(updates.projectId); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    fields.push('last_updated = ?'); params.push(new Date().toISOString());
    params.push(taskId);

    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    return this.getTask(taskId);
  }

  public async getTask(taskId: string): Promise<Task | null> {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
    return row ? this.taskRowToObject(row) : null;
  }

  public async deleteTask(taskId: string): Promise<boolean> {
    const res = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    // also remove from memory
    for (const proj of this.userContext.projects) {
      if (proj.tasks) {
        proj.tasks = proj.tasks.filter(t => t.id !== taskId);
      }
    }
    return res.changes > 0;
  }

  public async listTasks(filter: any = {}): Promise<Task[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filter.status && filter.status.length) {
      conditions.push(`status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    if (filter.priority && filter.priority.length) {
      conditions.push(`priority IN (${filter.priority.map(() => '?').join(',')})`);
      params.push(...filter.priority);
    }
    if (filter.project_id) {
      conditions.push('project_id = ?');
      params.push(filter.project_id);
    }
    if (filter.tags && filter.tags.length) {
      // simple LIKE match
      for (const tag of filter.tags) {
        conditions.push(`tags LIKE ?`);
        params.push(`%${tag}%`);
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT * FROM tasks ${where} ORDER BY due_date ASC`).all(...params);
    return rows.map(r => this.taskRowToObject(r));
  }

  /* -------------------------------------------------------------------------
   * Project management helpers
   * -----------------------------------------------------------------------*/

  private projectRowToObject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      tags: row.tags ? JSON.parse(row.tags) : [],
      created: parseISO(row.created),
      lastUpdated: parseISO(row.last_updated),
      tasks: []
    };
  }

  public async createProject(project: Omit<Project, 'id' | 'created' | 'lastUpdated' | 'tasks'>): Promise<Project> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO projects (id, name, description, status, tags, created, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, project.name, project.description || null, project.status, JSON.stringify(project.tags || []), now, now);

    const projObj: Project = {
      ...project,
      id,
      created: parseISO(now),
      lastUpdated: parseISO(now),
      tasks: []
    };
    this.userContext.projects.push(projObj);
    return projObj;
  }

  public async updateProject(projectId: string, updates: Partial<Project>): Promise<Project | null> {
    const fields: string[] = [];
    const params: any[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    fields.push('last_updated = ?'); params.push(new Date().toISOString());
    params.push(projectId);
    this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.getProject(projectId);
  }

  public async getProject(projectId: string): Promise<Project | null> {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
    if (!row) return null;
    const proj = this.projectRowToObject(row);
    // load tasks
    const tasksRows = this.db.prepare(`SELECT * FROM tasks WHERE project_id = ?`).all(projectId);
    proj.tasks = tasksRows.map(r => this.taskRowToObject(r));
    return proj;
  }

  public async deleteProject(projectId: string): Promise<boolean> {
    const res = this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    this.userContext.projects = this.userContext.projects.filter(p => p.id !== projectId);
    return res.changes > 0;
  }

  public async listProjects(): Promise<Project[]> {
    const rows = this.db.prepare(`SELECT * FROM projects ORDER BY last_updated DESC`).all();
    return rows.map(r => this.projectRowToObject(r));
  }

  /* -------------------------------------------------------------------------
   * Utility
   * -----------------------------------------------------------------------*/

  public close(): void {
    try {
      this.db.close();
    } catch (_) {
      /* ignore */
    }
  }
            this.db.prepare(`

/* ---------------------------------------------------------------------------
 * Singleton export
 * -------------------------------------------------------------------------*/

const agiCompanion = new AGICompanion();
export default agiCompanion;
              UPDATE recent_topics
              SET frequency = frequency + 1, last_mentioned = ?
              WHERE topic = ?
            `).run(new Date().toISOString(), topic);
          } else {
            // Insert new topic
            this.db.prepare(`
              INSERT INTO recent_topics (topic, frequency, last_mentioned)
              VALUES (?, 1, ?)
            `).run(topic, new Date().toISOString());
          }
        }
        
        // Reload recent topics
        const recentTopics = this.db.prepare(`
          SELECT topic
          FROM recent_topics
          ORDER BY frequency DESC, last_mentioned DESC
          LIMIT 10
        `).all();
        
        this.userContext.recentTopics = recentTopics.map(t => t.topic);
      }
      
    } catch (error) {
      console.error('Error extracting topics and entities:', error);
    }
  }
  
  // Update conversation metadata (summary and topic)
  private async updateConversationMetadata(conversationId: string): Promise<void> {
    try {
      const conversation = await this.getConversation(conversationId);
      
      // Only update if we have enough messages and no summary yet
      if (conversation.messages.length < 5 || conversation.summary) return;
      
      // Get user messages
      const userMessages = conversation.messages
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join('\n\n');
      
      // Use OpenAI to generate summary and topic
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Analyze these messages and extract:
            1. A concise summary (1-2 sentences)
            2. The main topic or theme
            Return as JSON with "summary" and "topic" fields.`
          },
          { role: 'user', content: userMessages }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });
      
      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      // Update conversation
      if (result.summary || result.topic) {
        this.db.prepare(`
          UPDATE conversations
          SET summary = ?, topic = ?
          WHERE id = ?
        `).run(
          result.summary || null,
          result.topic || null,
          conversationId
        );
        
        conversation.summary = result.summary;
        conversation.topic = result.topic;
      }
      
    } catch (error) {
      console.error('Error updating conversation metadata:', error);
    }
  }
  
  // Identify user patterns
  private async identifyUserPatterns(conversationId: string): Promise<void> {
    try {
      // This would be a more complex analysis in a full implementation
      // For now, we'll focus on simple patterns
      
      const conversation = await this.getConversation(conversationId);
      
      // Get all user messages
      const userMessages = conversation.messages
        .filter(m => m.role === 'user')
        .map(m => m.content);
        
      if (userMessages.length < 3) return;
      
      // Check for code-related patterns
      const codePattern = /```[\s\S]*?```|\bfunction\b|\bclass\b|\bimport\b|\bconst\b|\blet\b|\bvar\b|\breturn\b/;
      const codeMessages = userMessages.filter(m => codePattern.test(m));
      
      if (codeMessages.length >= 2) {
        // Check if pattern already exists
        const existingPattern = this.db.prepare(`
          SELECT id FROM user_patterns
          WHERE type = 'topic_interest' AND description LIKE '%coding%'
        `).get();
        
        if (!existingPattern) {
          // Create new pattern
          const patternId = uuidv4();
          
          this.db.prepare(`
            INSERT INTO user_patterns (
              id, type, description, confidence, last_observed, examples
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            patternId,
            'topic_interest',
            'Interest in coding and development',
            0.7,
            new Date().toISOString(),
            JSON.stringify(codeMessages.slice(0, 2))
          );
          
          // Add to memory
          this.userContext.patterns.push({
            id: patternId,
            type: 'topic_interest',
            description: 'Interest in coding and development',
            confidence: 0.7,
            lastObserved: new Date(),
            examples: codeMessages.slice(0, 2)
          });
        }
      }
      
    } catch (error) {
      console.error('Error identifying user patterns:', error);
    }
  }
  
  // Update user expertise based on conversation
  private async updateUserExpertise(content: string): Promise<void> {
    try {
      // Use OpenAI to identify expertise areas
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Identify areas of expertise demonstrated in this message.
            Return a JSON object with domain names as keys and confidence levels (0.0-1.0) as values.
            Only include domains with confidence > 0.5. Limit to max 3 domains.`
          },
          { role: 'user', content }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });
      
      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      // Update expertise areas
      for (const [domain, confidence] of Object.entries(result)) {
        if (typeof confidence !== 'number' || confidence <= 0.5) continue;
        
        // Check if domain exists
        const existingDomain = this.db.prepare('SELECT domain, confidence FROM user_expertise WHERE domain = ?').get(domain);
        
        if (existingDomain) {
          // Update confidence (weighted average)
          const newConfidence = (existingDomain.confidence * 0.8) + (confidence as number * 0.2);
          
          this.db.prepare(`
            UPDATE user_expertise
            SET confidence = ?, last_updated = ?
            WHERE domain = ?
          `).run(newConfidence, new Date().toISOString(), domain);
          
          // Update in memory
          this.userContext.expertise[domain] = newConfidence;
        } else {
          // Insert new domain
          this.db.prepare(`
            INSERT INTO user_expertise (domain, confidence, last_updated)
            VALUES (?, ?, ?)
          `).run(domain, confidence, new Date().toISOString());
          
          // Add to memory
          this.userContext.expertise[domain] = confidence as number;
        }
      }
      
    } catch (error) {
      console.error('Error updating user expertise:', error);
    }
  }
  
  // Get knowledge context for a query
  private async getKnowledgeContext(query: string): Promise<KnowledgeContext> {
    try {
      // Search knowledge base for relevant documents
      const searchResults = await this.searchKnowledgeBase({
        query,
        maxResults: 3,
        useSemanticSearch: true
      });
      
      // Extract concepts from query
      const concepts = await this.extractConcepts(query);
      
      return {
        relevantDocuments: searchResults.map(result => ({
          id: result.documentId,
          title: result.title,
          type: result.type,
          relevance: result.relevance
        })),
        relatedConcepts: concepts
      };
    } catch (error) {
      console.error('Error getting knowledge context:', error);
      return {
        relevantDocuments: [],
        relatedConcepts: []
      };
    }
  }
  
  // Extract concepts from text
  private async extractConcepts(text: string): Promise<string[]> {
    try {
      // Use OpenAI to extract concepts
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Extract the key concepts and entities from the text. Return as a JSON array of strings.'
          },
          { role: 'user', content: text }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });
      
      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      if (Array.isArray(result.concepts)) {
        return result.concepts;
      } else if (Array.isArray(result)) {
        return result;
      }
      
      return [];
    } catch (error) {
      console.error('Error extracting concepts:', error);
      return [];
    }
  }
  
  // Search knowledge base
  public async searchKnowledgeBase(options: SearchOptions): Promise<SearchResult[]> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      return await this.knowledgeBaseService.searchDocuments(options.query, {
        limit: options.maxResults || 5,
        types: options.filters?.documentTypes,
        startDate: options.filters?.dateRange?.start,
        endDate: options.filters?.dateRange?.end,
        tags: options.filters?.tags,
        useSemanticSearch: options.useSemanticSearch
      });
    } catch (error) {
      throw new KnowledgeIntegrationError(`Failed to search knowledge base: ${error.message}`, error);
    }
  }
  
  // Perform web research
  public async performWebResearch(
    query: string,
    maxSources: number = 3,
    depth: 'basic' | 'detailed' | 'comprehensive' = 'detailed'
  ): Promise<ResearchResult> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Check cache first
      const cachedResult = this.db.prepare('SELECT results, timestamp FROM research_cache WHERE query = ?').get(query);
      
      if (cachedResult) {
        const cacheAge = differenceInDays(new Date(), parseISO(cachedResult.timestamp));
        
        // Use cache if less than 7 days old
        if (cacheAge < 7) {
          return JSON.parse(cachedResult.results);
        }
      }
      
      // Perform search using a search API (simplified here)
      const searchResults = await this.simulateWebSearch(query, maxSources);
      
      // Use OpenAI to synthesize results
      const synthesisPrompt = `
        Research query: ${query}
        
        Sources:
        ${searchResults.map((result, i) => 
          `[${i+1}] ${result.title}\n${result.snippet}\n`
        ).join('\n')}
        
        Based on these sources, provide:
        1. A comprehensive summary of the information
        2. 5-7 key points or findings
        
        Return as JSON with "summary" and "keyPoints" fields.
      `;
      
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a research assistant. Synthesize information from multiple sources.' },
          { role: 'user', content: synthesisPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });
      
      const synthesis = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      const result: ResearchResult = {
        query,
        sources: searchResults,
        summary: synthesis.summary || 'No summary available',
        keyPoints: synthesis.keyPoints || [],
        timestamp: new Date()
      };
      
      // Cache result
      this.db.prepare(`
        INSERT OR REPLACE INTO research_cache (query, results, timestamp)
        VALUES (?, ?, ?)
      `).run(
        query,
        JSON.stringify(result),
        new Date().toISOString()
      );
      
      return result;
    } catch (error) {
      throw new AGICompanionError(`Failed to perform web research: ${error.message}`, error);
    }
  }
  
  // Simulate web search (in a real implementation, this would use a search API)
  private async simulateWebSearch(query: string, maxResults: number): Promise<{ title: string; url?: string; snippet: string; relevance: number }[]> {
    // This is a simplified simulation of web search
    // In a real implementation, this would use a search API like Google, Bing, or DuckDuckGo
    
    // Generate fake search results based on the query
    const results = [];
    
    for (let i = 0; i < maxResults; i++) {
      results.push({
        title: `Research result ${i+1} for "${query}"`,
        url: `https://example.com/result${i+1}`,
        snippet: `This is a simulated search result for the query "${query}". In a real implementation, this would contain actual content from web pages relevant to the query.`,
        relevance: 1.0 - (i * 0.2)
      });
    }
    
    return results;
  }
  
  // Analyze code
  public async analyzeCode(
    code: string,
    language: string,
    analysisTypes: string[] = ['all']
  ): Promise<CodeAnalysisResult> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Determine which analysis types to perform
      const performAll = analysisTypes.includes('all');
      const performPerformance = performAll || analysisTypes.includes('performance');
      const performSecurity = performAll || analysisTypes.includes('security');
      const performBestPractices = performAll || analysisTypes.includes('best_practices');
      const performBugs = performAll || analysisTypes.includes('bugs');
      
      // Create analysis prompt
      let analysisPrompt = `Analyze the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
      
      analysisPrompt += 'Provide the following in your analysis:\n';
      analysisPrompt += '1. A brief summary of what the code does\n';
      analysisPrompt += '2. An estimate of code complexity (1-10 scale)\n';
      
      if (performBugs) {
        analysisPrompt += '3. Potential bugs or errors, including line numbers\n';
      }
      
      if (performPerformance) {
        analysisPrompt += '4. Performance issues and optimization suggestions\n';
      }
      
      if (performSecurity) {
        analysisPrompt += '5. Security concerns or vulnerabilities\n';
      }
      
      if (performBestPractices) {
        analysisPrompt += '6. Best practices suggestions\n';
      }
      
      analysisPrompt += '\nReturn your analysis as a JSON object with fields for "summary", "complexity", "suggestions" (array of objects with "type", "description", "lineNumbers", "suggestedCode", and "confidence"), and "bestPractices" (array of strings).';
      
      // Use OpenAI to analyze code
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: `You are a code analysis expert specializing in ${language}. Analyze code for issues, improvements, and best practices.` 
          },
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });
      
      const analysis = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      return {
        code,
        language,
        analysis: {
          summary: analysis.summary || 'No summary available',
          complexity: analysis.complexity || 5,
          suggestions: analysis.suggestions || [],
          bestPractices: analysis.bestPractices || []
        },
        timestamp: new Date()
      };
    } catch (error) {
      throw new AGICompanionError(`Failed to analyze code: ${error.message}`, error);
    }
  }
  
  // Generate document
  public async generateDocument(
    document: Partial<DocumentGeneration>,
    keyPoints?: string[]
  ): Promise<DocumentGeneration> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Gather source content if available
      let sourceContent = '';
      
      if (document.sources && document.sources.length > 0) {
        for (const source of document.sources) {
          try {
            const doc = await this.knowledgeBaseService.getDocument(source.id);
            if (doc) {
              const content = await this.knowledgeBaseService.getDocumentContent(source.id);
              sourceContent += `\n\nSource: ${doc.title}\n${content.substring(0, 1000)}...\n`;
            }
          } catch (error) {
            console.error(`Failed to fetch source document ${source.id}:`, error);
          }
        }
      }
      
      // Create generation prompt
      let prompt = `Generate a ${document.type} with the following details:\n\n`;
      prompt += `Title: ${document.title}\n`;
      prompt += `Audience: ${document.metadata?.audience}\n`;
      prompt += `Purpose: ${document.metadata?.purpose}\n`;
      prompt += `Tone: ${document.metadata?.tone}\n`;
      prompt += `Length: ${document.metadata?.length}\n`;
      
      if (keyPoints && keyPoints.length > 0) {
        prompt += `\nKey points to include:\n`;
        for (const point of keyPoints) {
          prompt += `- ${point}\n`;
        }
      }
      
      if (sourceContent) {
        prompt += `\nReference material:\n${sourceContent}\n`;
      }
      
      prompt += `\nGenerate the complete ${document.type} content.`;
      
      // Use OpenAI to generate document
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: `You are an expert writer specializing in ${document.type}s. Create high-quality, professional content.` 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      });
      
      return {
        type: document.type!,
        title: document.title!,
        content: response.choices[0]?.message?.content || 'Failed to generate content',
        metadata: document.metadata!,
        sources: document.sources
      };
    } catch (error) {
      throw new AGICompanionError(`Failed to generate document: ${error.message}`, error);
    }
  }
  
  // Prepare for meeting
  public async prepareForMeeting(options: {
    title: string;
    date: Date;
    participants: string[];
    agenda?: string[];
    context?: string;
  }): Promise<MeetingPreparation> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Search knowledge base for relevant documents
      const searchResults = await this.searchKnowledgeBase({
        query: `${options.title} ${options.participants.join(' ')} ${options.agenda?.join(' ') || ''} ${options.context || ''}`,
        maxResults: 3,
        useSemanticSearch: true
      });
      
      // Create preparation prompt
      let prompt = `Prepare for a meeting with the following details:\n\n`;
      prompt += `Title: ${options.title}\n`;
      prompt += `Date: ${format(options.date, 'yyyy-MM-dd HH:mm')}\n`;
      prompt += `Participants: ${options.participants.join(', ')}\n`;
      
      if (options.agenda && options.agenda.length > 0) {
        prompt += `\nAgenda:\n`;
        for (const item of options.agenda) {
          prompt += `- ${item}\n`;
        }
      }
      
      if (options.context) {
        prompt += `\nContext:\n${options.context}\n`;
      }
      
      if (searchResults.length > 0) {
        prompt += `\nRelevant documents:\n`;
        for (const result of searchResults) {
          prompt += `- ${result.title}: ${result.snippet}\n`;
        }
      }
      
      prompt += `\nBased on this information, provide:
      1. Key points to discuss
      2. Questions to ask
      3. Background information to prepare
      
      Return as JSON with "keyPoints", "questions", and "background" fields.`;
      
      // Use OpenAI to generate preparation
      const response = await this.openAIService.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: 'You are a meeting preparation assistant. Help prepare for upcoming meetings by providing key points, questions, and background information.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' }
      });
      
      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      return {
        title: options.title,
        date: options