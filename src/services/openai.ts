import OpenAI from 'openai';

// Message types
export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: Date;
}

export interface ChatRequest {
  messages: { role: Role; content: string }[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface SummaryResult {
  original: string;
  summary: string;
  keyPoints: string[];
  timestamp: Date;
}

// Error types
export class OpenAIServiceError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = 'OpenAIServiceError';
  }
}

export class APIKeyError extends OpenAIServiceError {
  constructor(message: string = 'Invalid or missing API key') {
    super(message);
    this.name = 'APIKeyError';
  }
}

export class RateLimitError extends OpenAIServiceError {
  constructor(message: string = 'Rate limit exceeded', originalError?: any) {
    super(message, originalError);
    this.name = 'RateLimitError';
  }
}

// OpenAI service
export class OpenAIService {
  private client: OpenAI | null = null;
  private retryCount = 3;
  private retryDelay = 1000; // ms
  private defaultModel = 'gpt-4o';

  constructor(apiKey?: string) {
    if (apiKey) {
      this.initialize(apiKey);
    }
  }

  // Initialize the OpenAI client with API key
  public initialize(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new APIKeyError();
    }

    try {
      this.client = new OpenAI({
        apiKey: apiKey.trim(),
        dangerouslyAllowBrowser: true // Required for client-side usage
      });
    } catch (error) {
      throw new OpenAIServiceError('Failed to initialize OpenAI client', error);
    }
  }

  // Check if client is initialized
  private ensureClient(): void {
    if (!this.client) {
      throw new APIKeyError('OpenAI client is not initialized. Please provide a valid API key.');
    }
  }

  // Retry mechanism for API calls
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on auth errors or invalid requests
        if (error?.status === 401 || error?.status === 400) {
          break;
        }
        
        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Handle specific error types
    if (lastError?.status === 401) {
      throw new APIKeyError('Invalid API key or unauthorized access');
    } else if (lastError?.status === 429) {
      throw new RateLimitError('OpenAI API rate limit exceeded', lastError);
    }
    
    throw new OpenAIServiceError('Failed to complete OpenAI request after retries', lastError);
  }

  // Send chat messages to ChatGPT
  public async sendChatMessage(
    messages: { role: Role; content: string }[],
    options: { model?: string; temperature?: number; max_tokens?: number } = {}
  ): Promise<string> {
    this.ensureClient();
    
    const model = options.model || this.defaultModel;
    const temperature = options.temperature ?? 0.7;
    const max_tokens = options.max_tokens ?? 1000;
    
    try {
      const response = await this.withRetry(() => 
        this.client!.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens,
        })
      );
      
      return response.choices[0]?.message?.content || 'No response generated';
    } catch (error) {
      if (error instanceof OpenAIServiceError) {
        throw error;
      }
      throw new OpenAIServiceError('Failed to get chat completion', error);
    }
  }

  // Summarize meeting transcript
  public async summarizeMeeting(transcript: string): Promise<SummaryResult> {
    this.ensureClient();
    
    try {
      // First request: Generate summary
      const summaryPrompt = [
        { 
          role: 'system' as Role, 
          content: 'You are a professional meeting summarizer. Create a concise summary of the following meeting transcript. Focus on key decisions, action items, and important discussions.'
        },
        { 
          role: 'user' as Role, 
          content: transcript 
        }
      ];
      
      const summaryResponse = await this.withRetry(() => 
        this.client!.chat.completions.create({
          model: this.defaultModel,
          messages: summaryPrompt,
          temperature: 0.3,
          max_tokens: 500,
        })
      );
      
      // Second request: Extract key points
      const keyPointsPrompt = [
        { 
          role: 'system' as Role, 
          content: 'Extract exactly 5 key points from this meeting transcript. Format each as a concise, actionable bullet point. Focus on decisions, action items, and important information.'
        },
        { 
          role: 'user' as Role, 
          content: transcript 
        }
      ];
      
      const keyPointsResponse = await this.withRetry(() => 
        this.client!.chat.completions.create({
          model: this.defaultModel,
          messages: keyPointsPrompt,
          temperature: 0.3,
          max_tokens: 500,
        })
      );
      
      // Process key points into an array
      const keyPointsText = keyPointsResponse.choices[0]?.message?.content || '';
      const keyPoints = keyPointsText
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim()))
        .map(line => line.replace(/^[-•\d.]+\s*/, '').trim())
        .filter(point => point.length > 0);
      
      return {
        original: transcript,
        summary: summaryResponse.choices[0]?.message?.content || 'No summary generated',
        keyPoints: keyPoints.length > 0 ? keyPoints : ['No key points identified'],
        timestamp: new Date()
      };
    } catch (error) {
      if (error instanceof OpenAIServiceError) {
        throw error;
      }
      throw new OpenAIServiceError('Failed to summarize meeting', error);
    }
  }
  
  // Test API key validity
  public async testApiKey(): Promise<boolean> {
    this.ensureClient();
    
    try {
      await this.withRetry(() => 
        this.client!.chat.completions.create({
          model: 'gpt-3.5-turbo', // Use cheaper model for testing
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        })
      );
      return true;
    } catch (error) {
      if (error instanceof APIKeyError) {
        throw error;
      }
      return false;
    }
  }
}

// Create singleton instance
let openAIServiceInstance: OpenAIService | null = null;

// Get or create OpenAI service instance
export const getOpenAIService = (apiKey?: string): OpenAIService => {
  if (!openAIServiceInstance) {
    openAIServiceInstance = new OpenAIService(apiKey);
  } else if (apiKey) {
    openAIServiceInstance.initialize(apiKey);
  }
  
  return openAIServiceInstance;
};

export default getOpenAIService;
