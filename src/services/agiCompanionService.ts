import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO, differenceInDays, addDays, isAfter, isBefore } from 'date-fns';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from '@tauri-apps/api';
import { pipeline } from '@xenova/transformers';
import { HfInference } from '@huggingface/inference';
import { Milvus } from 'milvus2-sdk-node';
import CryptoJS from 'crypto-js';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Octokit } from '@octokit/rest';
import { convert } from 'html-to-text';
import * as cheerio from 'cheerio';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import { parse as csvParse } from 'csv-parse/sync';

// Internal services
import getOpenAIService, { OpenAIServiceError, APIKeyError } from './openai';
import getKnowledgeBaseService, { 
  SearchResult, 
  DocumentMetadata,
  KnowledgeBaseError
} from './knowledgeBase';
import { getSettings, updateSettings } from './settings';

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
}

export interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'behavior' | 'entity';
  content: string;
  source: string;
  confidence: number;
  created: Date;
  lastAccessed?: Date;
  accessCount: number;
  tags?: string[];
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  description?: string;
  metadata?: Record<string, any>;
  firstSeen: Date;
  lastSeen: Date;
  frequency: number;
  importance: number;
}

export interface Task {
  id: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: Date;
  projectId?: string;
  tags?: string[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'completed' | 'archived';
  tags?: string[];
  created: Date;
  lastUpdated: Date;
  tasks?: Task[];
}

export interface MeetingPreparation {
  title: string;
  date: Date;
  participants: string[];
  agenda?: string[];
  relevantDocuments?: {
    id: string;
    title: string;
    type: string;
    relevance: number;
  }[];
  keyPoints?: string[];
  questions?: string[];
  background?: string;
}

export interface UserContext {
  preferences: Record<string, any>;
  recentTopics: { topic: string; frequency: number; lastMentioned: Date }[];
  entities: Entity[];
  projects: Project[];
  workingHours?: { start: string; end: string; days: number[] };
  interests?: string[];
  expertise?: string[];
  learningStyle?: string;
  communicationStyle?: string;
}

export interface AGICompanionOptions {
  dbPath?: string;
  openaiApiKey?: string;
  huggingfaceApiKey?: string;
  enableProactiveSuggestions?: boolean;
  enableWebResearch?: boolean;
  enableCodeAnalysis?: boolean;
  maxMemoryItems?: number;
  maxConversationHistory?: number;
}

/**
 * AGICompanion - Advanced AI assistant with memory, knowledge integration, and learning capabilities
 */
class AGICompanion {
  private db: Database.Database;
  private openai: OpenAI;
  private hf: HfInference | null = null;
  private userContext: UserContext;
  private options: AGICompanionOptions;
  private initialized: boolean = false;
  private embedPipeline: any = null;
  
  constructor(options: AGICompanionOptions = {}) {
    this.options = {
      dbPath: options.dbPath || './agi_companion.db',
      openaiApiKey: options.openaiApiKey,
      huggingfaceApiKey: options.huggingfaceApiKey,
      enableProactiveSuggestions: options.enableProactiveSuggestions !== false,
      enableWebResearch: options.enableWebResearch !== false,
      enableCodeAnalysis: options.enableCodeAnalysis !== false,
      maxMemoryItems: options.maxMemoryItems || 10000,
      maxConversationHistory: options.maxConversationHistory || 100
    };
    
    // Initialize empty user context
    this.userContext = {
      preferences: {},
      recentTopics: [],
      entities: [],
      projects: []
    };
    
    // Database will be initialized in init()
    this.db = new Database(':memory:');
    
    // OpenAI client will be initialized in init()
    this.openai = new OpenAI({
      apiKey: this.options.openaiApiKey || 'dummy-key'
    });
  }
  
  /**
   * Initialize the AGI Companion service
   */
  public async init(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Get app data directory for database storage
      const appDataDir = await app.appDataDir();
      const dbDir = path.join(appDataDir, 'db');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      // Initialize database
      const dbPath = path.join(dbDir, 'agi_companion.db');
      this.db = new Database(dbPath);
      
      // Initialize database schema
      this.initializeDatabase();
      
      // Initialize OpenAI client
      const settings = await getSettings();
      this.openai = getOpenAIService().getClient();
      
      // Initialize Hugging Face client if API key is available
      if (this.options.huggingfaceApiKey || settings.huggingfaceApiKey) {
        this.hf = new HfInference(this.options.huggingfaceApiKey || settings.huggingfaceApiKey);
      }
      
      // Load user context
      await this.loadUserContext();
      
      // Initialize embedding pipeline
      this.embedPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize AGI Companion:', error);
      throw new Error(`AGI Companion initialization failed: ${error.message}`);
    }
  }
  
  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    // Create conversations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        topic TEXT,
        context TEXT,
        project_id TEXT,
        tags TEXT,
        created TEXT NOT NULL,
        last_updated TEXT NOT NULL
      )
    `);
    
    // Create messages table
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
    
    // Create memory table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL,
        created TEXT NOT NULL,
        last_accessed TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        embedding TEXT,
        tags TEXT
      )
    `);
    
    // Create entities table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        metadata TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        frequency INTEGER NOT NULL DEFAULT 1,
        importance REAL NOT NULL DEFAULT 0.5
      )
    `);
    
    // Create tasks table
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
        last_updated TEXT NOT NULL
      )
    `);
    
    // Create projects table
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
    
    // Create recent_topics table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS recent_topics (
        topic TEXT PRIMARY KEY,
        frequency INTEGER NOT NULL DEFAULT 1,
        last_mentioned TEXT NOT NULL
      )
    `);
    
    // Create user_preferences table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    
    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    `);
  }
  
  /**
   * Load user context from database
   */
  private async loadUserContext(): Promise<void> {
    // Load preferences
    const prefsRows = this.db.prepare('SELECT key, value FROM user_preferences').all();
    this.userContext.preferences = {};
    for (const row of prefsRows) {
      try {
        this.userContext.preferences[row.key] = JSON.parse(row.value);
      } catch (e) {
        this.userContext.preferences[row.key] = row.value;
      }
    }
    
    // Load recent topics
    const topicsRows = this.db.prepare('SELECT topic, frequency, last_mentioned FROM recent_topics ORDER BY frequency DESC LIMIT 50').all();
    this.userContext.recentTopics = topicsRows.map(row => ({
      topic: row.topic,
      frequency: row.frequency,
      lastMentioned: parseISO(row.last_mentioned)
    }));
    
    // Load entities
    const entitiesRows = this.db.prepare('SELECT * FROM entities ORDER BY importance DESC, frequency DESC LIMIT 100').all();
    this.userContext.entities = entitiesRows.map(row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      firstSeen: parseISO(row.first_seen),
      lastSeen: parseISO(row.last_seen),
      frequency: row.frequency,
      importance: row.importance
    }));
    
    // Load projects with tasks
    const projectsRows = this.db.prepare('SELECT * FROM projects').all();
    this.userContext.projects = [];
    
    for (const projRow of projectsRows) {
      const project: Project = {
        id: projRow.id,
        name: projRow.name,
        description: projRow.description,
        status: projRow.status,
        tags: projRow.tags ? JSON.parse(projRow.tags) : [],
        created: parseISO(projRow.created),
        lastUpdated: parseISO(projRow.last_updated),
        tasks: []
      };
      
      // Load tasks for this project
      const tasksRows = this.db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(project.id);
      project.tasks = tasksRows.map(row => ({
        id: row.id,
        description: row.description,
        status: row.status,
        priority: row.priority,
        dueDate: row.due_date ? parseISO(row.due_date) : undefined,
        projectId: row.project_id,
        tags: row.tags ? JSON.parse(row.tags) : []
      }));
      
      this.userContext.projects.push(project);
    }
  }
  
  /* -------------------------------------------------------------------------
   * Conversation Management
   * -----------------------------------------------------------------------*/
  
  /**
   * Create a new conversation
   */
  public async createConversation(title: string = 'New Conversation'): Promise<Conversation> {
    const id = uuidv4();
    const now = new Date();
    const nowISO = now.toISOString();
    
    this.db.prepare(`
      INSERT INTO conversations (id, title, created, last_updated)
      VALUES (?, ?, ?, ?)
    `).run(id, title, nowISO, nowISO);
    
    return {
      id,
      title,
      messages: [],
      created: now,
      lastUpdated: now
    };
  }
  
  /**
   * Get a conversation by ID
   */
  public async getConversation(id: string): Promise<Conversation | null> {
    const conversation = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!conversation) return null;
    
    const messages = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp').all(id);
    
    return {
      id: conversation.id,
      title: conversation.title,
      summary: conversation.summary,
      topic: conversation.topic,
      context: conversation.context,
      projectId: conversation.project_id,
      tags: conversation.tags ? JSON.parse(conversation.tags) : [],
      created: parseISO(conversation.created),
      lastUpdated: parseISO(conversation.last_updated),
      messages: messages.map(msg => ({
        id: msg.id,
        role: msg.role as MessageRole,
        content: msg.content,
        timestamp: parseISO(msg.timestamp),
        metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
        functionCall: msg.function_call ? JSON.parse(msg.function_call) : undefined,
        functionName: msg.function_name
      }))
    };
  }
  
  /**
   * List all conversations
   */
  public async listConversations(): Promise<{ id: string; title: string; lastUpdated: Date; messageCount: number }[]> {
    const conversations = this.db.prepare(`
      SELECT c.id, c.title, c.last_updated, COUNT(m.id) as message_count
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      GROUP BY c.id
      ORDER BY c.last_updated DESC
      LIMIT ${this.options.maxConversationHistory}
    `).all();
    
    return conversations.map(c => ({
      id: c.id,
      title: c.title,
      lastUpdated: parseISO(c.last_updated),
      messageCount: c.message_count
    }));
  }
  
  /**
   * Update conversation metadata
   */
  public async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];
    
    if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
    if (updates.summary !== undefined) { fields.push('summary = ?'); params.push(updates.summary); }
    if (updates.topic !== undefined) { fields.push('topic = ?'); params.push(updates.topic); }
    if (updates.context !== undefined) { fields.push('context = ?'); params.push(updates.context); }
    if (updates.projectId !== undefined) { fields.push('project_id = ?'); params.push(updates.projectId); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    
    fields.push('last_updated = ?');
    params.push(new Date().toISOString());
    params.push(id);
    
    this.db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }
  
  /**
   * Delete a conversation
   */
  public async deleteConversation(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return result.changes > 0;
  }
  
  /**
   * Add a message to a conversation
   */
  public async addMessage(conversationId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const id = uuidv4();
    const now = new Date();
    const nowISO = now.toISOString();
    
    // Update conversation last_updated
    this.db.prepare('UPDATE conversations SET last_updated = ? WHERE id = ?').run(nowISO, conversationId);
    
    // Insert message
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, timestamp, metadata, function_call, function_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      conversationId,
      message.role,
      message.content,
      nowISO,
      message.metadata ? JSON.stringify(message.metadata) : null,
      message.functionCall ? JSON.stringify(message.functionCall) : null,
      message.functionName
    );
    
    // If it's a user message, analyze it for entities and topics
    if (message.role === 'user') {
      this.analyzeMessage(message.content);
    }
    
    return {
      id,
      ...message,
      timestamp: now
    };
  }
  
  /**
   * Generate a response to a conversation
   */
  public async generateResponse(
    conversationId: string, 
    options: { 
      systemPrompt?: string;
      functions?: FunctionDefinition[];
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<Message> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    
    // Get relevant context from memory and knowledge base
    const lastUserMessage = conversation.messages
      .filter(m => m.role === 'user')
      .pop();
      
    if (!lastUserMessage) {
      throw new Error('No user message found in conversation');
    }
    
    const relevantMemories = await this.getRelevantMemories(lastUserMessage.content);
    const knowledgeResults = await this.searchKnowledgeBase(lastUserMessage.content, 5);
    
    // Build system prompt
    let systemPrompt = options.systemPrompt || 
      `You are an advanced AI assistant with access to a knowledge base and memory system. 
      Today is ${format(new Date(), 'MMMM d, yyyy')}. 
      Be helpful, accurate, and friendly.`;
      
    // Add relevant context
    if (relevantMemories.length > 0) {
      systemPrompt += `\n\nRelevant information from memory:\n${relevantMemories.map(m => `- ${m.content}`).join('\n')}`;
    }
    
    if (knowledgeResults.length > 0) {
      systemPrompt += `\n\nRelevant information from knowledge base:\n${knowledgeResults.map(r => 
        `- ${r.title}: ${r.content.substring(0, 200)}...`
      ).join('\n')}`;
    }
    
    // Add user context
    if (this.userContext.interests && this.userContext.interests.length > 0) {
      systemPrompt += `\n\nUser interests: ${this.userContext.interests.join(', ')}`;
    }
    
    if (this.userContext.communicationStyle) {
      systemPrompt += `\n\nUser prefers communication style: ${this.userContext.communicationStyle}`;
    }
    
    // Prepare messages for API
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
        function_call: m.functionCall ? { name: m.functionCall.name, arguments: JSON.stringify(m.functionCall.arguments) } : undefined,
        name: m.functionName
      }))
    ];
    
    // Generate response
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 1000,
      functions: options.functions,
      function_call: options.functions?.length ? 'auto' : undefined
    });
    
    const assistantMessage = response.choices[0]?.message;
    
    if (!assistantMessage) {
      throw new Error('Failed to generate response');
    }
    
    // Create message object
    const message: Omit<Message, 'id' | 'timestamp'> = {
      role: 'assistant',
      content: assistantMessage.content || '',
    };
    
    // Handle function calls
    if (assistantMessage.function_call) {
      message.functionCall = {
        name: assistantMessage.function_call.name,
        arguments: JSON.parse(assistantMessage.function_call.arguments)
      };
      message.functionName = assistantMessage.function_call.name;
    }
    
    // Add message to conversation
    return this.addMessage(conversationId, message);
  }
  
  /**
   * Analyze a message for entities and topics
   */
  private async analyzeMessage(content: string): Promise<void> {
    try {
      // Use OpenAI to extract entities and topics
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Extract entities and topics from the following message. 
            Return a JSON object with the following structure:
            {
              "entities": [{"name": "string", "type": "string"}],
              "topics": ["string"]
            }
            Entity types can be: person, organization, location, product, technology, concept.
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
        for (const topic of result.topics) {
          // Check if topic exists
          const existingTopic = this.db.prepare('SELECT topic, frequency FROM recent_topics WHERE topic = ?').get(topic);
          
          if (existingTopic) {
            // Update frequency and last_mentioned
            this.db.prepare(`
              UPDATE recent_topics
              SET frequency = frequency + 1, last_mentioned = ?
              WHERE topic = ?
            `).run(new Date().toISOString(), topic);
          } else {
            // Insert new topic
            this.db.prepare(`
              INSERT INTO recent_topics (topic, frequency, last_mentioned)
              VALUES (?, ?, ?)
            `).run(topic, 1, new Date().toISOString());
          }
        }
      }
      
      // Update entities
      if (result.entities && Array.isArray(result.entities)) {
        const now = new Date().toISOString();
        
        for (const entity of result.entities) {
          if (!entity.name || !entity.type) continue;
          
          // Check if entity exists
          const existingEntity = this.db.prepare('SELECT id, frequency FROM entities WHERE name = ? AND type = ?').get(entity.name, entity.type);
          
          if (existingEntity) {
            // Update frequency and last_seen
            this.db.prepare(`
              UPDATE entities
              SET frequency = frequency + 1, last_seen = ?
              WHERE id = ?
            `).run(now, existingEntity.id);
          } else {
            // Insert new entity
            const entityId = uuidv4();
            this.db.prepare(`
              INSERT INTO entities (id, name, type, first_seen, last_seen, frequency)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(entityId, entity.name, entity.type, now, now, 1);
          }
        }
      }
    } catch (error) {
      console.error('Error analyzing message:', error);
    }
  }
  
  /* -------------------------------------------------------------------------
   * Memory System
   * -----------------------------------------------------------------------*/
  
  /**
   * Add a memory item
   */
  public async addMemory(memory: Omit<Memory, 'id' | 'created' | 'accessCount'>): Promise<Memory> {
    const id = uuidv4();
    const now = new Date();
    
    // Generate embedding if pipeline is available
    let embedding = null;
    if (this.embedPipeline) {
      try {
        const result = await this.embedPipeline(memory.content);
        const embedVector = result.data;
        embedding = JSON.stringify(embedVector);
      } catch (error) {
        console.error('Error generating embedding:', error);
      }
    }
    
    this.db.prepare(`
      INSERT INTO memory (id, type, content, source, confidence, created, access_count, embedding, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      memory.type,
      memory.content,
      memory.source,
      memory.confidence,
      now.toISOString(),
      0,
      embedding,
      memory.tags ? JSON.stringify(memory.tags) : null
    );
    
    return {
      id,
      type: memory.type,
      content: memory.content,
      source: memory.source,
      confidence: memory.confidence,
      created: now,
      accessCount: 0,
      tags: memory.tags
    };
  }
  
  /**
   * Get relevant memories for a query
   */
  public async getRelevantMemories(query: string, limit: number = 5): Promise<Memory[]> {
    if (!this.embedPipeline) {
      // Fallback to keyword search if embeddings not available
      return this.searchMemoriesByKeyword(query, limit);
    }
    
    try {
      // Generate embedding for query
      const result = await this.embedPipeline(query);
      const queryEmbedding = result.data;
      
      // Get all memories with embeddings
      const memories = this.db.prepare(`
        SELECT id, type, content, source, confidence, created, last_accessed, access_count, embedding, tags
        FROM memory
        WHERE embedding IS NOT NULL
      `).all();
      
      // Calculate similarity scores
      const scoredMemories = memories.map(memory => {
        const memoryEmbedding = JSON.parse(memory.embedding);
        const similarity = this.cosineSimilarity(queryEmbedding, memoryEmbedding);
        return { ...memory, similarity };
      });
      
      // Sort by similarity and take top results
      const topMemories = scoredMemories
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
      
      // Update access counts and timestamps
      const now = new Date().toISOString();
      for (const memory of topMemories) {
        this.db.prepare(`
          UPDATE memory
          SET access_count = access_count + 1, last_accessed = ?
          WHERE id = ?
        `).run(now, memory.id);
      }
      
      // Convert to Memory objects
      return topMemories.map(m => ({
        id: m.id,
        type: m.type,
        content: m.content,
        source: m.source,
        confidence: m.confidence,
        created: parseISO(m.created),
        lastAccessed: m.last_accessed ? parseISO(m.last_accessed) : undefined,
        accessCount: m.access_count + 1, // Include the current access
        tags: m.tags ? JSON.parse(m.tags) : undefined
      }));
    } catch (error) {
      console.error('Error getting relevant memories:', error);
      return this.searchMemoriesByKeyword(query, limit);
    }
  }
  
  /**
   * Search memories by keyword (fallback method)
   */
  private searchMemoriesByKeyword(query: string, limit: number): Memory[] {
    // Simple keyword search using LIKE
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);
    
    if (keywords.length === 0) {
      // Return most recently accessed memories if no keywords
      const rows = this.db.prepare(`
        SELECT * FROM memory
        ORDER BY last_accessed DESC NULLS LAST, confidence DESC
        LIMIT ?
      `).all(limit);
      
      return this.mapMemoryRows(rows);
    }
    
    // Build query with multiple LIKE conditions
    const conditions = keywords.map(() => 'LOWER(content) LIKE ?').join(' OR ');
    const params = keywords.map(k => `%${k}%`);
    params.push(limit);
    
    const rows = this.db.prepare(`
      SELECT * FROM memory
      WHERE ${conditions}
      ORDER BY confidence DESC
      LIMIT ?
    `).all(...params);
    
    // Update access counts
    const now = new Date().toISOString();
    for (const row of rows) {
      this.db.prepare(`
        UPDATE memory
        SET access_count = access_count + 1, last_accessed = ?
        WHERE id = ?
      `).run(now, row.id);
    }
    
    return this.mapMemoryRows(rows);
  }
  
  /**
   * Map database rows to Memory objects
   */
  private mapMemoryRows(rows: any[]): Memory[] {
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source: row.source,
      confidence: row.confidence,
      created: parseISO(row.created),
      lastAccessed: row.last_accessed ? parseISO(row.last_accessed) : undefined,
      accessCount: row.access_count + 1, // Include the current access
      tags: row.tags ? JSON.parse(row.tags) : undefined
    }));
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }
    
    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);
    
    if (mag1 === 0 || mag2 === 0) return 0;
    
    return dotProduct / (mag1 * mag2);
  }
  
  /* -------------------------------------------------------------------------
   * Knowledge Base Integration
   * -----------------------------------------------------------------------*/
  
  /**
   * Search the knowledge base
   */
  public async searchKnowledgeBase(query: string, limit: number = 5): Promise<SearchResult[]> {
    try {
      const knowledgeBase = getKnowledgeBaseService();
      return await knowledgeBase.search(query, limit);
    } catch (error) {
      console.error('Error searching knowledge base:', error);
      return [];
    }
  }
  
  /* -------------------------------------------------------------------------
   * Task Management
   * -----------------------------------------------------------------------*/
  
  /**
   * Convert database row to Task object
   */
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
  
  /**
   * Create a new task
   */
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
    
    // Update memory project list if loaded
    if (task.projectId) {
      const proj = this.userContext.projects.find(p => p.id === task.projectId);
      if (proj) {
        proj.tasks?.push({ ...task, id });
      }
    }
    
    return { ...task, id };
  }
  
  /**
   * Update a task
   */
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
    
    fields.push('last_updated = ?');
    params.push(new Date().toISOString());
    params.push(taskId);
    
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    
    return this.getTask(taskId);
  }
  
  /**
   * Get a task by ID
   */
  public async getTask(taskId: string): Promise<Task | null> {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
    return row ? this.taskRowToObject(row) : null;
  }
  
  /**
   * Delete a task
   */
  public async deleteTask(taskId: string): Promise<boolean> {
    const res = this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    
    // Also remove from memory
    for (const proj of this.userContext.projects) {
      if (proj.tasks) {
        proj.tasks = proj.tasks.filter(t => t.id !== taskId);
      }
    }
    
    return res.changes > 0;
  }
  
  /**
   * List tasks with optional filtering
   */
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
      // Simple LIKE match
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
   * Project Management
   * -----------------------------------------------------------------------*/
  
  /**
   * Convert database row to Project object
   */
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
  
  /**
   * Create a new project
   */
  public async createProject(project: Omit<Project, 'id' | 'created' | 'lastUpdated' | 'tasks'>): Promise<Project> {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO projects (id, name, description, status, tags, created, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      project.name,
      project.description || null,
      project.status,
      JSON.stringify(project.tags || []),
      now,
      now
    );
    
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
  
  /**
   * Update a project
   */
  public async updateProject(projectId: string, updates: Partial<Project>): Promise<Project | null> {
    const fields: string[] = [];
    const params: any[] = [];
    
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    
    fields.push('last_updated = ?');
    params.push(new Date().toISOString());
    params.push(projectId);
    
    this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    
    return this.getProject(projectId);
  }
  
  /**
   * Get a project by ID
   */
  public async getProject(projectId: string): Promise<Project | null> {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
    if (!row) return null;
    
    const proj = this.projectRowToObject(row);
    
    // Load tasks
    const tasksRows = this.db.prepare(`SELECT * FROM tasks WHERE project_id = ?`).all(projectId);
    proj.tasks = tasksRows.map(r => this.taskRowToObject(r));
    
    return proj;
  }
  
  /**
   * Delete a project
   */
  public async deleteProject(projectId: string): Promise<boolean> {
    const res = this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    this.userContext.projects = this.userContext.projects.filter(p => p.id !== projectId);
    return res.changes > 0;
  }
  
  /**
   * List all projects
   */
  public async listProjects(): Promise<Project[]> {
    const rows = this.db.prepare(`SELECT * FROM projects ORDER BY last_updated DESC`).all();
    return rows.map(r => this.projectRowToObject(r));
  }
  
  /* -------------------------------------------------------------------------
   * Meeting Preparation
   * -----------------------------------------------------------------------*/
  
  /**
   * Prepare for a meeting
   */
  public async prepareMeeting(options: {
    title: string;
    date: Date;
    participants: string[];
    agenda?: string[];
    context?: string;
  }): Promise<MeetingPreparation> {
    // Search knowledge base for relevant documents
    const searchQuery = `${options.title} ${options.participants.join(' ')} ${options.agenda?.join(' ') || ''} ${options.context || ''}`;
    const searchResults = await this.searchKnowledgeBase(searchQuery, 10);
    
    // Generate meeting preparation using OpenAI
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: `Prepare for a meeting with the following details:
          Title: ${options.title}
          Date: ${format(options.date, 'MMMM d, yyyy')}
          Participants: ${options.participants.join(', ')}
          ${options.agenda ? `Agenda: ${options.agenda.join(', ')}` : ''}
          ${options.context ? `Context: ${options.context}` : ''}
          
          Based on the above information and the following relevant documents, prepare:
          1. Key points to discuss
          2. Important questions to ask
          3. Background information that might be helpful
          
          Return your response as a JSON object with the following structure:
          {
            "keyPoints": ["point 1", "point 2", ...],
            "questions": ["question 1", "question 2", ...],
            "background": "background information"
          }
          
          Relevant documents:
          ${searchResults.map(r => `- ${r.title}: ${r.content.substring(0, 200)}...`).join('\n')}
          `
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
      });
      
      const result = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      return {
        title: options.title,
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
      };
  }
  
  /* -------------------------------------------------------------------------
   * Utility
   * -----------------------------------------------------------------------*/
  
  /**
   * Close the database connection
   */
  public close(): void {
    try {
      this.db.close();
    } catch (_) {
      /* ignore */
    }
  }
}

/* ---------------------------------------------------------------------------
 * Singleton export
 * -------------------------------------------------------------------------*/

const agiCompanion = new AGICompanion();
export default agiCompanion;
