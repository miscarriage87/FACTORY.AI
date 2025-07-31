import { useState, useEffect, useRef, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Badge } from './components/ui/badge';
import { Separator } from './components/ui/separator';
import { ScrollArea } from './components/ui/scroll-area';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Calendar } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { 
  MessageCircle, 
  Send, 
  FileText, 
  Settings, 
  RefreshCw, 
  Upload, 
  Key, 
  Save, 
  Sparkles,
  FileUp,
  User,
  Bot,
  AlertTriangle,
  Search,
  BookOpen,
  CheckSquare,
  FolderKanban,
  Brain,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Edit,
  MoreVertical,
  Tag,
  Clock,
  Filter,
  ChevronDown,
  Info,
  Lightbulb,
  HelpCircle,
  Star,
  Zap,
  Code,
  Bookmark,
  ArrowUpRight,
  FileQuestion,
  Video,
  Database,
  Layers,
  PenTool,
  Cpu,
  LayoutGrid
} from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import getOpenAIService, { 
  Message as OpenAIMessage, 
  APIKeyError, 
  RateLimitError, 
  OpenAIServiceError 
} from './services/openai';
import agiCompanion, {
  Message as AGIMessage,
  Conversation,
  Memory,
  Entity,
  Task,
  Project,
  MeetingPreparation,
  UserContext
} from './services/agiCompanionService';
import getKnowledgeBaseService, { 
  SearchResult, 
  DocumentMetadata,
  KnowledgeBaseError
} from './services/knowledgeBase';
import { getSettings, updateSettings } from './services/settings';

// Local message type definition (for UI)
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  functionCall?: {
    name: string;
    arguments: Record<string, any>;
  };
  functionName?: string;
};

// Summary type definition
type Summary = {
  original: string;
  summary: string;
  keyPoints: string[];
  timestamp: Date;
};

// Knowledge search result type
type KnowledgeResult = {
  id: string;
  title: string;
  content: string;
  type: string;
  relevance: number;
  timestamp: Date;
};

// Proactive suggestion type
type Suggestion = {
  id: string;
  type: 'task' | 'knowledge' | 'meeting' | 'code' | 'reminder';
  title: string;
  content: string;
  timestamp: Date;
  priority: 'low' | 'medium' | 'high';
  action?: () => void;
};

function AppEnhanced() {
  // Tab state
  const [activeTab, setActiveTab] = useState('chat');
  
  // Settings and API states
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isAGIInitialized, setIsAGIInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Chat states
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState('');
  
  // Meeting summarizer states
  const [meetingText, setMeetingText] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  
  // Knowledge base states
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeResult | null>(null);
  
  // Task management states
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskFilter, setTaskFilter] = useState<{
    status?: ('todo' | 'in_progress' | 'done' | 'cancelled')[];
    priority?: ('low' | 'medium' | 'high' | 'urgent')[];
    projectId?: string;
    tags?: string[];
  }>({});
  const [newTask, setNewTask] = useState<Omit<Task, 'id'>>({
    description: '',
    status: 'todo',
    priority: 'medium',
    tags: []
  });
  const [showNewTask, setShowNewTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  
  // Project management states
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [newProject, setNewProject] = useState<Omit<Project, 'id' | 'created' | 'lastUpdated' | 'tasks'>>({
    name: '',
    description: '',
    status: 'active',
    tags: []
  });
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  
  // Memory system states
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [isMemorySearching, setIsMemorySearching] = useState(false);
  const [memoryInsights, setMemoryInsights] = useState<{
    recentTopics: { topic: string; frequency: number }[];
    importantEntities: Entity[];
    userPreferences: Record<string, any>;
  }>({
    recentTopics: [],
    importantEntities: [],
    userPreferences: {}
  });
  
  // Meeting preparation states
  const [meetingPrep, setMeetingPrep] = useState<MeetingPreparation | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [newMeeting, setNewMeeting] = useState({
    title: '',
    date: new Date(),
    participants: '',
    agenda: '',
    context: ''
  });
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  
  // Proactive suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom of chat when messages change
  useEffect(() => {
    if (messagesEndRef.current && activeConversation?.messages) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation?.messages]);
  
  // Initialize AGI Companion and load data
  useEffect(() => {
    const initializeAGI = async () => {
      try {
        setIsInitializing(true);
        
        // Check for saved API key in localStorage
        const savedApiKey = localStorage.getItem('openai-api-key');
        if (savedApiKey) {
          setApiKey(savedApiKey);
          setIsApiKeySet(true);
          
          // Initialize OpenAI service with saved key
          try {
            const openAIService = getOpenAIService(savedApiKey);
            await openAIService.testApiKey();
            
            // Initialize AGI Companion
            await agiCompanion.init();
            setIsAGIInitialized(true);
            
            // Load conversations
            const conversationList = await agiCompanion.listConversations();
            if (conversationList.length > 0) {
              const conversations = await Promise.all(
                conversationList.map(c => agiCompanion.getConversation(c.id))
              );
              setConversations(conversations.filter(Boolean) as Conversation[]);
              
              // Set active conversation to the most recent one
              if (conversations[0]) {
                setActiveConversation(conversations[0]);
              }
            } else {
              // Create a new conversation if none exists
              const newConversation = await agiCompanion.createConversation('New Conversation');
              setConversations([newConversation]);
              setActiveConversation(newConversation);
            }
            
            // Load tasks
            const tasksList = await agiCompanion.listTasks();
            setTasks(tasksList);
            
            // Load projects
            const projectsList = await agiCompanion.listProjects();
            setProjects(projectsList);
            
            // Generate initial suggestions
            generateProactiveSuggestions();
          } catch (error) {
            console.warn('Failed to initialize with saved key:', error);
          }
        }
      } catch (error) {
        console.error('Failed to initialize AGI Companion:', error);
      } finally {
        setIsInitializing(false);
      }
    };
    
    initializeAGI();
  }, []);
  
  // Function to save API key
  const saveApiKey = async () => {
    if (!apiKey.trim()) {
      setApiKeyError('API key cannot be empty');
      return;
    }
    
    setApiKeyError(null);
    
    try {
      // Initialize and test the API key
      const openAIService = getOpenAIService(apiKey);
      await openAIService.testApiKey();
      
      // If we get here, the key is valid
      localStorage.setItem('openai-api-key', apiKey);
      setIsApiKeySet(true);
      setShowSettings(false);
      
      // Initialize AGI Companion if not already initialized
      if (!isAGIInitialized) {
        await agiCompanion.init();
        setIsAGIInitialized(true);
        
        // Create a new conversation
        const newConversation = await agiCompanion.createConversation('New Conversation');
        setConversations([newConversation]);
        setActiveConversation(newConversation);
      }
    } catch (error) {
      if (error instanceof APIKeyError) {
        setApiKeyError('Invalid API key. Please check and try again.');
      } else {
        setApiKeyError('Failed to validate API key. Please try again.');
        console.error('API key validation error:', error);
      }
    }
  };
  
  // Function to create a new conversation
  const createNewConversation = async () => {
    try {
      const title = newChatTitle.trim() || 'New Conversation';
      const newConversation = await agiCompanion.createConversation(title);
      
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversation(newConversation);
      setNewChatTitle('');
      setShowNewChat(false);
    } catch (error) {
      console.error('Failed to create new conversation:', error);
    }
  };
  
  // Function to handle sending a message
  const sendMessage = async () => {
    if (!inputMessage.trim() || !isApiKeySet || !activeConversation) return;
    
    try {
      setIsChatLoading(true);
      
      // Add user message to conversation
      const userMessage: Omit<AGIMessage, 'id' | 'timestamp'> = {
        role: 'user',
        content: inputMessage
      };
      
      const addedMessage = await agiCompanion.addMessage(activeConversation.id, userMessage);
      
      // Update active conversation with new message
      setActiveConversation(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, addedMessage],
          lastUpdated: new Date()
        };
      });
      
      // Clear input
      setInputMessage('');
      
      // Generate response
      const response = await agiCompanion.generateResponse(activeConversation.id, {
        systemPrompt: `You are an advanced AI assistant with access to a knowledge base and memory system.
        Today is ${format(new Date(), 'MMMM d, yyyy')}.
        Be helpful, accurate, and friendly. Use the context and memory provided to give personalized responses.`,
        temperature: 0.7
      });
      
      // Update active conversation with response
      setActiveConversation(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, response],
          lastUpdated: new Date()
        };
      });
      
      // Update conversations list
      setConversations(prev => {
        const updatedConversations = prev.map(c => 
          c.id === activeConversation.id 
            ? { ...c, lastUpdated: new Date() } 
            : c
        );
        return updatedConversations;
      });
      
      // Generate new suggestions based on the conversation
      generateProactiveSuggestions();
    } catch (error) {
      console.error('Failed to send message:', error);
      
      // Create appropriate error message based on error type
      let errorMessage = 'Sorry, I encountered an error processing your request. Please try again later.';
      
      if (error instanceof APIKeyError) {
        errorMessage = 'Your API key appears to be invalid. Please check your settings and update your API key.';
      } else if (error instanceof RateLimitError) {
        errorMessage = 'You\'ve reached the rate limit for API requests. Please wait a moment and try again.';
      }
      
      // Add error message to conversation
      const errorAssistantMessage: Omit<AGIMessage, 'id' | 'timestamp'> = {
        role: 'assistant',
        content: errorMessage
      };
      
      const addedErrorMessage = await agiCompanion.addMessage(activeConversation.id, errorAssistantMessage);
      
      // Update active conversation with error message
      setActiveConversation(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, addedErrorMessage],
          lastUpdated: new Date()
        };
      });
    } finally {
      setIsChatLoading(false);
    }
  };
  
  // Function to handle file upload for meeting summarizer
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setUploadedFileName(file.name);
    setSummaryError(null);
    
    // Read file contents
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setMeetingText(text);
    };
    reader.onerror = () => {
      setSummaryError('Failed to read the file. Please try again.');
    };
    reader.readAsText(file);
  };
  
  // Function to generate meeting summary
  const generateSummary = async () => {
    if (!meetingText.trim() || !isApiKeySet) return;
    
    setIsSummarizing(true);
    setSummaryError(null);
    
    try {
      // Get OpenAI service
      const openAIService = getOpenAIService();
      
      // Generate summary using OpenAI
      const result = await openAIService.summarizeMeeting(meetingText);
      
      setSummary(result);
      
      // Add to memory system
      if (isAGIInitialized) {
        await agiCompanion.addMemory({
          type: 'fact',
          content: `Meeting summary: ${result.summary}`,
          source: 'meeting-summarizer',
          confidence: 0.9,
          tags: ['meeting', 'summary']
        });
        
        // Add key points as separate memories
        for (const point of result.keyPoints) {
          await agiCompanion.addMemory({
            type: 'fact',
            content: point,
            source: 'meeting-summarizer',
            confidence: 0.85,
            tags: ['meeting', 'key-point']
          });
        }
      }
    } catch (error) {
      console.error('Failed to generate summary:', error);
      
      // Set appropriate error message
      if (error instanceof APIKeyError) {
        setSummaryError('Your API key appears to be invalid. Please check your settings and update your API key.');
      } else if (error instanceof RateLimitError) {
        setSummaryError('You\'ve reached the rate limit for API requests. Please wait a moment and try again.');
      } else {
        setSummaryError('Failed to generate summary. Please try again later.');
      }
    } finally {
      setIsSummarizing(false);
    }
  };
  
  // Function to search knowledge base
  const searchKnowledgeBase = async () => {
    if (!knowledgeQuery.trim() || !isAGIInitialized) return;
    
    setIsSearching(true);
    
    try {
      const results = await agiCompanion.searchKnowledgeBase(knowledgeQuery, 10);
      
      setKnowledgeResults(results.map(result => ({
        id: result.documentId,
        title: result.title,
        content: result.content,
        type: result.type,
        relevance: result.relevance,
        timestamp: new Date()
      })));
    } catch (error) {
      console.error('Failed to search knowledge base:', error);
    } finally {
      setIsSearching(false);
    }
  };
  
  // Function to create a new task
  const createTask = async () => {
    if (!newTask.description.trim() || !isAGIInitialized) return;
    
    try {
      const createdTask = await agiCompanion.createTask(newTask);
      setTasks(prev => [createdTask, ...prev]);
      setNewTask({
        description: '',
        status: 'todo',
        priority: 'medium',
        tags: []
      });
      setShowNewTask(false);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };
  
  // Function to update a task
  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    if (!isAGIInitialized) return;
    
    try {
      const updatedTask = await agiCompanion.updateTask(taskId, updates);
      if (updatedTask) {
        setTasks(prev => prev.map(task => task.id === taskId ? updatedTask : task));
      }
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };
  
  // Function to delete a task
  const deleteTask = async (taskId: string) => {
    if (!isAGIInitialized) return;
    
    try {
      const success = await agiCompanion.deleteTask(taskId);
      if (success) {
        setTasks(prev => prev.filter(task => task.id !== taskId));
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };
  
  // Function to create a new project
  const createProject = async () => {
    if (!newProject.name.trim() || !isAGIInitialized) return;
    
    try {
      const createdProject = await agiCompanion.createProject(newProject);
      setProjects(prev => [createdProject, ...prev]);
      setNewProject({
        name: '',
        description: '',
        status: 'active',
        tags: []
      });
      setShowNewProject(false);
      setActiveProject(createdProject);
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };
  
  // Function to update a project
  const updateProject = async (projectId: string, updates: Partial<Project>) => {
    if (!isAGIInitialized) return;
    
    try {
      const updatedProject = await agiCompanion.updateProject(projectId, updates);
      if (updatedProject) {
        setProjects(prev => prev.map(project => project.id === projectId ? updatedProject : project));
        
        if (activeProject?.id === projectId) {
          setActiveProject(updatedProject);
        }
      }
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };
  
  // Function to delete a project
  const deleteProject = async (projectId: string) => {
    if (!isAGIInitialized) return;
    
    try {
      const success = await agiCompanion.deleteProject(projectId);
      if (success) {
        setProjects(prev => prev.filter(project => project.id !== projectId));
        
        if (activeProject?.id === projectId) {
          setActiveProject(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };
  
  // Function to search memories
  const searchMemories = async () => {
    if (!memoryQuery.trim() || !isAGIInitialized) return;
    
    setIsMemorySearching(true);
    
    try {
      const results = await agiCompanion.getRelevantMemories(memoryQuery, 20);
      setMemories(results);
    } catch (error) {
      console.error('Failed to search memories:', error);
    } finally {
      setIsMemorySearching(false);
    }
  };
  
  // Function to prepare for a meeting
  const prepareMeeting = async () => {
    if (!newMeeting.title.trim() || !isAGIInitialized) return;
    
    setIsPreparing(true);
    
    try {
      const participants = newMeeting.participants.split(',').map(p => p.trim()).filter(Boolean);
      const agenda = newMeeting.agenda.split('\n').map(a => a.trim()).filter(Boolean);
      
      const preparation = await agiCompanion.prepareMeeting({
        title: newMeeting.title,
        date: newMeeting.date,
        participants,
        agenda,
        context: newMeeting.context
      });
      
      setMeetingPrep(preparation);
      setShowNewMeeting(false);
    } catch (error) {
      console.error('Failed to prepare for meeting:', error);
    } finally {
      setIsPreparing(false);
    }
  };
  
  // Function to generate proactive suggestions
  const generateProactiveSuggestions = async () => {
    if (!isAGIInitialized) return;
    
    try {
      // Get upcoming tasks
      const upcomingTasks = tasks.filter(task => 
        task.status === 'todo' && 
        task.priority === 'high' || 
        task.priority === 'urgent'
      ).slice(0, 3);
      
      // Create suggestions from tasks
      const taskSuggestions: Suggestion[] = upcomingTasks.map(task => ({
        id: `task-${task.id}`,
        type: 'task',
        title: 'Priority Task',
        content: task.description,
        timestamp: new Date(),
        priority: task.priority === 'urgent' ? 'high' : 'medium',
        action: () => setActiveTab('tasks')
      }));
      
      // Add project suggestions if there are active projects
      const projectSuggestions: Suggestion[] = projects
        .filter(project => project.status === 'active')
        .slice(0, 2)
        .map(project => ({
          id: `project-${project.id}`,
          type: 'reminder',
          title: 'Active Project',
          content: `Continue working on "${project.name}"`,
          timestamp: new Date(),
          priority: 'medium',
          action: () => {
            setActiveTab('projects');
            setActiveProject(project);
          }
        }));
      
      // Add knowledge suggestions based on recent topics
      const knowledgeSuggestions: Suggestion[] = [
        {
          id: `knowledge-1`,
          type: 'knowledge',
          title: 'Knowledge Exploration',
          content: 'Explore your knowledge base to find relevant information for your current projects',
          timestamp: new Date(),
          priority: 'low',
          action: () => setActiveTab('knowledge')
        }
      ];
      
      // Add code suggestion if there are code-related projects
      const codeSuggestions: Suggestion[] = projects
        .filter(project => project.tags?.includes('code') || project.tags?.includes('development'))
        .slice(0, 1)
        .map(project => ({
          id: `code-${project.id}`,
          type: 'code',
          title: 'Code Analysis',
          content: `Analyze code for "${project.name}" project`,
          timestamp: new Date(),
          priority: 'medium',
          action: () => {
            setActiveTab('projects');
            setActiveProject(project);
          }
        }));
      
      // Combine all suggestions and limit to 5
      const allSuggestions = [
        ...taskSuggestions,
        ...projectSuggestions,
        ...knowledgeSuggestions,
        ...codeSuggestions
      ].slice(0, 5);
      
      setSuggestions(allSuggestions);
    } catch (error) {
      console.error('Failed to generate suggestions:', error);
    }
  };
  
  // Function to format date for display
  const formatDate = (date: Date | string | undefined): string => {
    if (!date) return 'N/A';
    
    try {
      const dateObj = typeof date === 'string' ? parseISO(date) : date;
      return isValid(dateObj) ? format(dateObj, 'MMM d, yyyy') : 'Invalid date';
    } catch (error) {
      return 'Invalid date';
    }
  };
  
  // Function to format time for display
  const formatTime = (date: Date | string | undefined): string => {
    if (!date) return '';
    
    try {
      const dateObj = typeof date === 'string' ? parseISO(date) : date;
      return isValid(dateObj) ? format(dateObj, 'h:mm a') : '';
    } catch (error) {
      return '';
    }
  };
  
  // Render priority badge
  const renderPriorityBadge = (priority: string) => {
    let variant = 'outline';
    switch (priority) {
      case 'low':
        variant = 'outline';
        break;
      case 'medium':
        variant = 'secondary';
        break;
      case 'high':
        variant = 'destructive';
        break;
      case 'urgent':
        variant = 'destructive';
        break;
    }
    
    return (
      <Badge variant={variant as any}>
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </Badge>
    );
  };
  
  // Render status badge
  const renderStatusBadge = (status: string) => {
    let variant = 'outline';
    switch (status) {
      case 'todo':
        variant = 'outline';
        break;
      case 'in_progress':
        variant = 'secondary';
        break;
      case 'done':
        variant = 'default';
        break;
      case 'cancelled':
        variant = 'destructive';
        break;
    }
    
    const statusText = status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1);
    
    return (
      <Badge variant={variant as any}>
        {statusText}
      </Badge>
    );
  };
  
  // Render loading or API key required state
  const renderInitialState = () => {
    if (isInitializing) {
      return (
        <div className="flex flex-col items-center justify-center h-[70vh]">
          <RefreshCw className="h-12 w-12 text-primary animate-spin mb-4" />
          <h2 className="text-xl font-semibold mb-2">Initializing AGI Companion</h2>
          <p className="text-muted-foreground">Please wait while we set up your AI assistant...</p>
        </div>
      );
    }
    
    if (!isApiKeySet) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Key Required
            </CardTitle>
            <CardDescription>
              Please set your OpenAI API key to use the AGI Companion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="api-key" className="text-sm font-medium">
                  OpenAI API Key
                </label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                {apiKeyError && (
                  <p className="text-xs text-red-500">{apiKeyError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Your API key is stored locally and never sent to our servers.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={saveApiKey} className="w-full">
              <Save className="h-4 w-4 mr-2" />
              Save API Key
            </Button>
          </CardFooter>
        </Card>
      );
    }
    
    return null;
  };
  
  // Render suggestions panel
  const renderSuggestions = () => {
    if (!showSuggestions || suggestions.length === 0) return null;
    
    return (
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-500" />
              Suggestions
            </CardTitle>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowSuggestions(false)}
              title="Hide suggestions"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-auto max-h-[200px]">
            <div className="space-y-3">
              {suggestions.map(suggestion => (
                <div 
                  key={suggestion.id} 
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer"
                  onClick={() => suggestion.action && suggestion.action()}
                >
                  {suggestion.type === 'task' && <CheckSquare className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />}
                  {suggestion.type === 'knowledge' && <BookOpen className="h-5 w-5 text-purple-500 shrink-0 mt-0.5" />}
                  {suggestion.type === 'meeting' && <Calendar className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />}
                  {suggestion.type === 'code' && <Code className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />}
                  {suggestion.type === 'reminder' && <Clock className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />}
                  
                  <div className="flex-grow">
                    <div className="flex justify-between items-start">
                      <h4 className="font-medium text-sm">{suggestion.title}</h4>
                      {renderPriorityBadge(suggestion.priority)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{suggestion.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  };
  
  return (
    <div className="flex min-h-screen bg-background p-4">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-center space-x-2 mb-6">
          <Cpu className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">AGI Companion</h1>
        </div>
        
        {renderInitialState() || (
          <>
            {renderSuggestions()}
            
            <Tabs defaultValue="chat" value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-6 mb-6">
                <TabsTrigger value="chat" className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="knowledge" className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Knowledge
                </TabsTrigger>
                <TabsTrigger value="tasks" className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" />
                  Tasks
                </TabsTrigger>
                <TabsTrigger value="projects" className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" />
                  Projects
                </TabsTrigger>
                <TabsTrigger value="memory" className="flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  Memory
                </TabsTrigger>
                <TabsTrigger value="summarizer" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Summarizer
                </TabsTrigger>
              </TabsList>
              
              {/* Chat Tab Content */}
              <TabsContent value="chat" className="space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  {/* Conversations Sidebar */}
                  <Card className="col-span-1 h-[75vh]">
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-base">Conversations</CardTitle>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => setShowNewChat(true)}
                          title="New conversation"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="h-[calc(75vh-5rem)] overflow-hidden p-0">
                      <ScrollArea className="h-full px-4">
                        <div className="space-y-2 pb-4">
                          {conversations.map(conversation => (
                            <div
                              key={conversation.id}
                              className={`p-3 rounded-lg cursor-pointer ${
                                activeConversation?.id === conversation.id
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-muted'
                              }`}
                              onClick={() => setActiveConversation(conversation)}
                            >
                              <div className="flex justify-between items-start">
                                <h3 className="font-medium text-sm truncate">
                                  {conversation.title}
                                </h3>
                                <span className="text-xs opacity-70 whitespace-nowrap ml-2">
                                  {formatDate(conversation.lastUpdated)}
                                </span>
                              </div>
                              <p className="text-xs mt-1 opacity-70 truncate">
                                {conversation.messages.length} messages
                              </p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                  
                  {/* Chat Main Area */}
                  <Card className="col-span-3 h-[75vh] flex flex-col">
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-lg">
                          {activeConversation?.title || 'Chat'}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setShowSettings(true)}
                            title="Settings"
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="flex-grow overflow-hidden p-0">
                      <ScrollArea className="h-[calc(75vh-11rem)] px-4">
                        <div className="space-y-4 pb-4">
                          {activeConversation?.messages.map((message) => (
                            <div
                              key={message.id}
                              className={`flex ${
                                message.role === 'user' ? 'justify-end' : 'justify-start'
                              }`}
                            >
                              <div
                                className={`flex max-w-[80%] rounded-lg p-3 ${
                                  message.role === 'user'
                                    ? 'bg-primary text-primary-foreground'
                                    : message.role === 'system'
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-secondary text-secondary-foreground'
                                }`}
                              >
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2 mb-1">
                                    {message.role === 'user' ? (
                                      <User className="h-4 w-4" />
                                    ) : message.role === 'assistant' ? (
                                      <Bot className="h-4 w-4" />
                                    ) : (
                                      <AlertTriangle className="h-4 w-4" />
                                    )}
                                    <span className="text-xs font-medium">
                                      {message.role === 'user'
                                        ? 'You'
                                        : message.role === 'assistant'
                                        ? 'AGI Assistant'
                                        : 'System'}
                                    </span>
                                  </div>
                                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                                  <span className="text-xs opacity-70 mt-1 self-end">
                                    {formatTime(message.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div ref={messagesEndRef} />
                        </div>
                      </ScrollArea>
                    </CardContent>
                    
                    <CardFooter className="pt-3">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          sendMessage();
                        }}
                        className="flex w-full items-center space-x-2"
                      >
                        <Input
                          placeholder="Type your message..."
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          disabled={isChatLoading || !activeConversation}
                        />
                        <Button
                          type="submit"
                          disabled={!inputMessage.trim() || isChatLoading || !activeConversation}
                          className="shrink-0"
                        >
                          {isChatLoading ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      </form>
                    </CardFooter>
                  </Card>
                </div>
                
                {/* New Chat Dialog */}
                <Dialog open={showNewChat} onOpenChange={setShowNewChat}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New Conversation</DialogTitle>
                      <DialogDescription>
                        Create a new conversation with your AGI assistant.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <label htmlFor="chat-title" className="text-sm font-medium">
                          Conversation Title
                        </label>
                        <Input
                          id="chat-title"
                          placeholder="E.g., Project Planning, Research, etc."
                          value={newChatTitle}
                          onChange={(e) => setNewChatTitle(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowNewChat(false)}>
                        Cancel
                      </Button>
                      <Button onClick={createNewConversation}>
                        Create Conversation
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
                {/* Settings Dialog */}
                <Dialog open={showSettings} onOpenChange={setShowSettings}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Settings</DialogTitle>
                      <DialogDescription>
                        Configure your AGI Companion settings.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <label htmlFor="settings-api-key" className="text-sm font-medium">
                          OpenAI API Key
                        </label>
                        <Input
                          id="settings-api-key"
                          type="password"
                          placeholder="sk-..."
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                        />
                        {apiKeyError && (
                          <p className="text-xs text-red-500">{apiKeyError}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Your API key is stored locally and never sent to our servers.
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => {
                        setShowSettings(false);
                        setApiKeyError(null);
                      }}>
                        Cancel
                      </Button>
                      <Button onClick={saveApiKey}>
                        Save Settings
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </TabsContent>
              
              {/* Knowledge Base Tab Content */}
              <TabsContent value="knowledge" className="space-y-4">
                <Card className="h-[75vh] flex flex-col">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      Knowledge Base
                    </CardTitle>
                    <CardDescription>
                      Search your knowledge base for information and insights.
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="flex-grow overflow-hidden p-4">
                    <div className="flex items-center space-x-2 mb-4">
                      <Input
                        placeholder="Search your knowledge base..."
                        value={knowledgeQuery}
                        onChange={(e) => setKnowledgeQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && searchKnowledgeBase()}
                      />
                      <Button 
                        onClick={searchKnowledgeBase}
                        disabled={!knowledgeQuery.trim() || isSearching}
                      >
                        {isSearching ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 h-[calc(75vh-12rem)]">
                      {/* Results List */}
                      <div className="col-span-1 border rounded-lg overflow-hidden">
                        <div className="p-3 bg-muted font-medium text-sm">
                          Results ({knowledgeResults.length})
                        </div>
                        <ScrollArea className="h-[calc(75vh-14rem)]">
                          <div className="p-2">
                            {knowledgeResults.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground">
                                <Search className="h-8 w-8 mb-2 opacity-50" />
                                <p>Search your knowledge base to find relevant information</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {knowledgeResults.map(result => (
                                  <div
                                    key={result.id}
                                    className={`p-3 rounded-lg cursor-pointer ${
                                      selectedDocument?.id === result.id
                                        ? 'bg-primary text-primary-foreground'
                                        : 'hover:bg-muted'
                                    }`}
                                    onClick={() => setSelectedDocument(result)}
                                  >
                                    <div className="flex items-start justify-between">
                                      <h3 className="font-medium text-sm truncate">
                                        {result.title}
                                      </h3>
                                      <Badge variant="outline" className="ml-2 shrink-0">
                                        {result.type}
                                      </Badge>
                                    </div>
                                    <p className="text-xs mt-1 opacity-70 line-clamp-2">
                                      {result.content.substring(0, 100)}...
                                    </p>
                                    <div className="flex justify-between items-center mt-2">
                                      <span className="text-xs opacity-70">
                                        {formatDate(result.timestamp)}
                                      </span>
                                      <Badge variant="secondary" className="text-xs">
                                        {Math.round(result.relevance * 100)}% match
                                      </Badge>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                      
                      {/* Document Viewer */}
                      <div className="col-span-2 border rounded-lg overflow-hidden">
                        <div className="p-3 bg-muted font-medium text-sm flex justify-between items-center">
                          <span>
                            {selectedDocument ? selectedDocument.title : 'Document Viewer'}
                          </span>
                          {selectedDocument && (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {selectedDocument.type}
                              </Badge>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                title="Add to conversation"
                                onClick={() => {
                                  if (activeConversation && selectedDocument) {
                                    setInputMessage(prev => 
                                      `${prev ? prev + '\n\n' : ''}I'm looking at this document: "${selectedDocument.title}". Can you help me understand it?`
                                    );
                                    setActiveTab('chat');
                                  }
                                }}
                              >
                                <MessageCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <ScrollArea className="h-[calc(75vh-14rem)] p-4">
                          {selectedDocument ? (
                            <div className="space-y-4">
                              <h2 className="text-xl font-semibold">
                                {selectedDocument.title}
                              </h2>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>{formatDate(selectedDocument.timestamp)}</span>
                                <span>•</span>
                                <span>{selectedDocument.type}</span>
                              </div>
                              <Separator />
                              <div className="whitespace-pre-wrap">
                                {selectedDocument.content}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                              <BookOpen className="h-12 w-12 mb-4 opacity-50" />
                              <h3 className="text-lg font-medium mb-2">No Document Selected</h3>
                              <p>Select a document from the results to view its contents</p>
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Tasks Tab Content */}
              <TabsContent value="tasks" className="space-y-4">
                <Card className="h-[75vh] flex flex-col">
                  <CardHeader>
                    <div className="flex justify-between items-center">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <CheckSquare className="h-5 w-5" />
                          Task Management
                        </CardTitle>
                        <CardDescription>
                          Manage your tasks and track your progress.
                        </CardDescription>
                      </div>
                      <Button 
                        variant="outline" 
                        onClick={() => setShowNewTask(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        New Task
                      </Button>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="flex-grow overflow-hidden p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8">
                              <Filter className="h-3.5 w-3.5 mr-2" />
                              Filter
                              <ChevronDown className="h-3.5 w-3.5 ml-2" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuLabel>Status</DropdownMenuLabel>
                            <DropdownMenuItem 
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                status: prev.status?.includes('todo') 
                                  ? prev.status.filter(s => s !== 'todo') 
                                  : [...(prev.status || []), 'todo']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.status?.includes('todo') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>Todo</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                status: prev.status?.includes('in_progress') 
                                  ? prev.status.filter(s => s !== 'in_progress') 
                                  : [...(prev.status || []), 'in_progress']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.status?.includes('in_progress') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>In Progress</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                status: prev.status?.includes('done') 
                                  ? prev.status.filter(s => s !== 'done') 
                                  : [...(prev.status || []), 'done']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.status?.includes('done') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>Done</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Priority</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                priority: prev.priority?.includes('urgent') 
                                  ? prev.priority.filter(p => p !== 'urgent') 
                                  : [...(prev.priority || []), 'urgent']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.priority?.includes('urgent') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>Urgent</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                priority: prev.priority?.includes('high') 
                                  ? prev.priority.filter(p => p !== 'high') 
                                  : [...(prev.priority || []), 'high']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.priority?.includes('high') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>High</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                priority: prev.priority?.includes('medium') 
                                  ? prev.priority.filter(p => p !== 'medium') 
                                  : [...(prev.priority || []), 'medium']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.priority?.includes('medium') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>Medium</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setTaskFilter(prev => ({
                                ...prev, 
                                priority: prev.priority?.includes('low') 
                                  ? prev.priority.filter(p => p !== 'low') 
                                  : [...(prev.priority || []), 'low']
                              }))}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${taskFilter.priority?.includes('low') ? 'bg-primary' : 'bg-muted'}`} />
                                <span>Low</span>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setTaskFilter({})}
                            >
                              Clear All Filters
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        
                        {(taskFilter.status?.length || taskFilter.priority?.length) ? (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8"
                            onClick={() => setTaskFilter({})}
                          >
                            Clear Filters
                          </Button>
                        ) : null}
                      </div>
                      
                      <div className="text-sm text-muted-foreground">
                        {tasks.length} tasks total
                      </div>
                    </div>
                    
                    <ScrollArea className="h-[calc(75vh-14rem)]">
                      <div className="space-y-3">
                        {tasks.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground">
                            <CheckSquare className="h-8 w-8 mb-2 opacity-50" />
                            <p>No tasks yet. Create your first task to get started.</p>
                          </div>
                        ) : (
                          tasks
                            .filter(task => {
                              // Apply filters
                              if (taskFilter.status?.length && !taskFilter.status.includes(task.status)) {
                                return false;
                              }
                              if (taskFilter.priority?.length && !taskFilter.priority.includes(task.priority)) {
                                return false;
                              }
                              if (taskFilter.projectId && task.projectId !== taskFilter.projectId) {
                                return false;
                              }
                              if (taskFilter.tags?.length && !task.tags?.some(tag => taskFilter.tags?.includes(tag))) {
                                return false;
                              }
                              return true;
                            })
                            .map(task => (
                              <div
                                key={task.id}
                                className="p-4 border rounded-lg hover:bg-muted/50"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-grow">
                                    <div className="flex items-center gap-2 mb-2">
                                      <input
                                        type="checkbox"
                                        checked={task.status === 'done'}
                                        onChange={() => updateTask(task.id, {
                                          status: task.status === 'done' ? 'todo' : 'done'
                                        })}
                                        className="h-4 w-4"
                                      />
                                      <span className={`font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                                        {task.description}
                                      </span>
                                    </div>
                                    
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                      {renderStatusBadge(task.status)}
                                      {renderPriorityBadge(task.priority)}
                                      
                                      {task.dueDate && (
                                        <Badge variant="outline" className="flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          {formatDate(task.dueDate)}
                                        </Badge>
                                      )}
                                      
                                      {task.projectId && (
                                        <Badge variant="secondary" className="flex items-center gap-1">
                                          <FolderKanban className="h-3 w-3" />
                                          {projects.find(p => p.id === task.projectId)?.name || 'Project'}
                                        </Badge>
                                      )}
                                      
                                      {task.tags?.map(tag => (
                                        <Badge key={tag} variant="outline" className="flex items-center gap-1">
                                          <Tag className="h-3 w-3" />
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                  
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreVertical className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        onClick={() => setEditingTask(task)}
                                      >
                                        <Edit className="h-4 w-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => updateTask(task.id, {
                                          status: 'in_progress'
                                        })}
                                      >
                                        <Play className="h-4 w-4 mr-2" />
                                        Start
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => updateTask(task.id, {
                                          status: 'done'
                                        })}
                                      >
                                        <CheckSquare className="h-4 w-4 mr-2" />
                                        Complete
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-red-500"
                                        onClick={() => deleteTask(task.id)}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
                
                {/* New Task Dialog */}
                <Dialog open={showNewTask} onOpenChange={setShowNewTask}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New Task</DialogTitle>
                      <DialogDescription>
                        Create a new task to track your work.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <label htmlFor="task-description" className="text-sm font-medium">
                          Description
                        </label>
                        <Input
                          id="task-description"
                          placeholder="What needs to be done?"
                          value={newTask.description}
                          onChange={(e) => setNewTask(prev => ({
                            ...prev,
                            description: e.target.value
                          }))}
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label htmlFor="task-status" className="text-sm font-medium">
                            Status
                          </label>
                          <Select
                            value={newTask.status}
                            onValueChange={(value) => setNewTask(prev => ({
                              ...prev,
                              status: value as any
                            }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="todo">Todo</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="done">Done</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <label htmlFor="task-priority" className="text-sm font-medium">
                            Priority
                          </label>
                          <Select
                            value={newTask.priority}
                            onValueChange={(value) => setNewTask(prev => ({
                              ...prev,
                              priority: value as any
                            }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label htmlFor="task-due-date" className="text-sm font-medium">
                          Due Date (Optional)
                        </label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-start text-left font-normal"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {newTask.dueDate ? format(newTask.dueDate, 'PPP') : <span>Pick a date</span>}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <Calendar
                              mode="single"
                              selected={newTask.dueDate}
                              onSelect={(date) => setNewTask(prev => ({
                                ...prev,
                                dueDate: date || undefined
                              }))}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      
                      <div className="space-y-2">
                        <label htmlFor="task-project" className="text-sm font-medium">
                          Project (Optional)
                        </label>
                        <Select
                          value={newTask.projectId}
                          onValueChange={(value) => setNewTask(prev => ({
                            ...prev,
                            projectId: value
                          }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select project" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">None</SelectItem>
                            {projects.map(project => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <label htmlFor="task-tags" className="text-sm font-medium">
                          Tags (Optional, comma-separated)
                        </label>
                        <Input
                          id="task-tags"
                          placeholder="e.g., work, personal, urgent"
                          value={newTask.tags?.join(', ') || ''}
                          onChange={(e) => setNewTask(prev => ({
                            ...prev,
                            tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
                          }))}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowNewTask(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={createTask}
                        disabled={!newTask.description.trim()}
                      >
                        Create Task
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
                {/* Edit Task Dialog */}
                <Dialog 
                  open={!!editingTask} 
                  onOpenChange={(open) => !open && setEditingTask(null)}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit Task</DialogTitle>
                      <DialogDescription>
                        Update task details.
                      </DialogDescription>
                    </DialogHeader>
                    {editingTask && (
                      <div className="space-y-4 py-2">
                        <div className="space-y-2">
                          <label htmlFor="edit-task-description" className="text-sm font-medium">
                            Description
                          </label>
                          <Input
                            id="edit-task-description"
                            value={editingTask.description}
                            onChange={(e) => setEditingTask(prev => prev ? {
                              ...prev,
                              description: e.target.value
                            } : null)}
                          />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label htmlFor="edit-task-status" className="text-sm font-medium">
                              Status
                            </label>
                            <Select
                              value={editingTask.status}
                              onValueChange={(value) => setEditingTask(prev => prev ? {
                                ...prev,
                                status: value as any
                              } : null)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="todo">Todo</SelectItem>
                                <SelectItem value="in_progress">In Progress</SelectItem>
                                <SelectItem value="done">Done</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <label htmlFor="edit-task-priority" className="text-sm font-medium">
                              Priority
                            </label>
                            <Select
                              value={editingTask.priority}
                              onValueChange={(value) => setEditingTask(prev => prev ? {
                                ...prev,
                                priority: value as any
                              } : null)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="urgent">Urgent</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <label htmlFor="edit-task-due-date" className="text-sm font-medium">
                            Due Date
                          </label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                              >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {editingTask.dueDate ? format(editingTask.dueDate, 'PPP') : <span>Pick a date</span>}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={editingTask.dueDate}
                                onSelect={(date) => setEditingTask(prev => prev ? {
                                  ...prev,
                                  dueDate: date || undefined
                                } : null)}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        
                        <div className="space-y-2">
                          <label htmlFor="edit-task-project" className="text-sm font-medium">
                            Project
                          </label>
                          <Select
                            value={editingTask.projectId || ''}
                            onValueChange={(value) => setEditingTask(prev => prev ? {
                              ...prev,
                              projectId: value || undefined
                            } : null)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select project" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">None</SelectItem>
                              {projects.map(project => (
                                <SelectItem key={project.id} value={project.id}>
                                  {project.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <label htmlFor="edit-task-tags" className="text-sm font-medium">
                            Tags (comma-separated)
                          </label>
                          <Input
                            id="edit-task-tags"
                            value={editingTask.tags?.join(', ') || ''}
                            onChange={(e) => setEditingTask(prev => prev ? {
                              ...prev,
                              tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
                            } : null)}
                          />
                        </div>
                      </div>
                    )}
                    <DialogFooter>
                      <Button 
                        variant="outline" 
                        onClick={() => setEdit