
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
  Database,
  CheckSquare,
  FolderKanban,
  Brain,
  Calendar,
  PlusCircle,
  Edit,
  Trash2,
  Clock,
  Tag,
  Filter,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Info,
  X
} from 'lucide-react';
import { format, parseISO, isToday, isYesterday, addDays } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// Services
import getOpenAIService, { 
  APIKeyError, 
  RateLimitError
} from './services/openai';
import agiCompanion, {
  Message as AGIMessage,
  Conversation,
  Memory,
  Task,
  Project,
  MeetingPreparation
} from './services/agiCompanionService';
import { getSettings, updateSettings } from './services/settings';

// UI Components
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import { Progress } from "./components/ui/progress";
import { Calendar as CalendarComponent } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Switch } from "./components/ui/switch";
import { toast, Toaster } from "./components/ui/toaster";
import { useToast } from "./components/ui/use-toast";

// Enhanced message type with additional metadata
type EnhancedMessage = {
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
  relatedMemories?: Memory[];
  relatedDocuments?: any[];
  relatedEntities?: any[];
};

// Enhanced conversation type
type EnhancedConversation = {
  id: string;
  title: string;
  messages: EnhancedMessage[];
  created: Date;
  lastUpdated: Date;
  summary?: string;
  topic?: string;
  context?: string;
  projectId?: string;
  tags?: string[];
};

// Summary type definition
type Summary = {
  original: string;
  summary: string;
  keyPoints: string[];
  timestamp: Date;
};

// Suggestion type
type Suggestion = {
  id: string;
  type: 'task' | 'project' | 'research' | 'meeting' | 'reminder';
  content: string;
  context?: string;
  timestamp: Date;
  dismissed: boolean;
  clicked: boolean;
  priority: 'low' | 'medium' | 'high';
  action?: () => void;
};

// Knowledge search result with enhanced metadata
type EnhancedSearchResult = any & {
  expanded?: boolean;
  selected?: boolean;
};

function AGIApp() {
  // Toast hook
  const { toast } = useToast();
  
  // Tab state
  const [activeTab, setActiveTab] = useState('chat');
  
  // API and initialization states
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [huggingfaceApiKey, setHuggingfaceApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  
  // Chat and conversation states
  const [conversations, setConversations] = useState<EnhancedConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  // Knowledge base states
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [searchResults, setSearchResults] = useState<EnhancedSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState<EnhancedSearchResult[]>([]);
  
  // Meeting summarizer states
  const [meetingText, setMeetingText] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  
  // Meeting preparation states
  const [meetingPrep, setMeetingPrep] = useState<MeetingPreparation | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [meetingPrepForm, setMeetingPrepForm] = useState({
    title: '',
    date: new Date(),
    participants: '',
    agenda: '',
    context: ''
  });
  
  // Task management states
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [taskFilter, setTaskFilter] = useState<{
    status?: ('todo' | 'in_progress' | 'done' | 'cancelled')[];
    priority?: ('low' | 'medium' | 'high' | 'urgent')[];
    projectId?: string;
    tags?: string[];
  }>({});
  const [newTaskForm, setNewTaskForm] = useState({
    description: '',
    status: 'todo' as const,
    priority: 'medium' as const,
    dueDate: undefined as Date | undefined,
    projectId: undefined as string | undefined,
    tags: [] as string[]
  });
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  
  // Project management states
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  
  // User preferences
  const [userPreferences, setUserPreferences] = useState({
    enableProactiveSuggestions: true,
    enableWebResearch: true,
    enableCodeAnalysis: true,
    communicationStyle: 'balanced',
    learningStyle: 'visual'
  });
  
  // Suggestions
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Current active conversation
  const activeConversation = useMemo(() => {
    return conversations.find(c => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);
  
  // Initialize AGI Companion and load data
  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Check for saved API keys
        const settings = await getSettings();
        
        if (settings.openaiApiKey) {
          setApiKey(settings.openaiApiKey);
          setIsApiKeySet(true);
        }
        
        if (settings.huggingfaceApiKey) {
          setHuggingfaceApiKey(settings.huggingfaceApiKey);
        }
        
        // Initialize AGI Companion if API key is set
        if (settings.openaiApiKey && !isInitialized && !isInitializing) {
          setIsInitializing(true);
          
          // Initialize OpenAI service
          const openAIService = getOpenAIService(settings.openaiApiKey);
          
          // Initialize AGI Companion
          await agiCompanion.init();
          
          // Load conversations
          const conversationsList = await agiCompanion.listConversations();
          if (conversationsList.length > 0) {
            // Load full conversation data for each conversation
            const fullConversations: EnhancedConversation[] = [];
            for (const conv of conversationsList.slice(0, 10)) { // Limit to 10 most recent
              const fullConv = await agiCompanion.getConversation(conv.id);
              if (fullConv) {
                fullConversations.push({
                  ...fullConv,
                  messages: fullConv.messages.map(m => ({
                    ...m,
                    relatedMemories: [],
                    relatedDocuments: [],
                    relatedEntities: []
                  }))
                });
              }
            }
            setConversations(fullConversations);
            
            // Set active conversation to the most recent one
            if (fullConversations.length > 0) {
              setActiveConversationId(fullConversations[0].id);
            }
          } else {
            // Create a new conversation if none exist
            const newConv = await agiCompanion.createConversation('New Conversation');
            const welcomeMessage: AGIMessage = {
              id: uuidv4(),
              role: 'system',
              content: 'Welcome to the AGI Companion! I\'m here to assist you with any questions or tasks. I have access to your knowledge base, can manage tasks and projects, and learn from our interactions to better assist you over time.',
              timestamp: new Date()
            };
            await agiCompanion.addMessage(newConv.id, welcomeMessage);
            
            const fullConv = await agiCompanion.getConversation(newConv.id);
            if (fullConv) {
              setConversations([{
                ...fullConv,
                messages: fullConv.messages.map(m => ({
                  ...m,
                  relatedMemories: [],
                  relatedDocuments: [],
                  relatedEntities: []
                }))
              }]);
              setActiveConversationId(newConv.id);
            }
          }
          
          // Load tasks
          const tasksList = await agiCompanion.listTasks();
          setTasks(tasksList);
          
          // Load projects
          const projectsList = await agiCompanion.listProjects();
          setProjects(projectsList);
          
          setIsInitialized(true);
          setIsInitializing(false);
          
          // Generate initial suggestions
          generateSuggestions();
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setIsInitializing(false);
        
        // Show error toast
        toast({
          title: "Initialization Error",
          description: "Failed to initialize the application. Please check your API keys and try again.",
          variant: "destructive"
        });
      }
    };
    
    initializeApp();
  }, [isApiKeySet, isInitialized]);
  
  // Scroll to bottom of chat when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeConversation?.messages]);
  
  // Function to save API keys
  const saveApiKeys = async () => {
    if (!apiKey.trim()) {
      setApiKeyError('OpenAI API key cannot be empty');
      return;
    }
    
    setApiKeyError(null);
    
    try {
      // Initialize and test the OpenAI API key
      const openAIService = getOpenAIService(apiKey);
      await openAIService.testApiKey();
      
      // Update settings
      await updateSettings({
        openaiApiKey: apiKey,
        huggingfaceApiKey: huggingfaceApiKey || undefined
      });
      
      setIsApiKeySet(true);
      setShowSettings(false);
      
      // Show success toast
      toast({
        title: "Settings Saved",
        description: "Your API keys have been saved successfully.",
        variant: "default"
      });
      
      // Reload the page to initialize with new keys
      window.location.reload();
    } catch (error) {
      if (error instanceof APIKeyError) {
        setApiKeyError('Invalid OpenAI API key. Please check and try again.');
      } else {
        setApiKeyError('Failed to validate API key. Please try again.');
        console.error('API key validation error:', error);
      }
    }
  };
  
  // Function to create a new conversation
  const createNewConversation = async () => {
    try {
      const newConv = await agiCompanion.createConversation('New Conversation');
      const welcomeMessage: AGIMessage = {
        id: uuidv4(),
        role: 'system',
        content: 'How can I assist you today?',
        timestamp: new Date()
      };
      await agiCompanion.addMessage(newConv.id, welcomeMessage);
      
      const fullConv = await agiCompanion.getConversation(newConv.id);
      if (fullConv) {
        setConversations(prev => [{
          ...fullConv,
          messages: fullConv.messages.map(m => ({
            ...m,
            relatedMemories: [],
            relatedDocuments: [],
            relatedEntities: []
          }))
        }, ...prev]);
        setActiveConversationId(newConv.id);
        setActiveTab('chat');
      }
    } catch (error) {
      console.error('Failed to create new conversation:', error);
      toast({
        title: "Error",
        description: "Failed to create a new conversation. Please try again.",
        variant: "destructive"
      });
    }
  };
  
  // Function to handle sending a message
  const sendMessage = async () => {
    if (!inputMessage.trim() || !isApiKeySet || !activeConversationId) return;
    
    // Create a new user message
    const userMessage: AGIMessage = {
      id: uuidv4(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date()
    };
    
    // Update UI immediately with the user message
    setConversations(prev => prev.map(conv => 
      conv.id === activeConversationId
        ? {
            ...conv,
            messages: [...conv.messages, {
              ...userMessage,
              relatedMemories: [],
              relatedDocuments: [],
              relatedEntities: []
            }],
            lastUpdated: new Date()
          }
        : conv
    ));
    
    setInputMessage('');
    setIsChatLoading(true);
    
    try {
      // Add message to conversation in AGI Companion
      await agiCompanion.addMessage(activeConversationId, userMessage);
      
      // Generate response with AGI Companion
      const assistantMessage = await agiCompanion.generateResponse(activeConversationId, {
        temperature: 0.7
      });
      
      // Get relevant memories and knowledge for this message
      const relevantMemories = await agiCompanion.getRelevantMemories(userMessage.content, 3);
      const knowledgeResults = await agiCompanion.searchKnowledgeBase(userMessage.content, 3);
      
      // Update UI with the assistant message and related information
      setConversations(prev => prev.map(conv => 
        conv.id === activeConversationId
          ? {
              ...conv,
              messages: [...conv.messages.slice(0, -1), // Remove the user message we added earlier
                {
                  ...userMessage,
                  relatedMemories: [],
                  relatedDocuments: [],
                  relatedEntities: []
                },
                {
                  ...assistantMessage,
                  relatedMemories: relevantMemories,
                  relatedDocuments: knowledgeResults,
                  relatedEntities: []
                }],
              lastUpdated: new Date()
            }
          : conv
      ));
      
      // Generate new suggestions based on the conversation
      generateSuggestions();
    } catch (error) {
      console.error('Failed to get response:', error);
      
      // Create appropriate error message based on error type
      let errorMessage = 'Sorry, I encountered an error processing your request. Please try again later.';
      
      if (error instanceof APIKeyError) {
        errorMessage = 'Your API key appears to be invalid. Please check your settings and update your API key.';
      } else if (error instanceof RateLimitError) {
        errorMessage = 'You\'ve reached the rate limit for API requests. Please wait a moment and try again.';
      }
      
      // Add error message to UI
      const errorAssistantMessage: EnhancedMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date(),
        relatedMemories: [],
        relatedDocuments: [],
        relatedEntities: []
      };
      
      setConversations(prev => prev.map(conv => 
        conv.id === activeConversationId
          ? {
              ...conv,
              messages: [...conv.messages, errorAssistantMessage],
              lastUpdated: new Date()
            }
          : conv
      ));
      
      // Show error toast
      toast({
        title: "Error",
        description: "Failed to generate a response. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsChatLoading(false);
    }
  };
  
  // Function to search knowledge base
  const searchKnowledgeBase = async () => {
    if (!knowledgeQuery.trim() || !isApiKeySet) return;
    
    setIsSearching(true);
    
    try {
      const results = await agiCompanion.searchKnowledgeBase(knowledgeQuery, 10);
      setSearchResults(results.map(r => ({ ...r, expanded: false })));
    } catch (error) {
      console.error('Failed to search knowledge base:', error);
      toast({
        title: "Search Error",
        description: "Failed to search the knowledge base. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSearching(false);
    }
  };
  
  // Function to toggle expansion of a search result
  const toggleResultExpansion = (id: string) => {
    setSearchResults(prev => prev.map(r => 
      r.documentId === id ? { ...r, expanded: !r.expanded } : r
    ));
  };
  
  // Function to toggle selection of a search result
  const toggleResultSelection = (id: string) => {
    setSearchResults(prev => {
      const updatedResults = prev.map(r => 
        r.documentId === id ? { ...r, selected: !r.selected } : r
      );
      
      // Update selected documents
      setSelectedDocuments(updatedResults.filter(r => r.selected));
      
      return updatedResults;
    });
  };
  
  // Function to add selected documents to chat
  const addSelectedDocumentsToChat = async () => {
    if (!activeConversationId || selectedDocuments.length === 0) return;
    
    try {
      // Create a system message with the selected documents
      const documentsContent = selectedDocuments.map(doc => 
        `Document: ${doc.title}\nContent: ${doc.content.substring(0, 500)}${doc.content.length > 500 ? '...' : ''}\n`
      ).join('\n');
      
      const systemMessage: AGIMessage = {
        id: uuidv4(),
        role: 'system',
        content: `I've added the following documents from the knowledge base for reference:\n\n${documentsContent}`,
        timestamp: new Date()
      };
      
      // Add message to conversation in AGI Companion
      await agiCompanion.addMessage(activeConversationId, systemMessage);
      
      // Update UI
      setConversations(prev => prev.map(conv => 
        conv.id === activeConversationId
          ? {
              ...conv,
              messages: [...conv.messages, {
                ...systemMessage,
                relatedMemories: [],
                relatedDocuments: selectedDocuments,
                relatedEntities: []
              }],
              lastUpdated: new Date()
            }
          : conv
      ));
      
      // Clear selected documents
      setSelectedDocuments([]);
      setSearchResults(prev => prev.map(r => ({ ...r, selected: false })));
      
      // Switch to chat tab
      setActiveTab('chat');
      
      // Show success toast
      toast({
        title: "Documents Added",
        description: `Added ${selectedDocuments.length} document(s) to the conversation.`,
        variant: "default"
      });
    } catch (error) {
      console.error('Failed to add documents to chat:', error);
      toast({
        title: "Error",
        description: "Failed to add documents to the conversation. Please try again.",
        variant: "destructive"
      });
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
  
  // Function to prepare for a meeting
  const prepareMeeting = async () => {
    if (!meetingPrepForm.title || !isApiKeySet) return;
    
    setIsPreparing(true);
    
    try {
      const preparation = await agiCompanion.prepareMeeting({
        title: meetingPrepForm.title,
        date: meetingPrepForm.date,
        participants: meetingPrepForm.participants.split(',').map(p => p.trim()),
        agenda: meetingPrepForm.agenda ? meetingPrepForm.agenda.split('\n').map(a => a.trim()) : undefined,
        context: meetingPrepForm.context || undefined
      });
      
      setMeetingPrep(preparation);
    } catch (error) {
      console.error('Failed to prepare for meeting:', error);
      toast({
        title: "Error",
        description: "Failed to prepare for the meeting. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsPreparing(false);
    }
  };
  
  // Function to load tasks
  const loadTasks = async () => {
    setIsLoadingTasks(true);
    
    try {
      const tasksList = await agiCompanion.listTasks(taskFilter);
      setTasks(tasksList);
    } catch (error) {
      console.error('Failed to load tasks:', error);
      toast({
        title: "Error",
        description: "Failed to load tasks. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoadingTasks(false);
    }
  };
  
  // Function to create a new task
  const createTask = async () => {
    if (!newTaskForm.description) return;
    
    try {
      const task = await agiCompanion.createTask(newTaskForm);
      setTasks(prev => [task, ...prev]);
      
      // Reset form
      setNewTaskForm({
        description: '',
        status: 'todo',
        priority: 'medium',
        dueDate: undefined,
        projectId: undefined,
        tags: []
      });
      
      setShowNewTaskForm(false);
      
      // Show success toast
      toast({
        title: "Task Created",
        description: "New task has been created successfully.",
        variant: "default"
      });
    } catch (error) {
      console.error('Failed to create task:', error);
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive"
      });
    }
  };
  
  // Function to update a task
  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      const updatedTask = await agiCompanion.updateTask(taskId, updates);
      if (updatedTask) {
        setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
        
        // Show success toast
        toast({
          title: "Task Updated",
          description: "Task has been updated successfully.",
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Failed to update task:', error);
      toast({
        title: "Error",
        description: "Failed to update task. Please try again.",
        variant: "destructive"
      });
    }
  };
  
  // Function to delete a task
  const deleteTask = async (taskId: string) => {
    try {
      const success = await agiCompanion.deleteTask(taskId);
      if (success) {
        setTasks(prev => prev.filter(t => t.id !== taskId));
        
        // Show success toast
        toast({
          title: "Task Deleted",
          description: "Task has been deleted successfully.",
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
      toast({
        title: "Error",
        description: "Failed to delete task. Please try again.",
        variant: "destructive"
      });
    }
  };
  
  // Function to generate suggestions based on user context and current state
  const generateSuggestions = () => {
    // This would be more sophisticated in a real implementation
    // For now, we'll generate some mock suggestions
    
    const newSuggestions: Suggestion[] = [
      {
        id: uuidv4(),
        type: 'task',
        content: 'Review project documentation',
        context: 'Based on your recent conversations about documentation',
        timestamp: new Date(),
        dismissed: false,
        clicked: false,
        priority: 'medium',
        action: () => {
          setActiveTab('tasks');
          setNewTaskForm({
            ...newTaskForm,
            description: 'Review project documentation',
            priority: 'medium'
          });
          setShowNewTaskForm(true);
        }
      },
      {
        id: uuidv4(),
        type: 'research',
        content: 'Explore vector embeddings for knowledge base',
        context: 'Related to your interest in AI and knowledge management',
        timestamp: new Date(),
        dismissed: false,
        clicked: false,
        priority: 'low',
        action: () => {
          setKnowledgeQuery('vector embeddings knowledge base');
          setActiveTab('knowledge');
          searchKnowledgeBase();
        }
      },
      {
        id: uuidv4(),
        type: 'meeting',
        content: 'Prepare for weekly team sync',
        context: 'Scheduled for tomorrow',
        timestamp: new Date(),
        dismissed: false,
        clicked: false,
        priority: 'high',
        action: () => {
          setActiveTab('meetings');
          setMeetingPrepForm({
            ...meetingPrepForm,
            title: 'Weekly Team Sync',
            date: addDays(new Date(), 1),
            participants: 'Team Members, Project Manager',
            agenda: 'Project Updates\nBlockers\nNext Steps'
          });
        }
      }
    ];
    
    setSuggestions(prev => [...newSuggestions, ...prev.filter(s => !s.dismissed).slice(0, 2)]);
  };
  
  // Function to dismiss a suggestion
  const dismissSuggestion = (id: string) => {
    setSuggestions(prev => prev.map(s => 
      s.id === id ? { ...s, dismissed: true } : s
    ).filter(s => !s.dismissed));
  };
  
  // Function to handle suggestion click
  const handleSuggestionClick = (suggestion: Suggestion) => {
    // Mark as clicked
    setSuggestions(prev => prev.map(s => 
      s.id === suggestion.id ? { ...s, clicked: true } : s
    ));
    
    // Execute the action if defined
    if (suggestion.action) {
      suggestion.action();
    }
  };
  
  // Function to format date for display
  const formatDate = (date: Date) => {
    if (isToday(date)) {
      return `Today at ${format(date, 'h:mm a')}`;
    } else if (isYesterday(date)) {
      return `Yesterday at ${format(date, 'h:mm a')}`;
    } else {
      return format(date, 'MMM d, yyyy h:mm a');
    }
  };
  
  return (
    <div className="flex min-h-screen bg-background p-4">
      <Toaster />
      <div className="w-full max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">AGI Companion</h1>
          </div>
          
          {/* Suggestions */}
          {userPreferences.enableProactiveSuggestions && suggestions.length > 0 && (
            <div className="flex items-center space-x-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="relative">
                    <Info className="h-4 w-4 mr-2" />
                    Suggestions
                    <Badge className="ml-2 absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0">
                      {suggestions.length}
                    </Badge>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="p-4 border-b">
                    <h4 className="font-medium">Suggestions</h4>
                    <p className="text-xs text-muted-foreground">
                      Based on your recent activity and preferences
                    </p>
                  </div>
                  <ScrollArea className="h-[300px]">
                    <div className="p-2">
                      {suggestions.map(suggestion => (
                        <div
                          key={suggestion.id}
                          className="p-3 mb-2 rounded-md border hover:bg-accent cursor-pointer"
                          onClick={() => handleSuggestionClick(suggestion)}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center space-x-2">
                                {suggestion.type === 'task' && <CheckSquare className="h-4 w-4 text-blue-500" />}
                                {suggestion.type === 'project' && <FolderKanban className="h-4 w-4 text-green-500" />}
                                {suggestion.type === 'research' && <Search className="h-4 w-4 text-purple-500" />}
                                {suggestion.type === 'meeting' && <Calendar className="h-4 w-4 text-orange-500" />}
                                {suggestion.type === 'reminder' && <Clock className="h-4 w-4 text-red-500" />}
                                <span className="font-medium">{suggestion.content}</span>
                              </div>
                              {suggestion.context && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {suggestion.context}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissSuggestion(suggestion.id);
                              }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <Badge
                              variant={
                                suggestion.priority === 'high' ? 'destructive' :
                                suggestion.priority === 'medium' ? 'default' : 'outline'
                              }
                              className="text-xs"
                            >
                              {suggestion.priority}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(suggestion.timestamp)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
              
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        
        <Tabs defaultValue="chat" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-6">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Knowledge
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="meetings" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Meetings
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
          
          {/* Settings Dialog */}
          {showSettings && (
            <Dialog open={showSettings} onOpenChange={setShowSettings}>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    AGI Companion Settings
                  </DialogTitle>
                  <DialogDescription>
                    Configure API keys and preferences for the AGI Companion.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-6 py-4">
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">API Keys</h3>
                    <div className="space-y-2">
                      <Label htmlFor="openai-api-key">OpenAI API Key (Required)</Label>
                      <Input
                        id="openai-api-key"
                        type="password"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      {apiKeyError && (
                        <p className="text-xs text-red-500">{apiKeyError}</p>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="hf-api-key">Hugging Face API Key (Optional)</Label>
                      <Input
                        id="hf-api-key"
                        type="password"
                        placeholder="hf_..."
                        value={huggingfaceApiKey}
                        onChange={(e) => setHuggingfaceApiKey(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Used for local embeddings and additional AI capabilities.
                      </p>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Preferences</h3>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="proactive-suggestions">Proactive Suggestions</Label>
                        <p className="text-xs text-muted-foreground">
                          Allow the assistant to suggest tasks and actions
                        </p>
                      </div>
                      <Switch
                        id="proactive-suggestions"
                        checked={userPreferences.enableProactiveSuggestions}
                        onCheckedChange={(checked) => setUserPreferences(prev => ({
                          ...prev,
                          enableProactiveSuggestions: checked
                        }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="web-research">Web Research</Label>
                        <p className="text-xs text-muted-foreground">
                          Enable web research capabilities
                        </p>
                      </div>
                      <Switch
                        id="web-research"
                        checked={userPreferences.enableWebResearch}
                        onCheckedChange={(checked) => setUserPreferences(prev => ({
                          ...prev,
                          enableWebResearch: checked
                        }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="code-analysis">Code Analysis</Label>
                        <p className="text-xs text-muted-foreground">
                          Enable code analysis and generation features
                        </p>
                      </div>
                      <Switch
                        id="code-analysis"
                        checked={userPreferences.enableCodeAnalysis}
                        onCheckedChange={(checked) => setUserPreferences(prev => ({
                          ...prev,
                          enableCodeAnalysis: checked
                        }))}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="communication-style">Communication Style</Label>
                      <Select
                        value={userPreferences.communicationStyle}
                        onValueChange={(value) => setUserPreferences(prev => ({
                          ...prev,
                          communicationStyle: value
                        }))}
                      >
                        <SelectTrigger id="communication-style">
                          <SelectValue placeholder="Select style" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="concise">Concise</SelectItem>
                          <SelectItem value="balanced">Balanced</SelectItem>
                          <SelectItem value="detailed">Detailed</SelectItem>
                          <SelectItem value="technical">Technical</SelectItem>
                          <SelectItem value="friendly">Friendly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowSettings(false)}>
                    Cancel
                  </Button>
                  <Button onClick={saveApiKeys}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Settings
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          
          {/* Chat Tab Content */}
          <TabsContent value="chat" className="space-y-4">
            {!isApiKeySet ? (
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
                <CardFooter>
                  <Button onClick={() => setShowSettings(true)} className="w-full">
                    Open Settings
                  </Button>
                </CardFooter>
              </Card>
            ) : !isInitialized ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    Initializing AGI Companion
                  </CardTitle>
                  <CardDescription>
                    Please wait while we initialize the AGI Companion...
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Progress value={45} className="w-full" />
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-4 gap-4">
                {/* Conversation List */}
                <Card className="col-span-1 h-[75vh]">
                  <CardHeader className="p-4">
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span>Conversations</span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={createNewConversation}
                        title="New Conversation"
                      >
                        <PlusCircle className="h-4 w-4" />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-2 overflow-hidden">
                    <ScrollArea className="h-[calc(75vh-5rem)]">
                      <div className="space-y-2 pr-2">
                        {conversations.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No conversations yet</p>
                            <p className="text-xs mt-1">
                              Start a new conversation to begin
                            </p>
                          </div>
                        ) : (
                          conversations.map(conv => (
                            <div
                              key={conv.id}
                              className={`p-3 rounded-md cursor-pointer transition-colors ${
                                conv.id === activeConversationId
                                  ? 'bg-primary text-primary-foreground'
                                  : 'hover:bg-accent'
                              }`}
                              onClick={() => setActiveConversationId(conv.id)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1 truncate">
                                  <p className="font-medium truncate">{conv.title}</p>
                                  <p className="text-xs truncate opacity-80">
                                    {conv.messages.length > 0
                                      ? conv.messages[conv.messages.length - 1].content.substring(0, 40) + '...'
                                      : 'No messages'}
                                  </p>
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={`h-6 w-6 ${
                                        conv.id === activeConversationId
                                          ? 'text-primary-foreground hover:bg-primary/90'
                                          : 'text-muted-foreground'
                                      }`}
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem>
                                      <Edit className="h-4 w-4 mr-2" />
                                      Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem>
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs opacity-70">
                                  {conv.messages.length} messages
                                </span>
                                <span className="text-xs opacity-70">
                                  {formatDate(conv.lastUpdated)}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
                
                {/* Chat Area */}
                <Card className="col-span-3 h-[75vh] flex flex-col">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span>{activeConversation?.title || 'New Conversation'}</span>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => setActiveTab('knowledge')}
                        >
                          <Search className="h-4 w-4 mr-2" />
                          Add Knowledge
                        </Button>
                      </div>
                    </CardTitle>
                    {activeConversation?.context && (
                      <CardDescription>
                        Context: {activeConversation.context}
                      </CardDescription>
                    )}
                  </CardHeader>
                  
                  <CardContent className="flex-grow overflow-hidden p-4 pt-2">
                    <ScrollArea className="h-[calc(75vh-10rem)]">
                      <div className="space-y-4">
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
                                      ? 'AGI Companion'
                                      : 'System'}
                                  </span>
                                </div>
                                <p className="text-sm">{message.content}</p>
                                
                                {/* Related information */}
                                {(message.relatedMemories?.length > 0 || message.relatedDocuments?.length > 0) && (
                                  <Accordion type="single" collapsible className="mt-2">
                                    <AccordionItem value="related-info">
                                      <AccordionTrigger className="text-xs py-1">
                                        Related Information
                                      </AccordionTrigger>
                                      <AccordionContent>
                                        <div className="space-y-2 text-xs">
                                          {message.relatedMemories?.length > 0 && (
                                            <div>
                                              <p className="font-medium">From Memory:</p>
                                              <ul className="list-disc list-inside">
                                                {message.relatedMemories.map((memory, idx) => (
                                                  <li key={idx}>{memory.content}</li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                          
                                          {message.relatedDocuments?.length > 0 && (
                                            <div>
                                              <p className="font-medium">From Knowledge Base:</p>
                                              <ul className="list-disc list-inside">
                                                {message.relatedDocuments.map((doc, idx) => (
                                                  <li key={idx}>{doc.title}</li>
                                                ))}
                                              </ul>
                                            </div>
                                          )}
                                        </div>
                                      </AccordionContent>
                                    </AccordionItem>
                                  </Accordion>
                                )}
                                
                                <span className="text-xs opacity-70 mt-1 self-end">
                                  {formatDate(message.timestamp)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    </ScrollArea>
                  </CardContent>
                  
                  <CardFooter className="p-4 pt-2">
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
                        disabled={isChatLoading || !activeConversationId}
                      />
                      <Button
                        type="submit"
                        disabled={!inputMessage.trim() || isChatLoading || !activeConversationId}
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
            )}
          </TabsContent>
          
          {/* Knowledge Base Tab Content */}
          <TabsContent value="knowledge" className="space-y-4">
            {!isApiKeySet ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Key Required
                  </CardTitle>
                  <CardDescription>
                    Please set your OpenAI API key to use the knowledge base.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={() => setShowSettings(true)} className="w-full">
                    Open Settings
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Knowledge Base
                  </CardTitle>
                  <CardDescription>
                    Search your knowledge base for information and add it to conversations.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Input
                        placeholder="Search for information..."
                        value={knowledgeQuery}
                        onChange={(e) => setKnowledgeQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            searchKnowledgeBase();
                          }
                        }}
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
                    
                    {selectedDocuments.length > 0 && (
                      <div className="flex items-center justify-between bg-muted p-3 rounded-md">
                        <span>
                          {selectedDocuments.length} document{selectedDocuments.length !== 1 ? 's' : ''} selected
                        </span>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSearchResults(prev => prev.map(r => ({ ...r, selected: false })))}
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            onClick={addSelectedDocumentsToChat}
                            disabled={!activeConversationId}
                          >
                            Add to Chat
                          </Button>
                        </div>
                      </div>
                    )}
                    
                    <div className="space-y-4">
                      {searchResults.length > 0 ? (
                        searchResults.map((result) => (
                          <div
                            key={result.documentId}
                            className={`border rounded-md overflow-hidden ${
                              result.selected ? 'border-primary' : ''
                            }`}
                          >
                            <div
                              className="p-4 cursor-pointer"
                              onClick={() => toggleResultExpansion(result.documentId)}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-start space-x-3">
                                  <Checkbox
                                    checked={result.selected}
                                    onCheckedChange={() => toggleResultSelection(result.documentId)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <div>
                                    <h3 className="font-medium">{result.title}</h3>
                                    <p className="text-sm text-muted-foreground">
                                      {result.type} • Relevance: {result.relevance.toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center">
                                  {result.expanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </div>
                              </div>
                              <p className="mt-2 text-sm line-clamp-2">
                                {result.content.substring(0, 200)}...
                              </p>
                            </div>
                            
                            {result.expanded && (
                              <div className="p-4 pt-0 border-t">
                                <ScrollArea className="h-[200px]">
                                  <div className="p-2">
                                    <p className="text-sm whitespace-pre-line">
                                      {result.content}
                                    </p>
                                  </div>
                                </ScrollArea>
                              </div>
                            )}
                          </div>
                        ))
                      ) : knowledgeQuery ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No results found</p>
                          <p className="text-xs mt-1">
                            Try a different search query
                          </p>
                        </div>
                      ) : (
                        <div className="text-center py-8 text-muted-foreground">
                          <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>Search your knowledge base</p>
                          <p className="text-xs mt-1">
                            Enter a query to find relevant information
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          {/* Tasks Tab Content */}
          <TabsContent value="tasks" className="space-y-4">
            {!isApiKeySet ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Key Required
                  </CardTitle>
                  <CardDescription>
                    Please set your OpenAI API key to use the task management features.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={() => setShowSettings(true)} className="w-full">
                    Open Settings
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CheckSquare className="h-5 w-5" />
                      Task Management
                    </span>
                    <Button onClick={() => setShowNewTaskForm(true)}>
                      <PlusCircle className="h-4 w-4 mr-2" />
                      New Task
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    Manage your tasks and track progress on your projects.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Task Filters */}
                  <div className="flex items-center space-x-2 mb-4">
                    <Select
                      value={taskFilter.status?.join(',') || ''}
                      onValueChange={(value) => {
                        setTaskFilter(prev => ({
                          ...prev,
                          status: value ? value.split(',') as any : undefined
                        }));
                        loadTasks();
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All Statuses</SelectItem>
                        <SelectItem value="todo">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="done">Done</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Select
                      value={taskFilter.priority?.join(',') || ''}
                      onValueChange={(value) => {
                        setTaskFilter(prev => ({
                          ...prev,
                          priority: value ? value.split(',') as any : undefined
                        }));
                        loadTasks();
                      }}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Filter by priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All Priorities</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {projects.length > 0 && (
                      <Select
                        value={taskFilter.projectId || ''}
                        onValueChange={(value) => {
                          setTaskFilter(prev => ({
                            ...prev,
                            projectId: value || undefined
                          }));
                          loadTasks();
                        }}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by project" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All Projects</SelectItem>
                          {projects.map(project => (
                            <SelectItem key={project.id} value={project.id}>
                              {project.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={loadTasks}
                      title="Refresh Tasks"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoadingTasks ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  
                  {/* New Task Form */}
                  {showNewTaskForm && (
                    <Card className="mb-4 border border-primary">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-md">New Task</CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-2">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="task-description">Description</Label>
                            <Input
                              id="task-description"
                              value={newTaskForm.description}
                              onChange={(e) => setNewTaskForm(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="Enter task description"
                            />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="task-status">Status</Label>
                              <Select
                                value={newTaskForm.status}
                                onValueChange={(value: any) => setNewTaskForm(prev => ({ ...prev, status: value }))}
                              >
                                <SelectTrigger id="task-status">
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="todo">To Do</SelectItem>
                                  <SelectItem value="in_progress">In Progress</SelectItem>
                                  <SelectItem value="done">Done</SelectItem>
                                  <SelectItem value="cancelled">Cancelled</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            
                            <div className="space-y-2">
                              <Label htmlFor="task-priority">Priority</Label>
                              <Select
                                value={newTaskForm.priority}
                                onValueChange={(value: any) => setNewTaskForm(prev => ({ ...prev, priority: value }))}
                              >
                                <SelectTrigger id="task-priority">
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
                          
                          {projects.length > 0 && (
                            <div className="space-y-2">
                              <Label htmlFor="task-project">Project (Optional)</Label>
                              <Select
                                value={newTaskForm.projectId || ''}
                                onValueChange={(value) => setNewTaskForm(prev => ({ ...prev, projectId: value || undefined }))}
                              >
                                <SelectTrigger id="task-project">
                                  <SelectValue placeholder="Select project" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">No Project</SelectItem>
                                  {projects.map(project => (
                                    <SelectItem key={project.id} value={project.id}>
                                      {project.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="p-4 pt-2 flex justify-between">
                        <Button variant="outline" onClick={() => setShowNewTaskForm(false)}>
                          Cancel
                        </Button>
                        <Button onClick={createTask} disabled={!newTaskForm.description}>
                          Create Task
                        </Button>
                      </CardFooter>
                    </Card>
                  )}
                  
                  {/* Task List */}
                  <div className="space-y-2">
                    {tasks.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No tasks found</p>
                        <p className="text-xs mt-1">
                          Create a new task to get started
                        </p>
                      </div>
                    ) : (
                      tasks.map(task => (
                        <div
                          key={task.id}
                          className="border rounded-md p-4 hover:bg-accent transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start space-x-3">
                              <Checkbox
                                checked={task.status === 'done'}
                                onCheckedChange={(checked) => {
                                  updateTask(task.id, {
                                    status: checked ? 'done' : 'todo'
                                  });
                                }}
                              />
                              <div>
                                <p className={`font-medium ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>
                                  {task.description}
                                </p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <Badge
                                    variant={
                                      task.priority === 'urgent' ? 'destructive' :
                                      task.priority === 'high' ? 'default' :
                                      task.priority === 'medium' ? 'secondary' : 'outline'
                                    }
                                  >
                                    {task.priority}
                                  </Badge>
                                  
                                  <Badge variant="outline">
                                    {task.status}
                                  </Badge>
                                  
                                  {task.projectId && (
                                    <Badge variant="outline" className="bg-primary/10">
                                      {projects.find(p => p.id === task.projectId)?.name || 'Unknown Project'}
                                    </Badge>
                                  )}
                                  
                                  {task.dueDate && (
                                    <span className={`text-xs ${
                                      new Date() > task.dueDate ? 'text-red-500' : 'text-muted-foreground'
                                    }`}>
                                      Due: {format(task.dueDate, 'MMM d, yyyy')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => updateTask(task.id, { status: 'in_progress' })}>
                                  Mark as In Progress
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => updateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done' })}>
                                  Mark as {task.status === 'done' ? 'To Do' : 'Done'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => deleteTask(task.id)} className="text-red-500">
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
                </CardContent>
              </Card>
            )}
          </TabsContent>
          
          {/* Meetings Tab Content */}
          <TabsContent value="meetings" className="space-y-4">
            {!isApiKeySet ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Key Required
                  </CardTitle>
                  <CardDescription>
                    Please set your OpenAI API key to use the meeting features.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={() => setShowSettings(true)} className="w-full">
                    Open Settings
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Meeting Summarizer */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Meeting Summarizer
                    </CardTitle>
                    <CardDescription>
                      Upload a meeting transcript or paste meeting notes to generate a concise summary.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid w-full items-center gap-1.5">
                        <label htmlFor="meeting-file" className="text-sm font-medium">
                          Upload Meeting Transcript
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="meeting-file"
                            type="file"
                            accept=".txt,.md,.doc,.docx"
                            className="hidden"
                            onChange={handleFileUpload}
                            ref={fileInputRef}
                          />
                          <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full h-24 flex flex-col items-center justify-center border-dashed"
                          >
                            <FileUp className="h-6 w-6 mb-2" />
                            <span>Click to upload or drag and drop</span>
                            <span className="text-xs text-muted-foreground mt-1">
                              Supports TXT, MD, DOC, DOCX
                            </span>
                          </Button>
                          {uploadedFileName && (
                            <Badge variant="outline" className="ml-2">
                              {uploadedFileName}
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <Separator className="my-4" />
                      
                      <div className="grid w-full gap-1.5">
                        <label htmlFor="meeting-text" className="text-sm font-medium">
                          Or Paste Meeting Notes
                        </label>
                        <Textarea
                          id="meeting-text"
                          placeholder="Paste your meeting transcript or notes here..."
                          value={meetingText}
                          onChange={(e) => setMeetingText(e.target.value)}
                          className="min-h-[200px]"
                        />
                        {summaryError && (
                          <p className="text-xs text-red-500 mt-1">{summaryError}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      onClick={generateSummary}
                      disabled={!meetingText.trim() || isSummarizing}
                      className="w-full"
                    >
                      {isSummarizing