# Contributing to **FACTORY.AI AGI Companion**

Thanks for your interest in making FACTORY.AI even better!  
We welcome contributions of **all kinds**—code, docs, testing, design, triage, and ideas.  
Whether you’re a seasoned open-source veteran or opening your first pull request, this guide will help you succeed.

---

## 📦  Project Overview

FACTORY.AI is a cross-platform desktop application that delivers an AGI-like personal assistant powered by:

* **Tauri + Rust** backend for secure native functionality  
* **React 18 + TypeScript** front-end  
* **OpenAI GPT-4 / LangChain / Transformers.js** orchestration  
* **SQLite + Vector DB (Milvus / Pinecone)** persistent memory and knowledge search  

---

## 🚀  Getting Started

1. **Fork** the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-user>/FACTORY.AI.git
   cd FACTORY.AI
   ```

2. **Install dependencies**

   ```bash
   npm install        # Node packages
   # Ensure Rust toolchain is installed (`rustup default stable`)
   ```

3. **Create an `.env` file**

   Copy `.env.example` ➜ `.env` and add your API keys.

4. **Run the desktop app**

   ```bash
   npm run tauri:dev
   ```

   A native window should appear. 🎉

---

## 🛠️  Development Environment

| Task | Command |
|------|---------|
| Hot-reload desktop app | `npm run tauri:dev` |
| Build production binaries | `npm run tauri:build` |
| Lint & format code | `npm run lint` |
| Run unit tests | `npm run test` |
| TypeScript strict check | `npm run type-check` |

> **Tip:** Tauri compiles Rust crates on first run—this can take several minutes.

---

## 🎨  Code Style Guidelines

* **TypeScript**: strict mode (`noImplicitAny`, `exactOptionalPropertyTypes`).
* **Formatting**: Prettier rules enforced via `eslint --fix`.
* **Imports**: absolute paths from `src/` (`@/components/Button`).
* **React**: Functional components + hooks, no class components.
* **Rust**: `rustfmt` + `clippy --all-targets --all-features -- -D warnings`.
* **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, etc.).

---

## 🌳  Git Workflow

1. **Create a branch**

   ```
   git checkout -b feat/my-awesome-feature
   ```

2. **Work & commit often**    
   Keep commits atomic and descriptive.

3. **Pull from `main` regularly**

   ```
   git pull --rebase upstream main
   ```

4. **Push to your fork**

   ```
   git push origin feat/my-awesome-feature
   ```

5. **Open a Pull Request**

   * Fill in the PR template.
   * Link any related issues (`Closes #123`).
   * Ensure CI passes.

### PR Review Checklist

- [ ] Tests added/updated  
- [ ] Lint & type-check pass  
- [ ] No large auto-generated diffs (lock files, screenshots)  
- [ ] Documentation updated  

---

## 🐞  Bug Reports

Help us squash bugs!

1. **Search existing issues** to avoid duplicates.  
2. Create a **new issue** with:
   * Clear title
   * Steps to reproduce
   * Expected vs. actual behaviour
   * Console / tauri logs & screenshots
3. Add the label **`bug`**.

Critical security issues? Please email security@factory.ai.

---

## 💡  Feature Requests

We love ideas!

* Open a **discussion** first if the idea is large.
* Otherwise create an **issue** labelled **`enhancement`** describing:
  * Problem statement
  * Proposed solution / UX
  * Alternatives considered
  * Additional context (mock-ups, links)

---

## 🧪  Testing Guidelines

* **Unit tests** with Vitest (`*.test.ts` in same folder).  
* Mock external APIs—no live calls in CI.  
* Cover happy-path **and** edge cases.  
* Keep tests deterministic and fast (<100 ms).  
* Run `npm run test -- --coverage` before opening a PR.

---

## 📚  Documentation Standards

* **README** explains high-level concepts; **docs/** folder contains deep dives.
* Every exported function/class must include **JSDoc** (or Rust `///` docs).
* Update architecture and sequence diagrams if changing core flows.
* Doc changes alone? Use `docs:` commit prefix.

---

## 🤝  Community & Support

* Join the **GitHub Discussions** for Q&A.  
* Chat with the team on **Discord #factory-ai**.  
* Follow the **Code of Conduct**—be kind, inclusive, and respectful.

---

## 📝  License & Copyright

By contributing you agree your work will be released under the project’s MIT license.

---

### 🌟  Thank You!

Your contributions power FACTORY.AI’s mission to bring autonomous software engineering to everyone.  
We can’t wait to see what you build. ✨
