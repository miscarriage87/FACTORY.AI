import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import { fileTypeFromBuffer } from 'file-type';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/knowledgeBase';
import { eq, like, and, or } from 'drizzle-orm';
import { pipeline } from '@xenova/transformers';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import mammoth from 'mammoth';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import CryptoJS from 'crypto-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { format, parseISO } from 'date-fns';
import { watch } from 'fs';
import { promisify } from 'util';
import { lookup } from 'mime-types';

// Type definitions
export type DocumentType = 'pdf' | 'excel' | 'csv' | 'word' | 'text' | 'markdown' | 'unknown';

export interface DocumentMetadata {
  id: string;
  title: string;
  path: string;
  type: DocumentType;
  size: number;
  created: Date;
  modified: Date;
  indexed: Date;
  author?: string;
  tags?: string[];
  summary?: string;
  keyPoints?: string[];
  pageCount?: number;
  wordCount?: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  embedding?: number[];
  metadata?: Record<string, any>;
}

export interface SearchResult {
  documentId: string;
  title: string;
  path: string;
  type: DocumentType;
  relevance: number;
  snippet: string;
  metadata: Partial<DocumentMetadata>;
}

export interface IndexingProgress {
  total: number;
  processed: number;
  failed: number;
  status: 'idle' | 'indexing' | 'paused' | 'completed' | 'error';
  error?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: 'document' | 'concept' | 'person' | 'topic';
  weight: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

// Error types
export class KnowledgeBaseError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = 'KnowledgeBaseError';
  }
}

export class FileProcessingError extends KnowledgeBaseError {
  constructor(message: string, public filePath: string, originalError?: any) {
    super(`Error processing file ${filePath}: ${message}`, originalError);
    this.name = 'FileProcessingError';
  }
}

export class DatabaseError extends KnowledgeBaseError {
  constructor(message: string, originalError?: any) {
    super(`Database error: ${message}`, originalError);
    this.name = 'DatabaseError';
  }
}

export class EmbeddingError extends KnowledgeBaseError {
  constructor(message: string, originalError?: any) {
    super(`Embedding error: ${message}`, originalError);
    this.name = 'EmbeddingError';
  }
}

// Main Knowledge Base Service
export class KnowledgeBaseService {
  private db: Database.Database;
  private drizzleDb: ReturnType<typeof drizzle>;
  private embeddingModel: any;
  private vectorStore: Pinecone | null = null;
  private indexingProgress: IndexingProgress = {
    total: 0,
    processed: 0,
    failed: 0,
    status: 'idle'
  };
  private watchers: Map<string, any> = new Map();
  private dbPath: string;
  private storagePath: string;
  private initialized: boolean = false;
  private chunkSize: number = 1000;
  private chunkOverlap: number = 200;
  private maxConcurrentProcessing: number = 5;
  
  constructor(options: {
    dbPath?: string;
    storagePath?: string;
    pineconeApiKey?: string;
    pineconeEnvironment?: string;
    pineconeIndex?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    maxConcurrentProcessing?: number;
  } = {}) {
    this.dbPath = options.dbPath || join(process.cwd(), 'knowledge-base.db');
    this.storagePath = options.storagePath || join(process.cwd(), 'knowledge-store');
    this.chunkSize = options.chunkSize || this.chunkSize;
    this.chunkOverlap = options.chunkOverlap || this.chunkOverlap;
    this.maxConcurrentProcessing = options.maxConcurrentProcessing || this.maxConcurrentProcessing;
    
    // Ensure storage directory exists
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
    
    // Initialize database
    this.db = new Database(this.dbPath);
    this.drizzleDb = drizzle(this.db, { schema });
    
    // Initialize Pinecone if credentials provided
    if (options.pineconeApiKey && options.pineconeEnvironment && options.pineconeIndex) {
      this.initVectorStore(options.pineconeApiKey, options.pineconeEnvironment, options.pineconeIndex);
    }
  }
  
  // Initialize the service
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Create database schema if not exists
      this.createSchema();
      
      // Load embedding model
      this.embeddingModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      
      this.initialized = true;
    } catch (error) {
      throw new KnowledgeBaseError('Failed to initialize knowledge base service', error);
    }
  }
  
  // Create database schema
  private createSchema(): void {
    try {
      // Create tables using raw SQL for better control
      // Documents table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created TEXT NOT NULL,
          modified TEXT NOT NULL,
          indexed TEXT NOT NULL,
          author TEXT,
          tags TEXT,
          summary TEXT,
          key_points TEXT,
          page_count INTEGER,
          word_count INTEGER
        )
      `);
      
      // Document chunks table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          content TEXT NOT NULL,
          index_num INTEGER NOT NULL,
          metadata TEXT,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
      `);
      
      // Create full-text search virtual tables
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
          title, 
          content, 
          tags,
          summary,
          content='documents',
          content_rowid='rowid'
        )
      `);
      
      // Create indexes for better performance
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
        CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified);
        CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
      `);
      
      // Create triggers to keep FTS index updated
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
          INSERT INTO documents_fts(rowid, title, content, tags, summary) 
          VALUES (new.rowid, new.title, '', COALESCE(new.tags, ''), COALESCE(new.summary, ''));
        END;
        
        CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, content, tags, summary) 
          VALUES('delete', old.rowid, old.title, '', COALESCE(old.tags, ''), COALESCE(old.summary, ''));
        END;
        
        CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
          INSERT INTO documents_fts(documents_fts, rowid, title, content, tags, summary) 
          VALUES('delete', old.rowid, old.title, '', COALESCE(old.tags, ''), COALESCE(old.summary, ''));
          INSERT INTO documents_fts(rowid, title, content, tags, summary) 
          VALUES (new.rowid, new.title, '', COALESCE(new.tags, ''), COALESCE(new.summary, ''));
        END;
      `);
      
      // Create concepts table for knowledge graph
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS concepts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          description TEXT,
          frequency INTEGER DEFAULT 1
        )
      `);
      
      // Create relationships table for knowledge graph
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS relationships (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          relationship_type TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          UNIQUE(source_id, target_id, relationship_type)
        )
      `);
      
    } catch (error) {
      throw new DatabaseError('Failed to create database schema', error);
    }
  }
  
  // Initialize vector store
  private async initVectorStore(apiKey: string, environment: string, indexName: string): Promise<void> {
    try {
      this.vectorStore = new Pinecone({
        apiKey,
        environment
      });
      
      // Check if index exists, create if not
      const indexes = await this.vectorStore.listIndexes();
      const indexExists = indexes.some(idx => idx.name === indexName);
      
      if (!indexExists) {
        await this.vectorStore.createIndex({
          name: indexName,
          dimension: 384,  // dimension for all-MiniLM-L6-v2
          metric: 'cosine'
        });
      }
      
    } catch (error) {
      console.error('Failed to initialize vector store:', error);
      this.vectorStore = null;
    }
  }
  
  // File Processing Engine
  
  // Detect file type from path or buffer
  public async detectFileType(filePathOrBuffer: string | Buffer): Promise<DocumentType> {
    try {
      if (typeof filePathOrBuffer === 'string') {
        const ext = extname(filePathOrBuffer).toLowerCase();
        
        switch (ext) {
          case '.pdf':
            return 'pdf';
          case '.xlsx':
          case '.xls':
            return 'excel';
          case '.csv':
            return 'csv';
          case '.docx':
          case '.doc':
            return 'word';
          case '.txt':
            return 'text';
          case '.md':
          case '.markdown':
            return 'markdown';
          default:
            // Try to detect from buffer for unknown extensions
            const buffer = readFileSync(filePathOrBuffer);
            const fileType = await fileTypeFromBuffer(buffer);
            
            if (fileType) {
              if (fileType.mime.includes('pdf')) return 'pdf';
              if (fileType.mime.includes('excel') || fileType.mime.includes('spreadsheet')) return 'excel';
              if (fileType.mime.includes('word')) return 'word';
              if (fileType.mime.includes('text')) return 'text';
            }
            
            return 'unknown';
        }
      } else {
        // Buffer provided
        const fileType = await fileTypeFromBuffer(filePathOrBuffer);
        
        if (fileType) {
          if (fileType.mime.includes('pdf')) return 'pdf';
          if (fileType.mime.includes('excel') || fileType.mime.includes('spreadsheet')) return 'excel';
          if (fileType.mime.includes('word')) return 'word';
          if (fileType.mime.includes('text')) return 'text';
        }
        
        return 'unknown';
      }
    } catch (error) {
      console.error('Error detecting file type:', error);
      return 'unknown';
    }
  }
  
  // Process a file and extract its content
  public async processFile(filePath: string): Promise<{ content: string; metadata: Partial<DocumentMetadata> }> {
    try {
      if (!existsSync(filePath)) {
        throw new FileProcessingError('File does not exist', filePath);
      }
      
      const stats = statSync(filePath);
      const fileType = await this.detectFileType(filePath);
      let content = '';
      const metadata: Partial<DocumentMetadata> = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        type: fileType
      };
      
      switch (fileType) {
        case 'pdf':
          const pdfData = await this.processPdf(filePath);
          content = pdfData.content;
          metadata.pageCount = pdfData.pageCount;
          metadata.author = pdfData.author;
          break;
          
        case 'excel':
          content = await this.processExcel(filePath);
          break;
          
        case 'csv':
          content = await this.processCsv(filePath);
          break;
          
        case 'word':
          content = await this.processWord(filePath);
          break;
          
        case 'text':
          content = readFileSync(filePath, 'utf-8');
          break;
          
        case 'markdown':
          content = await this.processMarkdown(filePath);
          break;
          
        default:
          // Try to read as text
          try {
            content = readFileSync(filePath, 'utf-8');
          } catch (e) {
            throw new FileProcessingError('Unsupported file type', filePath);
          }
      }
      
      // Calculate word count
      metadata.wordCount = content.split(/\s+/).filter(Boolean).length;
      
      return { content, metadata };
    } catch (error) {
      if (error instanceof KnowledgeBaseError) {
        throw error;
      }
      throw new FileProcessingError('Failed to process file', filePath, error);
    }
  }
  
  // Process PDF files
  private async processPdf(filePath: string): Promise<{ content: string; pageCount: number; author?: string }> {
    try {
      const dataBuffer = readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      
      return {
        content: data.text,
        pageCount: data.numpages,
        author: data.info?.Author
      };
    } catch (error) {
      throw new FileProcessingError('Failed to process PDF', filePath, error);
    }
  }
  
  // Process Excel files
  private async processExcel(filePath: string): Promise<string> {
    try {
      const workbook = XLSX.readFile(filePath);
      let result = '';
      
      // Process each sheet
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);
        
        result += `# Sheet: ${sheetName}\n\n`;
        
        // Convert to markdown table format
        if (jsonData.length > 0) {
          // Create header
          const headers = Object.keys(jsonData[0]);
          result += '| ' + headers.join(' | ') + ' |\n';
          result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
          
          // Add rows
          for (const row of jsonData) {
            result += '| ' + headers.map(header => (row as any)[header] || '').join(' | ') + ' |\n';
          }
        }
        
        result += '\n\n';
      }
      
      return result;
    } catch (error) {
      throw new FileProcessingError('Failed to process Excel file', filePath, error);
    }
  }
  
  // Process CSV files
  private async processCsv(filePath: string): Promise<string> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const records = csvParse(content, {
        columns: true,
        skip_empty_lines: true
      });
      
      let result = '';
      
      if (records.length > 0) {
        // Create header
        const headers = Object.keys(records[0]);
        result += '| ' + headers.join(' | ') + ' |\n';
        result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
        
        // Add rows
        for (const row of records) {
          result += '| ' + headers.map(header => row[header] || '').join(' | ') + ' |\n';
        }
      }
      
      return result;
    } catch (error) {
      throw new FileProcessingError('Failed to process CSV file', filePath, error);
    }
  }
  
  // Process Word documents
  private async processWord(filePath: string): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch (error) {
      throw new FileProcessingError('Failed to process Word document', filePath, error);
    }
  }
  
  // Process Markdown files
  private async processMarkdown(filePath: string): Promise<string> {
    try {
      const content = readFileSync(filePath, 'utf-8');
      
      // Parse markdown to HTML (useful for extracting structure)
      const processed = await remark()
        .use(remarkHtml)
        .process(content);
      
      // For indexing purposes, we'll just return the original markdown
      return content;
    } catch (error) {
      throw new FileProcessingError('Failed to process Markdown file', filePath, error);
    }
  }
  
  // Document chunking
  public chunkDocument(content: string, metadata: Partial<DocumentMetadata>): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    
    // Simple chunking by paragraphs first
    const paragraphs = content.split(/\n\s*\n/);
    let currentChunk = '';
    let chunkIndex = 0;
    
    for (const paragraph of paragraphs) {
      // Skip empty paragraphs
      if (!paragraph.trim()) continue;
      
      // If adding this paragraph would exceed chunk size, create a new chunk
      if (currentChunk.length + paragraph.length > this.chunkSize && currentChunk.length > 0) {
        chunks.push({
          id: `chunk_${metadata.id}_${chunkIndex}`,
          documentId: metadata.id!,
          content: currentChunk,
          index: chunkIndex,
          metadata: {
            title: metadata.title,
            type: metadata.type
          }
        });
        
        // Start new chunk with overlap
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(Math.max(0, words.length - this.chunkOverlap)).join(' ');
        currentChunk = overlapWords + ' ' + paragraph;
        chunkIndex++;
      } else {
        // Add paragraph to current chunk
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    
    // Add the last chunk if not empty
    if (currentChunk.trim()) {
      chunks.push({
        id: `chunk_${metadata.id}_${chunkIndex}`,
        documentId: metadata.id!,
        content: currentChunk,
        index: chunkIndex,
        metadata: {
          title: metadata.title,
          type: metadata.type
        }
      });
    }
    
    return chunks;
  }
  
  // Generate embeddings for text
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingModel) {
      await this.initialize();
    }
    
    try {
      // Truncate text if too long (model specific limit)
      const truncatedText = text.slice(0, 8192);
      
      const output = await this.embeddingModel(truncatedText, {
        pooling: 'mean',
        normalize: true
      });
      
      // Convert to array of numbers
      return Array.from(output.data);
    } catch (error) {
      throw new EmbeddingError('Failed to generate embedding', error);
    }
  }
  
  // Index a document
  public async indexDocument(filePath: string, options: {
    generateEmbeddings?: boolean;
    extractKeyPoints?: boolean;
    generateSummary?: boolean;
    tags?: string[];
  } = {}): Promise<string> {
    try {
      // Process file to extract content and metadata
      const { content, metadata } = await this.processFile(filePath);
      
      // Generate document ID
      const documentId = CryptoJS.SHA256(filePath).toString();
      
      // Set document metadata
      const documentMetadata: DocumentMetadata = {
        id: documentId,
        title: basename(filePath),
        path: filePath,
        type: metadata.type || 'unknown',
        size: metadata.size || 0,
        created: metadata.created || new Date(),
        modified: metadata.modified || new Date(),
        indexed: new Date(),
        pageCount: metadata.pageCount,
        wordCount: metadata.wordCount,
        tags: options.tags || []
      };
      
      // Generate summary if requested
      if (options.generateSummary) {
        documentMetadata.summary = await this.generateSummary(content);
      }
      
      // Extract key points if requested
      if (options.extractKeyPoints) {
        documentMetadata.keyPoints = await this.extractKeyPoints(content);
      }
      
      // Save document metadata to database
      this.saveDocumentMetadata(documentMetadata);
      
      // Chunk document
      const chunks = this.chunkDocument(content, documentMetadata);
      
      // Generate embeddings and save chunks
      for (const chunk of chunks) {
        if (options.generateEmbeddings) {
          try {
            chunk.embedding = await this.generateEmbedding(chunk.content);
            
            // Store embedding in vector database if available
            if (this.vectorStore) {
              const index = this.vectorStore.index('documents');
              await index.upsert([{
                id: chunk.id,
                values: chunk.embedding,
                metadata: {
                  documentId: chunk.documentId,
                  chunkIndex: chunk.index,
                  title: documentMetadata.title,
                  path: documentMetadata.path,
                  type: documentMetadata.type
                }
              }]);
            }
          } catch (error) {
            console.error(`Failed to generate embedding for chunk ${chunk.id}:`, error);
          }
        }
        
        // Save chunk to database
        this.saveDocumentChunk(chunk);
      }
      
      // Extract concepts and build knowledge graph
      await this.extractConcepts(content, documentId);
      
      return documentId;
    } catch (error) {
      if (error instanceof KnowledgeBaseError) {
        throw error;
      }
      throw new KnowledgeBaseError(`Failed to index document ${filePath}`, error);
    }
  }
  
  // Save document metadata to database
  private saveDocumentMetadata(metadata: DocumentMetadata): void {
    try {
      // Check if document already exists
      const existingDoc = this.db.prepare('SELECT id FROM documents WHERE id = ?').get(metadata.id);
      
      if (existingDoc) {
        // Update existing document
        this.db.prepare(`
          UPDATE documents SET
            title = ?,
            path = ?,
            type = ?,
            size = ?,
            created = ?,
            modified = ?,
            indexed = ?,
            author = ?,
            tags = ?,
            summary = ?,
            key_points = ?,
            page_count = ?,
            word_count = ?
          WHERE id = ?
        `).run(
          metadata.title,
          metadata.path,
          metadata.type,
          metadata.size,
          metadata.created.toISOString(),
          metadata.modified.toISOString(),
          metadata.indexed.toISOString(),
          metadata.author || null,
          metadata.tags ? JSON.stringify(metadata.tags) : null,
          metadata.summary || null,
          metadata.keyPoints ? JSON.stringify(metadata.keyPoints) : null,
          metadata.pageCount || null,
          metadata.wordCount || null,
          metadata.id
        );
      } else {
        // Insert new document
        this.db.prepare(`
          INSERT INTO documents (
            id, title, path, type, size, created, modified, indexed,
            author, tags, summary, key_points, page_count, word_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          metadata.id,
          metadata.title,
          metadata.path,
          metadata.type,
          metadata.size,
          metadata.created.toISOString(),
          metadata.modified.toISOString(),
          metadata.indexed.toISOString(),
          metadata.author || null,
          metadata.tags ? JSON.stringify(metadata.tags) : null,
          metadata.summary || null,
          metadata.keyPoints ? JSON.stringify(metadata.keyPoints) : null,
          metadata.pageCount || null,
          metadata.wordCount || null
        );
      }
      
      // Update FTS content
      this.db.prepare(`
        INSERT INTO documents_fts(documents_fts, rowid, title, content, tags, summary) 
        VALUES('delete', (SELECT rowid FROM documents WHERE id = ?), '', '', '', '')
      `).run(metadata.id);
      
      this.db.prepare(`
        INSERT INTO documents_fts(rowid, title, content, tags, summary) 
        SELECT rowid, title, '', 
          COALESCE(tags, ''), 
          COALESCE(summary, '') 
        FROM documents WHERE id = ?
      `).run(metadata.id);
      
    } catch (error) {
      throw new DatabaseError(`Failed to save document metadata for ${metadata.id}`, error);
    }
  }
  
  // Save document chunk to database
  private saveDocumentChunk(chunk: DocumentChunk): void {
    try {
      // Check if chunk already exists
      const existingChunk = this.db.prepare('SELECT id FROM document_chunks WHERE id = ?').get(chunk.id);
      
      if (existingChunk) {
        // Update existing chunk
        this.db.prepare(`
          UPDATE document_chunks SET
            document_id = ?,
            content = ?,
            index_num = ?,
            metadata = ?
          WHERE id = ?
        `).run(
          chunk.documentId,
          chunk.content,
          chunk.index,
          chunk.metadata ? JSON.stringify(chunk.metadata) : null,
          chunk.id
        );
      } else {
        // Insert new chunk
        this.db.prepare(`
          INSERT INTO document_chunks (
            id, document_id, content, index_num, metadata
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          chunk.id,
          chunk.documentId,
          chunk.content,
          chunk.index,
          chunk.metadata ? JSON.stringify(chunk.metadata) : null
        );
      }
      
      // Update FTS content
      this.db.prepare(`
        UPDATE documents_fts SET content = content || ? 
        WHERE rowid = (SELECT rowid FROM documents WHERE id = ?)
      `).run(chunk.content + ' ', chunk.documentId);
      
    } catch (error) {
      throw new DatabaseError(`Failed to save document chunk ${chunk.id}`, error);
    }
  }
  
  // Generate summary for document content
  private async generateSummary(content: string): Promise<string> {
    // For very long documents, we'll summarize in chunks and then combine
    if (content.length > 10000) {
      const chunks = this.splitTextIntoChunks(content, 10000, 0);
      const summaries = [];
      
      for (const chunk of chunks) {
        try {
          // Use OpenAI for summarization
          const openAIService = await import('./openai').then(module => module.default());
          const messages = [
            { 
              role: 'system', 
              content: 'You are a document summarization assistant. Create a concise summary of the following document excerpt. Focus on key information, main points, and important details.' 
            },
            { role: 'user', content: chunk }
          ];
          
          const summary = await openAIService.sendChatMessage(messages, {
            model: 'gpt-3.5-turbo',
            temperature: 0.3,
            max_tokens: 500
          });
          
          summaries.push(summary);
        } catch (error) {
          console.error('Failed to generate summary for chunk:', error);
          // Return a simple extraction-based summary as fallback
          return this.extractiveSummary(content);
        }
      }
      
      // Combine chunk summaries
      if (summaries.length > 1) {
        try {
          const openAIService = await import('./openai').then(module => module.default());
          const combinedContent = 'Document summary parts:\n\n' + summaries.join('\n\n');
          const messages = [
            { 
              role: 'system', 
              content: 'You are a document summarization assistant. Create a unified, coherent summary from these partial document summaries. Eliminate redundancy and create a flowing narrative.' 
            },
            { role: 'user', content: combinedContent }
          ];
          
          return await openAIService.sendChatMessage(messages, {
            model: 'gpt-3.5-turbo',
            temperature: 0.3,
            max_tokens: 500
          });
        } catch (error) {
          console.error('Failed to combine summaries:', error);
          // Return concatenated summaries as fallback
          return summaries.join('\n\n');
        }
      } else {
        return summaries[0] || this.extractiveSummary(content);
      }
    } else {
      try {
        // Use OpenAI for summarization
        const openAIService = await import('./openai').then(module => module.default());
        const messages = [
          { 
            role: 'system', 
            content: 'You are a document summarization assistant. Create a concise summary of the following document. Focus on key information, main points, and important details.' 
          },
          { role: 'user', content }
        ];
        
        return await openAIService.sendChatMessage(messages, {
          model: 'gpt-3.5-turbo',
          temperature: 0.3,
          max_tokens: 500
        });
      } catch (error) {
        console.error('Failed to generate summary:', error);
        // Return a simple extraction-based summary as fallback
        return this.extractiveSummary(content);
      }
    }
  }
  
  // Extract key points from document content
  private async extractKeyPoints(content: string): Promise<string[]> {
    try {
      // Use OpenAI to extract key points
      const openAIService = await import('./openai').then(module => module.default());
      const messages = [
        { 
          role: 'system', 
          content: 'You are a document analysis assistant. Extract exactly 5 key points from the following document. Format each as a concise, informative bullet point. Focus on the most important information, insights, and takeaways.' 
        },
        { role: 'user', content }
      ];
      
      const response = await openAIService.sendChatMessage(messages, {
        model: 'gpt-3.5-turbo',
        temperature: 0.3,
        max_tokens: 500
      });
      
      // Process response to extract bullet points
      const keyPoints = response
        .split('\n')
        .filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim()))
        .map(line => line.replace(/^[-•\d.]+\s*/, '').trim())
        .filter(point => point.length > 0);
      
      return keyPoints.length > 0 ? keyPoints : this.extractiveKeyPoints(content);
    } catch (error) {
      console.error('Failed to extract key points:', error);
      // Return simple extractive key points as fallback
      return this.extractiveKeyPoints(content);
    }
  }
  
  // Extractive summary as fallback
  private extractiveSummary(content: string): string {
    // Simple extractive summarization by selecting important sentences
    const sentences = content.split(/(?<=[.!?])\s+/);
    
    if (sentences.length <= 5) {
      return content;
    }
    
    // Select sentences based on position and keywords
    const importantSentences = [];
    const keywordRegex = /important|significant|key|critical|essential|main|primary|crucial|vital|fundamental/i;
    
    // Take first 2 sentences
    importantSentences.push(...sentences.slice(0, 2));
    
    // Take sentences with keywords
    for (let i = 2; i < sentences.length - 2; i++) {
      if (keywordRegex.test(sentences[i]) && importantSentences.length < 8) {
        importantSentences.push(sentences[i]);
      }
    }
    
    // Take last 2 sentences
    importantSentences.push(...sentences.slice(-2));
    
    return importantSentences.join(' ');
  }
  
  // Extractive key points as fallback
  private extractiveKeyPoints(content: string): string[] {
    const sentences = content.split(/(?<=[.!?])\s+/);
    const keyPoints = [];
    
    // Look for sentences with indicators of importance
    const keywordRegex = /important|significant|key|critical|essential|main|primary|crucial|vital|fundamental|note that|remember|consider/i;
    
    for (const sentence of sentences) {
      if (keywordRegex.test(sentence) && keyPoints.length < 5) {
        keyPoints.push(sentence.trim());
      }
    }
    
    // If we don't have enough, add sentences from beginning and end
    if (keyPoints.length < 5 && sentences.length > 0) {
      if (!keyPoints.includes(sentences[0].trim())) {
        keyPoints.push(sentences[0].trim());
      }
      
      if (sentences.length > 1 && !keyPoints.includes(sentences[sentences.length - 1].trim())) {
        keyPoints.push(sentences[sentences.length - 1].trim());
      }
    }
    
    // Still need more? Add some from the middle
    if (keyPoints.length < 5 && sentences.length > 4) {
      const middleIndex = Math.floor(sentences.length / 2);
      if (!keyPoints.includes(sentences[middleIndex].trim())) {
        keyPoints.push(sentences[middleIndex].trim());
      }
    }
    
    return keyPoints.slice(0, 5);
  }
  
  // Split text into chunks for processing
  private splitTextIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;
      
      if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk);
        
        // Start new chunk with overlap
        if (overlap > 0) {
          const words = currentChunk.split(' ');
          const overlapWords = words.slice(Math.max(0, words.length - overlap)).join(' ');
          currentChunk = overlapWords + ' ' + paragraph;
        } else {
          currentChunk = paragraph;
        }
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }
  
  // Extract concepts from document for knowledge graph
  private async extractConcepts(content: string, documentId: string): Promise<void> {
    try {
      // Use OpenAI to extract concepts
      const openAIService = await import('./openai').then(module => module.default());
      
      // For very long documents, process in chunks
      if (content.length > 10000) {
        const chunks = this.splitTextIntoChunks(content, 10000, 0);
        
        for (const chunk of chunks) {
          await this.processConceptsChunk(chunk, documentId, openAIService);
        }
      } else {
        await this.processConceptsChunk(content, documentId, openAIService);
      }
    } catch (error) {
      console.error('Failed to extract concepts:', error);
      // Continue without concepts if extraction fails
    }
  }
  
  // Process a chunk of text for concept extraction
  private async processConceptsChunk(content: string, documentId: string, openAIService: any): Promise<void> {
    try {
      const messages = [
        { 
          role: 'system', 
          content: `You are a document analysis assistant. Extract key concepts from the following text and classify them into these types:
          1. TOPIC - Main subject areas or domains
          2. CONCEPT - Important ideas, theories, or frameworks
          3. PERSON - Names of individuals or organizations
          
          Format your response as a JSON array with objects containing "name", "type", and "description" fields.
          Example: [{"name": "Machine Learning", "type": "TOPIC", "description": "Field of AI focused on algorithms that learn from data"}]` 
        },
        { role: 'user', content }
      ];
      
      const response = await openAIService.sendChatMessage(messages, {
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 1000
      });
      
      // Parse JSON response
      try {
        const conceptsData = JSON.parse(response);
        
        if (Array.isArray(conceptsData)) {
          // Begin transaction
          this.db.exec('BEGIN TRANSACTION');
          
          for (const concept of conceptsData) {
            if (!concept.name || !concept.type) continue;
            
            const conceptId = CryptoJS.SHA256(concept.name.toLowerCase()).toString();
            
            // Check if concept exists
            const existingConcept = this.db.prepare('SELECT id, frequency FROM concepts WHERE id = ?').get(conceptId);
            
            if (existingConcept) {
              // Update frequency
              this.db.prepare('UPDATE concepts SET frequency = frequency + 1 WHERE id = ?').run(conceptId);
            } else {
              // Insert new concept
              this.db.prepare(`
                INSERT INTO concepts (id, name, type, description, frequency)
                VALUES (?, ?, ?, ?, 1)
              `).run(
                conceptId,
                concept.name,
                concept.type.toUpperCase(),
                concept.description || null
              );
            }
            
            // Create relationship between document and concept
            const relationshipId = CryptoJS.SHA256(`${documentId}_${conceptId}_CONTAINS`).toString();
            
            this.db.prepare(`
              INSERT OR REPLACE INTO relationships (id, source_id, source_type, target_id, target_type, relationship_type, weight)
              VALUES (?, ?, 'DOCUMENT', ?, ?, 'CONTAINS', ?)
            `).run(
              relationshipId,
              documentId,
              conceptId,
              concept.type.toUpperCase(),
              existingConcept ? existingConcept.frequency + 1 : 1
            );
          }
          
          // Create relationships between concepts
          for (let i = 0; i < conceptsData.length; i++) {
            for (let j = i + 1; j < conceptsData.length; j++) {
              const concept1 = conceptsData[i];
              const concept2 = conceptsData[j];
              
              if (!concept1.name || !concept2.name) continue;
              
              const concept1Id = CryptoJS.SHA256(concept1.name.toLowerCase()).toString();
              const concept2Id = CryptoJS.SHA256(concept2.name.toLowerCase()).toString();
              const relationshipId = CryptoJS.SHA256(`${concept1Id}_${concept2Id}_RELATED`).toString();
              
              // Check if relationship exists
              const existingRelationship = this.db.prepare(
                'SELECT id, weight FROM relationships WHERE id = ?'
              ).get(relationshipId);
              
              if (existingRelationship) {
                // Update weight
                this.db.prepare('UPDATE relationships SET weight = weight + 0.5 WHERE id = ?').run(relationshipId);
              } else {
                // Insert new relationship
                this.db.prepare(`
                  INSERT INTO relationships (id, source_id, source_type, target_id, target_type, relationship_type, weight)
                  VALUES (?, ?, ?, ?, ?, 'RELATED', 1.0)
                `).run(
                  relationshipId,
                  concept1Id,
                  concept1.type.toUpperCase(),
                  concept2Id,
                  concept2.type.toUpperCase()
                );
              }
            }
          }
          
          // Commit transaction
          this.db.exec('COMMIT');
        }
      } catch (jsonError) {
        console.error('Failed to parse concepts JSON:', jsonError);
        this.db.exec('ROLLBACK');
      }
    } catch (error) {
      console.error('Failed to process concepts chunk:', error);
      this.db.exec('ROLLBACK');
    }
  }
  
  // Index a directory of documents
  public async indexDirectory(dirPath: string, options: {
    recursive?: boolean;
    fileTypes?: DocumentType[];
    generateEmbeddings?: boolean;
    extractKeyPoints?: boolean;
    generateSummary?: boolean;
    maxFiles?: number;
    onProgress?: (progress: IndexingProgress) => void;
  } = {}): Promise<IndexingProgress> {
    if (!existsSync(dirPath)) {
      throw new KnowledgeBaseError(`Directory ${dirPath} does not exist`);
    }
    
    this.indexingProgress = {
      total: 0,
      processed: 0,
      failed: 0,
      status: 'indexing',
      startTime: new Date()
    };
    
    try {
      // Get all files in directory
      const files: string[] = [];
      this.getFilesInDirectory(dirPath, files, options.recursive || false);
      
      // Filter by file type if specified
      let filesToProcess = files;
      if (options.fileTypes && options.fileTypes.length > 0) {
        filesToProcess = [];
        for (const file of files) {
          const fileType = await this.detectFileType(file);
          if (options.fileTypes.includes(fileType)) {
            filesToProcess.push(file);
          }
        }
      }
      
      // Limit number of files if specified
      if (options.maxFiles && options.maxFiles > 0) {
        filesToProcess = filesToProcess.slice(0, options.maxFiles);
      }
      
      this.indexingProgress.total = filesToProcess.length;
      
      if (options.onProgress) {
        options.onProgress({ ...this.indexingProgress });
      }
      
      // Process files in batches to avoid memory issues
      const batchSize = this.maxConcurrentProcessing;
      for (let i = 0; i < filesToProcess.length; i += batchSize) {
        const batch = filesToProcess.slice(i, i + batchSize);
        const promises = batch.map(async (file) => {
          try {
            await this.indexDocument(file, {
              generateEmbeddings: options.generateEmbeddings,
              extractKeyPoints: options.extractKeyPoints,
              generateSummary: options.generateSummary
            });
            this.indexingProgress.processed++;
          } catch (error) {
            console.error(`Failed to index ${file}:`, error);
            this.indexingProgress.failed++;
          }
          
          if (options.onProgress) {
            options.onProgress({ ...this.indexingProgress });
          }
        });
        
        await Promise.all(promises);
      }
      
      this.indexingProgress.status = 'completed';
      this.indexingProgress.endTime = new Date();
      
      return { ...this.indexingProgress };
    } catch (error) {
      this.indexingProgress.status = 'error';
      this.indexingProgress.error = error instanceof Error ? error.message : String(error);
      this.indexingProgress.endTime = new Date();
      
      throw new KnowledgeBaseError(`Failed to index directory ${dirPath}`, error);
    }
  }
  
  // Get all files in a directory
  private getFilesInDirectory(dirPath: string, fileList: string[], recursive: boolean): void {
    const files = readdirSync(dirPath);
    
    for (const file of files) {
      const filePath = join(dirPath, file);
      const stats = statSync(filePath);
      
      if (stats.isDirectory() && recursive) {
        this.getFilesInDirectory(filePath, fileList, recursive);
      } else if (stats.isFile()) {
        fileList.push(filePath);
      }
    }
  }
  
  // Watch a directory for changes and update index
  public watchDirectory(dirPath: string, options: {
    recursive?: boolean;
    fileTypes?: DocumentType[];
    generateEmbeddings?: boolean;
    extractKeyPoints?: boolean;
    generateSummary?: boolean;
  } = {}): void {
    if (!existsSync(dirPath)) {
      throw new KnowledgeBaseError(`Directory ${dirPath} does not exist`);
    }
    
    // Stop existing watcher if any
    if (this.watchers.has(dirPath)) {
      const watcher = this.watchers.get(dirPath);
      watcher.close();
      this.watchers.delete(dirPath);
    }
    
    try {
      const watcher = watch(dirPath, { recursive: options.recursive || false }, async (eventType, filename) => {
        if (!filename) return;
        
        const filePath = join(dirPath, filename);
        
        try {
          // Check if file exists and is a file
          if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            return;
          }
          
          // Check file type if specified
          if (options.fileTypes && options.fileTypes.length > 0) {
            const fileType = await this.detectFileType(filePath);
            if (!options.fileTypes.includes(fileType)) {
              return;
            }
          }
          
          // Index or update document
          await this.indexDocument(filePath, {
            generateEmbeddings: options.generateEmbeddings,
            extractKeyPoints: options.extractKeyPoints,
            generateSummary: options.generateSummary
          });
          
          console.log(`Indexed file: ${filePath}`);
        } catch (error) {
          console.error(`Failed to index file ${filePath}:`, error);
        }
      });
      
      this.watchers.set(dirPath, watcher);
    } catch (error) {
      throw new KnowledgeBaseError(`Failed to watch directory ${dirPath}`, error);
    }
  }
  
  // Stop watching a directory
  public stopWatching(dirPath: string): void {
    if (this.watchers.has(dirPath)) {
      const watcher = this.watchers.get(dirPath);
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }
  
  // Stop watching all directories
  public stopAllWatching(): void {
    for (const [dirPath, watcher] of this.watchers.entries()) {
      watcher.close();
      this.watchers.delete(dirPath);
    }
  }
  
  // Search documents by text
  public async searchDocuments(query: string, options: {
    limit?: number;
    offset?: number;
    types?: DocumentType[];
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
    useSemanticSearch?: boolean;
  } = {}): Promise<SearchResult[]> {
    try {
      const limit = options.limit || 10;
      const offset = options.offset || 0;
      
      // If semantic search is requested and we have embeddings capability
      if (options.useSemanticSearch && this.embeddingModel) {
        return this.semanticSearch(query, options);
      }
      
      // Otherwise, use full-text search
      return this.fullTextSearch(query, options);
    } catch (error) {
      throw new KnowledgeBaseError(`Search failed for query: ${query}`, error);
    }
  }
  
  // Full-text search
  private async fullTextSearch(query: string, options: {
    limit?: number;
    offset?: number;
    types?: DocumentType[];
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
  } = {}): Promise<SearchResult[]> {
    try {
      const limit = options.limit || 10;
      const offset = options.offset || 0;
      
      // Build query conditions
      let conditions = [];
      const params: any[] = [];
      
      // Add type filter
      if (options.types && options.types.length > 0) {
        conditions.push(`d.type IN (${options.types.map(() => '?').join(', ')})`);
        params.push(...options.types);
      }
      
      // Add date filters
      if (options.startDate) {
        conditions.push('d.modified >= ?');
        params.push(options.startDate.toISOString());
      }
      
      if (options.endDate) {
        conditions.push('d.modified <= ?');
        params.push(options.endDate.toISOString());
      }
      
      // Add tags filter
      if (options.tags && options.tags.length > 0) {
        // This is a simplification - in reality, you'd need more complex JSON handling
        const tagConditions = options.tags.map(() => `d.tags LIKE ?`);
        conditions.push(`(${tagConditions.join(' OR ')})`);
        params.push(...options.tags.map(tag => `%${tag}%`));
      }
      
      // Build WHERE clause
      const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
      
      // Perform search
      const rows = this.db.prepare(`
        SELECT 
          d.id as documentId,
          d.title,
          d.path,
          d.type,
          d.size,
          d.created,
          d.modified,
          d.indexed,
          d.author,
          d.tags,
          d.summary,
          d.key_points,
          d.page_count,
          d.word_count,
          snippet(documents_fts, 0, '<mark>', '</mark>', '...', 15) as snippet,
          rank
        FROM documents_fts
        JOIN documents d ON documents_fts.rowid = d.rowid
        WHERE documents_fts MATCH ? ${whereClause}
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(query, ...params, limit, offset);
      
      // Process results
      return rows.map(row => ({
        documentId: row.documentId,
        title: row.title,
        path: row.path,
        type: row.type as DocumentType,
        relevance: 1 - (row.rank || 0), // Convert rank to relevance score (0-1)
        snippet: row.snippet || this.extractSnippet(row.summary || '', query),
        metadata: {
          size: row.size,
          created: parseISO(row.created),
          modified: parseISO(row.modified),
          indexed: parseISO(row.indexed),
          author: row.author,
          tags: row.tags ? JSON.parse(row.tags) : [],
          summary: row.summary,
          keyPoints: row.key_points ? JSON.parse(row.key_points) : [],
          pageCount: row.page_count,
          wordCount: row.word_count
        }
      }));
    } catch (error) {
      throw new KnowledgeBaseError(`Full-text search failed for query: ${query}`, error);
    }
  }
  
  // Semantic search using embeddings
  private async semanticSearch(query: string, options: {
    limit?: number;
    offset?: number;
    types?: DocumentType[];
    startDate?: Date;
    endDate?: Date;
    tags?: string[];
  } = {}): Promise<SearchResult[]> {
    try {
      const limit = options.limit || 10;
      
      // Generate embedding for query
      const queryEmbedding = await this.generateEmbedding(query);
      
      if (this.vectorStore) {
        // Use Pinecone for vector search
        const index = this.vectorStore.index('documents');
        
        // Build filter
        const filter: any = {};
        
        if (options.types && options.types.length > 0) {
          filter.type = { $in: options.types };
        }
        
        // Query vector database
        const results = await index.query({
          vector: queryEmbedding,
          topK: limit + (options.offset || 0),
          filter: Object.keys(filter).length > 0 ? filter : undefined,
          includeMetadata: true
        });
        
        // Apply offset
        const offsetResults = results.matches.slice(options.offset || 0);
        
        // Fetch document details from SQLite
        const documentResults: SearchResult[] = [];
        
        for (const match of offsetResults) {
          const documentId = match.metadata?.documentId;
          if (!documentId) continue;
          
          const document = this.db.prepare(`
            SELECT 
              id, title, path, type, size, created, modified, indexed,
              author, tags, summary, key_points, page_count, word_count
            FROM documents
            WHERE id = ?
          `).get(documentId);
          
          if (!document) continue;
          
          // Fetch chunk content for snippet
          const chunk = this.db.prepare(`
            SELECT content FROM document_chunks
            WHERE id = ?
          `).get(match.id);
          
          documentResults.push({
            documentId: document.id,
            title: document.title,
            path: document.path,
            type: document.type as DocumentType,
            relevance: match.score || 0,
            snippet: this.extractSnippet(chunk?.content || document.summary || '', query),
            metadata: {
              size: document.size,
              created: parseISO(document.created),
              modified: parseISO(document.modified),
              indexed: parseISO(document.indexed),
              author: document.author,
              tags: document.tags ? JSON.parse(document.tags) : [],
              summary: document.summary,
              keyPoints: document.key_points ? JSON.parse(document.key_points) : [],
              pageCount: document.page_count,
              wordCount: document.word_count
            }
          });
        }
        
        return documentResults;
      } else {
        // Fallback to in-memory vector search
        // Get all document chunks with embeddings
        const chunks = this.db.prepare(`
          SELECT dc.id, dc.document_id, dc.content, dc.metadata,
            d.title, d.path, d.type, d.size, d.created, d.modified, d.indexed,
            d.author, d.tags, d.summary, d.key_points, d.page_count, d.word_count
          FROM document_chunks dc
          JOIN documents d ON dc.document_id = d.id
          WHERE dc.metadata LIKE '%"embedding":%'
        `).all();
        
        // Filter by type if needed
        let filteredChunks = chunks;
        if (options.types && options.types.length > 0) {
          filteredChunks = chunks.filter(chunk => options.types!.includes(chunk.type as DocumentType));
        }
        
        // Calculate cosine similarity for each chunk
        const results = filteredChunks.map(chunk => {
          try {
            const metadata = JSON.parse(chunk.metadata || '{}');
            const embedding = metadata.embedding;
            
            if (!embedding || !Array.isArray(embedding)) {
              return { chunk, similarity: 0 };
            }
            
            const similarity = this.cosineSimilarity(queryEmbedding, embedding);
            return { chunk, similarity };
          } catch (e) {
            return { chunk, similarity: 0 };
          }
        });
        
        // Sort by similarity and apply pagination
        const sortedResults = results
          .sort((a, b) => b.similarity - a.similarity)
          .slice(options.offset || 0, (options.offset || 0) + limit);
        
        // Format results
        return sortedResults.map(({ chunk, similarity }) => ({
          documentId: chunk.document_id,
          title: chunk.title,
          path: chunk.path,
          type: chunk.type as DocumentType,
          relevance: similarity,
          snippet: this.extractSnippet(chunk.content || chunk.summary || '', query),
          metadata: {
            size: chunk.size,
            created: parseISO(chunk.created),
            modified: parseISO(chunk.modified),
            indexed: parseISO(chunk.indexed),
            author: chunk.author,
            tags: chunk.tags ? JSON.parse(chunk.tags) : [],
            summary: chunk.summary,
            keyPoints: chunk.key_points ? JSON.parse(chunk.key_points) : [],
            pageCount: chunk.page_count,
            wordCount: chunk.word_count
          }
        }));
      }
    } catch (error) {
      throw new KnowledgeBaseError(`Semantic search failed for query: ${query}`, error);
    }
  }
  
  // Calculate cosine similarity between two vectors
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  // Extract a relevant snippet from text
  private extractSnippet(text: string, query: string, maxLength: number = 200): string {
    // Simple snippet extraction
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const textLower = text.toLowerCase();
    
    // Find the first occurrence of any query word
    let bestPos = -1;
    let bestWord = '';
    
    for (const word of words) {
      const pos = textLower.indexOf(word);
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
        bestPos = pos;
        bestWord = word;
      }
    }
    
    if (bestPos === -1) {
      // No match found, return beginning of text
      return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }
    
    // Find a good starting position for the snippet
    const sentenceStart = text.lastIndexOf('.', bestPos);
    const start = sentenceStart !== -1 && bestPos - sentenceStart < 100
      ? sentenceStart + 1
      : Math.max(0, bestPos - 60);
    
    // Extract snippet
    const end = Math.min(text.length, start + maxLength);
    let snippet = text.substring(start, end);
    
    // Add ellipsis if needed
    if (start > 0) {
      snippet = '...' + snippet;
    }
    
    if (end < text.length) {
      snippet = snippet + '...';
    }
    
    // Highlight query terms
    for (const word of words) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      snippet = snippet.replace(regex, match => `<mark>${match}</mark>`);
    }
    
    return snippet;
  }
  
  // Get document by ID
  public getDocument(documentId: string): DocumentMetadata | null {
    try {
      const row = this.db.prepare(`
        SELECT 
          id, title, path, type, size, created, modified, indexed,
          author, tags, summary, key_points, page_count, word_count
        FROM documents
        WHERE id = ?
      `).get(documentId);
      
      if (!row) return null;
      
      return {
        id: row.id,
        title: row.title,
        path: row.path,
        type: row.type as DocumentType,
        size: row.size,
        created: parseISO(row.created),
        modified: parseISO(row.modified),
        indexed: parseISO(row.indexed),
        author: row.author,
        tags: row.tags ? JSON.parse(row.tags) : [],
        summary: row.summary,
        keyPoints: row.key_points ? JSON.parse(row.key_points) : [],
        pageCount: row.page_count,
        wordCount: row.word_count
      };
    } catch (error) {
      throw new DatabaseError(`Failed to get document ${documentId}`, error);
    }
  }
  
  // Get document content
  public getDocumentContent(documentId: string): string {
    try {
      const chunks = this.db.prepare(`
        SELECT content
        FROM document_chunks
        WHERE document_id = ?
        ORDER BY index_num
      `).all(documentId);
      
      return chunks.map(chunk => chunk.content).join('\n\n');
    } catch (error) {
      throw new DatabaseError(`Failed to get content for document ${documentId}`, error);
    }
  }
  
  // Delete document
  public deleteDocument(documentId: string): boolean {
    try {
      // Begin transaction
      this.db.exec('BEGIN TRANSACTION');
      
      // Delete from vector store if available
      if (this.vectorStore) {
        try {
          const index = this.vectorStore.index('documents');
          
          // Get all chunk IDs for this document
          const chunks = this.db.prepare(`
            SELECT id FROM document_chunks
            WHERE document_id = ?
          `).all(documentId);
          
          const chunkIds = chunks.map(chunk => chunk.id);
          
          // Delete vectors in batches
          const batchSize = 100;
          for (let i = 0; i < chunkIds.length; i += batchSize) {
            const batch = chunkIds.slice(i, i + batchSize);
            index.deleteMany(batch);
          }
        } catch (e) {
          console.error('Failed to delete vectors from Pinecone:', e);
          // Continue with local deletion
        }
      }
      
      // Delete relationships
      this.db.prepare(`
        DELETE FROM relationships
        WHERE source_id = ? AND source_type = 'DOCUMENT'
      `).run(documentId);
      
      // Delete document chunks
      this.db.prepare(`
        DELETE FROM document_chunks
        WHERE document_id = ?
      `).run(documentId);
      
      // Delete document
      const result = this.db.prepare(`
        DELETE FROM documents
        WHERE id = ?
      `).run(documentId);
      
      // Commit transaction
      this.db.exec('COMMIT');
      
      return result.changes > 0;
    } catch (error) {
      // Rollback transaction
      this.db.exec('ROLLBACK');
      throw new DatabaseError(`Failed to delete document ${documentId}`, error);
    }
  }
  
  // Get knowledge graph
  public getKnowledgeGraph(options: {
    documentId?: string;
    conceptId?: string;
    depth?: number;
    minWeight?: number;
    maxNodes?: number;
  } = {}): KnowledgeGraph {
    try {
      const depth = options.depth || 2;
      const minWeight = options.minWeight || 0.5;
      const maxNodes = options.maxNodes || 100;
      
      const nodes: KnowledgeGraphNode[] = [];
      const edges: KnowledgeGraphEdge[] = [];
      const nodeMap = new Map<string, KnowledgeGraphNode>();
      
      let query = '';
      const params: any[] = [];
      
      if (options.documentId) {
        // Start from a specific document
        query = `
          WITH RECURSIVE
          graph_nodes(id, source_type, target_id, target_type, depth) AS (
            SELECT source_id, source_type, target_id, target_type, 1
            FROM relationships
            WHERE source_id = ? AND weight >= ?
            UNION
            SELECT r.source_id, r.source_type, r.target_id, r.target_type, gn.depth + 1
            FROM relationships r
            JOIN graph_nodes gn ON r.source_id = gn.target_id
            WHERE gn.depth < ? AND r.weight >= ?
          )
          SELECT r.source_id, r.source_type, r.target_id, r.target_type, r.relationship_type, r.weight,
            s_doc.title as source_doc_title, t_doc.title as target_doc_title,
            s_concept.name as source_concept_name, s_concept.type as source_concept_type,
            t_concept.name as target_concept_name, t_concept.type as target_concept_type
          FROM relationships r
          JOIN graph_nodes gn ON r.source_id = gn.source_id AND r.target_id = gn.target_id
          LEFT JOIN documents s_doc ON r.source_id = s_doc.id AND r.source_type = 'DOCUMENT'
          LEFT JOIN documents t_doc ON r.target_id = t_doc.id AND r.target_type = 'DOCUMENT'
          LEFT JOIN concepts s_concept ON r.source_id = s_concept.id
          LEFT JOIN concepts t_concept ON r.target_id = t_concept.id
          WHERE r.weight >= ?
          LIMIT ?
        `;
        
        params.push(options.documentId, minWeight, depth, minWeight, minWeight, maxNodes);
      } else if (options.conceptId) {
        // Start from a specific concept
        query = `
          WITH RECURSIVE
          graph_nodes(id, source_type, target_id, target_type, depth) AS (
            SELECT source_id, source_type, target_id, target_type, 1
            FROM relationships
            WHERE (source_id = ? OR target_id = ?) AND weight >= ?
            UNION
            SELECT r.source_id, r.source_type, r.target_id, r.target_type, gn.depth + 1
            FROM relationships r
            JOIN graph_nodes gn ON r.source_id = gn.target_id OR r.target_id = gn.source_id
            WHERE gn.depth < ? AND r.weight >= ?
          )
          SELECT r.source_id, r.source_type, r.target_id, r.target_type, r.relationship_type, r.weight,
            s_doc.title as source_doc_title, t_doc.title as target_doc_title,
            s_concept.name as source_concept_name, s_concept.type as source_concept_type,
            t_concept.name as target_concept_name, t_concept.type as target_concept_type
          FROM relationships r
          JOIN graph_nodes gn ON (r.source_id = gn.source_id AND r.target_id = gn.target_id) OR
                                (r.source_id = gn.target_id AND r.target_id = gn.source_id)
          LEFT JOIN documents s_doc ON r.source_id = s_doc.id AND r.source_type = 'DOCUMENT'
          LEFT JOIN documents t_doc ON r.target_id = t_doc.id AND r.target_type = 'DOCUMENT'
          LEFT JOIN concepts s_concept ON r.source_id = s_concept.id
          LEFT JOIN concepts t_concept ON r.target_id = t_concept.id
          WHERE r.weight >= ?
          LIMIT ?
        `;
        
        params.push(options.conceptId, options.conceptId, minWeight, depth, minWeight, minWeight, maxNodes);
      } else {
        // Get the most connected concepts and documents
        query = `
          SELECT r.source_id, r.source_type, r.target_id, r.target_type, r.relationship_type, r.weight,
            s_doc.title as source_doc_title, t_doc.title as target_doc_title,
            s_concept.name as source_concept_name, s_concept.type as source_concept_type,
            t_concept.name as target_concept_name, t_concept.type as target_concept_type
          FROM relationships r
          LEFT JOIN documents s_doc ON r.source_id = s_doc.id AND r.source_type = 'DOCUMENT'
          LEFT JOIN documents t_doc ON r.target_id = t_doc.id AND r.target_type = 'DOCUMENT'
          LEFT JOIN concepts s_concept ON r.source_id = s_concept.id
          LEFT JOIN concepts t_concept ON r.target_id = t_concept.id
          WHERE r.weight >= ?
          ORDER BY r.weight DESC
          LIMIT ?
        `;
        
        params.push(minWeight, maxNodes);
      }
      
      const relationships = this.db.prepare(query).all(...params);
      
      // Process relationships to build graph
      for (const rel of relationships) {
        // Process source node
        if (!nodeMap.has(rel.source_id)) {
          let nodeType: 'document' | 'concept' | 'person' | 'topic' = 'concept';
          let label = '';
          let weight = 1;
          
          if (rel.source_type === 'DOCUMENT') {
            nodeType = 'document';
            label = rel.source_doc_title || 'Unknown Document';
          } else if (rel.source_concept_type === 'PERSON') {
            nodeType = 'person';
            label = rel.source_concept_name || 'Unknown Person';
          } else if (rel.source_concept_type === 'TOPIC') {
            nodeType = 'topic';
            label = rel.source_concept_name || 'Unknown Topic';
          } else {
            label = rel.source_concept_name || 'Unknown Concept';
          }
          
          const node: KnowledgeGraphNode = {
            id: rel.source_id,
            label,
            type: nodeType,
            weight
          };
          
          nodeMap.set(rel.source_id, node);
          nodes.push(node);
        }
        
        // Process target node
        if (!nodeMap.has(rel.target_id)) {
          let nodeType: 'document' | 'concept' | 'person' | 'topic' = 'concept';
          let label = '';
          let weight = 1;
          
          if (rel.target_type === 'DOCUMENT') {
            nodeType = 'document';
            label = rel.target_doc_title || 'Unknown Document';
          } else if (rel.target_concept_type === 'PERSON') {
            nodeType = 'person';
            label = rel.target_concept_name || 'Unknown Person';
          } else if (rel.target_concept_type === 'TOPIC') {
            nodeType = 'topic';
            label = rel.target_concept_name || 'Unknown Topic';
          } else {
            label = rel.target_concept_name || 'Unknown Concept';
          }
          
          const node: KnowledgeGraphNode = {
            id: rel.target_id,
            label,
            type: nodeType,
            weight
          };
          
          nodeMap.set(rel.target_id, node);
          nodes.push(node);
        }
        
        // Add edge
        edges.push({
          source: rel.source_id,
          target: rel.target_id,
          label: rel.relationship_type,
          weight: rel.weight
        });
      }
      
      return { nodes, edges };
    } catch (error) {
      throw new DatabaseError('Failed to get knowledge graph', error);
    }
  }
  
  // Get similar documents
  public async getSimilarDocuments(documentId: string, limit: number = 5): Promise<SearchResult[]> {
    try {
      const document = this.getDocument(documentId);
      if (!document) {
        throw new KnowledgeBaseError(`Document ${documentId} not found`);
      }
      
      // Get document content
      const content = this.getDocumentContent(documentId);
      
      // Use semantic search to find similar documents
      const results = await this.searchDocuments(content, {
        limit: limit + 1, // +1 because the document itself will be included
        useSemanticSearch: true
      });
      
      // Filter out the original document
      return results.filter(result => result.documentId !== documentId);
    } catch (error) {
      throw new KnowledgeBaseError(`Failed to get similar documents for ${documentId}`, error);
    }
  }
  
  // Get indexing progress
  public getIndexingProgress(): IndexingProgress {
    return { ...this.indexingProgress };
  }
  
  // Close database connection
  public close(): void {
    this.stopAllWatching();
    
    if (this.db) {
      this.db.close();
    }
  }
}

// Create singleton instance
let knowledgeBaseServiceInstance: KnowledgeBaseService | null = null;

// Get or create knowledge base service instance
export const getKnowledgeBaseService = (options?: {
  dbPath?: string;
  storagePath?: string;
  pineconeApiKey?: string;
  pineconeEnvironment?: string;
  pineconeIndex?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  maxConcurrentProcessing?: number;
}): KnowledgeBaseService => {
  if (!knowledgeBaseServiceInstance) {
    knowledgeBaseServiceInstance = new KnowledgeBaseService(options);
  }
  
  return knowledgeBaseServiceInstance;
};

export default getKnowledgeBaseService;
