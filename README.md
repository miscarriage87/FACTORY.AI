# 🧠 FACTORY.AI – AGI Companion

A production-ready, AGI-like desktop assistant that fuses cutting-edge large-language-model reasoning with long-term memory, massive-scale knowledge management, and intelligent automation. FACTORY.AI changes how you work, learn, and organise information – all from a lightweight, cross-platform desktop app.

---

## ✨ Key Features

### 🧠 Advanced AI Capabilities
• Intelligent, context-aware conversations  
• Persistent memory system using SQLite + vector embeddings  
• Seamless ingestion of 300 GB+ personal knowledge bases  
• Proactive suggestions drawn from real-time behaviour analysis  
• Extensible function-calling framework for custom skills  

### 📚 Knowledge Management
• Multi-format document ingestion: PDF, Word, Excel, CSV, TXT  
• Transformer-based semantic search over Milvus / Pinecone vectors  
• Real-time indexing, summarisation, and entity extraction  
• Context-aware retrieval directly inside the chat window  

### 🎯 Productivity Suite
• AI-generated tasks and smart prioritisation  
• Integrated project dashboards with automatic progress tracking  
• Meeting Intelligence – preparation, live context, and summarisation  
• Calendar integration and workflow automation hints  

### 🤖 Learning & Adaptation
• Behavioural learning – remembers preferences & routines  
• Dynamic communication style (concise / detailed / technical)  
• Interest & expertise profiling for targeted recommendations  
• Topic & entity tracking across every interaction  

---

## 🛠️ Technology Stack

| Layer | Tech |
|-------|------|
| Desktop | **Tauri** (Rust core, web front-end) |
| UI | **React 18**, **TypeScript**, **Tailwind CSS**, **Radix UI**, **Lucide** |
| AI / Orchestration | **OpenAI GPT-4**, **LangChain**, **Transformers.js**, **Hugging Face Inference** |
| Data | **SQLite** + **better-sqlite3**, **Drizzle ORM** |
| Vector Search | **Milvus** (self-host) / **Pinecone** (cloud) |
| Document Parsing | pdf-parse, mammoth, xlsx, csv-parse, cheerio |
| Utilities | crypto-js, node-fetch, date-fns, Octokit (GitHub API) |

---

## 🚀 Quick Start

### 1 – Prerequisites
• Node .js 18+  
• Rust toolchain  
• OpenAI API key (required)  
• Hugging Face token (optional for local models)  

### 2 – Installation
```bash
git clone https://github.com/miscarriage87/FACTORY.AI
cd FACTORY.AI
npm install
```

### 3 – Configuration
Create a `.env` file:

```env
OPENAI_API_KEY=your_openai_api_key
HUGGING_FACE_TOKEN=optional_hf_token
MILVUS_URL=http://localhost:19530
PINECONE_API_KEY=optional_pinecone_key
```

### 4 – Run
```bash
# Development
npm run tauri:dev

# Production build
npm run tauri:build
```

---

## 📖 Usage Guide

### 💬 Chat
• Start a conversation – the assistant keeps contextual memory  
• Insert knowledge snippets via `@` document search  
• Trigger specialised skills through natural requests or slash-commands  

### 📚 Knowledge Base
1. Open **Knowledge** tab  
2. Drag & drop documents (PDF, DOCX, XLSX, CSV, TXT)  
3. The engine indexes, embeds & tags content automatically  
4. Use semantic search or let the assistant surface relevant passages  

### 📋 Task & Project Management
• Convert chat messages to tasks with one click  
• Tasks auto-link to projects; progress updates appear in real time  
• AI recommends priorities and due dates  

### 🎯 Meeting Intelligence
• **Prepare** – generate agenda & research participants  
• **Live** – fetch background facts on demand  
• **Summarise** – produce minutes, action items, and follow-ups  

### 🧠 Memory System
• Stores entities, preferences, long-term goals  
• Memory items visible & editable in **Memory** tab  
• Used automatically to personalise every response  

---

## 🏗️ Architecture Overview
```
┌───────────────┐   IPC   ┌────────────────────┐   SQL/Vectors   ┌───────────────┐
│   Front-end   │◀──────▶│  AGI Service Layer  │◀──────────────▶│ Data & Memory │
│   (React)     │         │ (TypeScript / Rust)│                │  (SQLite etc.)│
└───────────────┘         └────────────────────┘                └───────────────┘
                                     ▲
                                     │REST / gRPC
                                     ▼
                            ┌────────────────────┐
                            │ External AI APIs   │
                            │ (OpenAI, HF, etc.) │
                            └────────────────────┘
```

Core services:  
1. **agiCompanionService.ts** – orchestration & conversation engine  
2. **knowledgeBase.ts** – document ingestion & semantic search  
3. **memory subsystem** – long-term user & entity storage  
4. **Rust-Tauri backend** – system-level integrations & secure storage  

---

## 🎨 Interface Highlights
*Multi-tab layout*  
Chat • Knowledge • Tasks • Projects • Memory • Meetings • Settings  

Real-time toast notifications, dark/light mode, full accessibility support.

_Screenshots coming soon…_

---

## 🔧 Development

```bash
npm run tauri:dev      # live desktop dev
npm run tauri:build    # release binaries
npm run lint           # eslint + prettier
npm run test           # vitest unit tests
npm run type-check     # strict TypeScript
```

Project tree (abridged):

```
src/
 ├─ components/
 ├─ services/
 │   ├─ agiCompanionService.ts
 │   ├─ knowledgeBase.ts
 │   └─ openai.ts
 ├─ AGIApp.tsx
 ├─ AppEnhanced.tsx
 └─ App.tsx
src-tauri/
 ├─ src/main.rs
 └─ Cargo.toml
```

### Extending
• **New AI skill** → add a function in `agiCompanionService.ts`  
• **Custom doc type** → implement parser in `knowledgeBase.ts`  
• **System integration** → expose Rust command in `main.rs` and call via @tauri-apps/api  

---

## 🔌 API Notes

| Service | Required | Notes |
|---------|----------|-------|
| OpenAI GPT-4 | ✅ | Core reasoning engine |
| Hugging Face | ⬜ | Local embeddings / tasks |
| Milvus | ⬜ | Self-hosted vector DB |
| Pinecone | ⬜ | Cloud vector DB alternative |

Remember to monitor usage to avoid unexpected costs.

---

## 🤝 Contributing

1. Fork & branch (`feat/your-feature`)  
2. Follow project code style (ESLint/Prettier)  
3. Add tests where possible  
4. Open a pull request with clear description  

Please read `CONTRIBUTING.md` for full guidelines.

---

## 📝 License

MIT © 2025 The San Francisco AI Factory

---

## 🌟 Acknowledgements
• **Factory.ai** for the development platform  
• **OpenAI & Hugging Face** for amazing models  
• **Tauri** for lightweight desktop magic  
• Community contributors – you make this better every day ❤️

---

**Built with love and caffeine – welcome to the future of personal AGI.**
