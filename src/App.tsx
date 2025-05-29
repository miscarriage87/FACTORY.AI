import { useState, useEffect, useRef } from 'react';
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
  AlertTriangle
} from 'lucide-react';
import getOpenAIService, { 
  Message as OpenAIMessage, 
  APIKeyError, 
  RateLimitError, 
  OpenAIServiceError 
} from './services/openai';

// Message type definition
type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
};

// Summary type definition
type Summary = {
  original: string;
  summary: string;
  keyPoints: string[];
  timestamp: Date;
};

function App() {
  // Tab state
  const [activeTab, setActiveTab] = useState('chat');
  
  // Chat states
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: 'Welcome to AI Chat! I\'m here to assist you with any questions or tasks.',
      timestamp: new Date()
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  
  // Meeting summarizer states
  const [meetingText, setMeetingText] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom of chat when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);
  
  // Check for saved API key in localStorage
  useEffect(() => {
    const savedApiKey = localStorage.getItem('openai-api-key');
    if (savedApiKey) {
      setApiKey(savedApiKey);
      setIsApiKeySet(true);
      
      // Initialize OpenAI service with saved key
      try {
        const openAIService = getOpenAIService(savedApiKey);
        // Test the API key validity silently
        openAIService.testApiKey().catch(() => {
          // If the key is invalid, we'll handle it when the user tries to use it
          console.warn('Saved API key may be invalid');
        });
      } catch (error) {
        console.warn('Failed to initialize OpenAI service with saved key');
      }
    }
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
    } catch (error) {
      if (error instanceof APIKeyError) {
        setApiKeyError('Invalid API key. Please check and try again.');
      } else {
        setApiKeyError('Failed to validate API key. Please try again.');
        console.error('API key validation error:', error);
      }
    }
  };
  
  // Function to handle sending a message
  const sendMessage = async () => {
    if (!inputMessage.trim() || !isApiKeySet) return;
    
    // Create a new user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date()
    };
    
    // Update messages with user message
    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsChatLoading(true);
    
    try {
      // Get OpenAI service
      const openAIService = getOpenAIService();
      
      // Prepare conversation history for context
      const conversationHistory = messages
        .filter(msg => msg.role !== 'system' || messages.indexOf(msg) === 0) // Include only the first system message
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      
      // Add the new user message
      conversationHistory.push({
        role: userMessage.role,
        content: userMessage.content
      });
      
      // Get response from OpenAI
      const response = await openAIService.sendChatMessage(conversationHistory);
      
      // Create assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };
      
      // Update messages with assistant response
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to get response:', error);
      
      // Create appropriate error message based on error type
      let errorMessage = 'Sorry, I encountered an error processing your request. Please try again later.';
      
      if (error instanceof APIKeyError) {
        errorMessage = 'Your API key appears to be invalid. Please check your settings and update your API key.';
      } else if (error instanceof RateLimitError) {
        errorMessage = 'You\'ve reached the rate limit for API requests. Please wait a moment and try again.';
      }
      
      // Add error message
      const errorAssistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, errorAssistantMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };
  
  // Function to handle file upload
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
  
  return (
    <div className="flex min-h-screen bg-background p-4">
      <div className="w-full max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-center space-x-2 mb-6">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">AI Assistant</h1>
        </div>
        
        <Tabs defaultValue="chat" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              AI Chat
            </TabsTrigger>
            <TabsTrigger value="summarizer" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Meeting Summarizer
            </TabsTrigger>
          </TabsList>
          
          {/* Chat Tab Content */}
          <TabsContent value="chat" className="space-y-4">
            {!isApiKeySet && !showSettings ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Key Required
                  </CardTitle>
                  <CardDescription>
                    Please set your OpenAI API key to use the chat functionality.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={() => setShowSettings(true)} className="w-full">
                    Open Settings
                  </Button>
                </CardFooter>
              </Card>
            ) : showSettings ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Chat Settings
                  </CardTitle>
                  <CardDescription>
                    Configure your OpenAI API key for chat functionality.
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
                <CardFooter className="flex justify-between">
                  <Button variant="outline" onClick={() => {
                    setShowSettings(false);
                    setApiKeyError(null);
                  }}>
                    Cancel
                  </Button>
                  <Button onClick={saveApiKey}>
                    <Save className="h-4 w-4 mr-2" />
                    Save API Key
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card className="h-[70vh] flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <MessageCircle className="h-5 w-5" />
                      AI Chat
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowSettings(true)}
                      title="Settings"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    Chat with an AI assistant powered by OpenAI's GPT models.
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="flex-grow overflow-hidden">
                  <ScrollArea className="h-[calc(70vh-13rem)] pr-4">
                    <div className="space-y-4">
                      {messages.map((message) => (
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
                                    ? 'AI Assistant'
                                    : 'System'}
                                </span>
                              </div>
                              <p className="text-sm">{message.content}</p>
                              <span className="text-xs opacity-70 mt-1 self-end">
                                {message.timestamp.toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>
                </CardContent>
                
                <CardFooter>
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
                      disabled={isChatLoading}
                    />
                    <Button
                      type="submit"
                      disabled={!inputMessage.trim() || isChatLoading}
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
            )}
          </TabsContent>
          
          {/* Meeting Summarizer Tab Content */}
          <TabsContent value="summarizer" className="space-y-4">
            {!isApiKeySet ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Key Required
                  </CardTitle>
                  <CardDescription>
                    Please set your OpenAI API key to use the summarizer functionality.
                  </CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={() => {
                    setShowSettings(true);
                    setActiveTab('chat');
                  }} className="w-full">
                    Open Settings
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <>
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
                      {isSummarizing ? (
                        <span className="flex items-center space-x-2">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span>Summarizing...</span>
                        </span>
                      ) : (
                        <span className="flex items-center space-x-2">
                          <Sparkles className="h-4 w-4" />
                          <span>Generate Summary</span>
                        </span>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
                
                {summary && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5" />
                        Meeting Summary
                      </CardTitle>
                      <CardDescription>
                        Generated on {summary.timestamp.toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-lg font-medium mb-2">Summary</h3>
                          <p className="rounded bg-muted p-3 text-sm">{summary.summary}</p>
                        </div>
                        
                        <div>
                          <h3 className="text-lg font-medium mb-2">Key Points</h3>
                          <ul className="space-y-2">
                            {summary.keyPoints.map((point, index) => (
                              <li key={index} className="flex items-start gap-2">
                                <Badge className="mt-0.5 shrink-0">{index + 1}</Badge>
                                <p className="text-sm">{point}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          // Copy to clipboard
                          const summaryText = `# Meeting Summary\n\n${summary.summary}\n\n# Key Points\n\n${summary.keyPoints.map((point, i) => `${i+1}. ${point}`).join('\n')}`;
                          navigator.clipboard.writeText(summaryText)
                            .then(() => alert('Summary copied to clipboard!'))
                            .catch(() => alert('Failed to copy summary. Please try again.'));
                        }}
                        className="w-full"
                      >
                        Copy Summary
                      </Button>
                    </CardFooter>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
        
        <p className="text-center text-sm text-muted-foreground">
          Powered by Tauri, React, TypeScript, and OpenAI
        </p>
      </div>
    </div>
  );
}

export default App;
