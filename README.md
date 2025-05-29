# Factory Starter App

A minimal cross-platform desktop application built with Tauri, React, and TypeScript. This starter app demonstrates how to build and run a real application using Factory.

## What is Tauri?

Tauri is a framework for building tiny, fast, and secure desktop applications using web technologies (HTML, CSS, JavaScript/TypeScript) alongside a Rust backend. This combination provides:

- Cross-platform compatibility (Windows, macOS, Linux)
- Small bundle sizes
- Native performance
- Enhanced security

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [Rust](https://www.rust-lang.org/tools/install)
- Platform-specific dependencies:
  - **Windows**: Microsoft Visual Studio C++ Build Tools
  - **macOS**: Xcode Command Line Tools
  - **Linux**: Various packages (see [Tauri setup docs](https://tauri.app/v1/guides/getting-started/prerequisites))

## Quick Start

Clone the repository and navigate to the project directory:

```bash
git clone https://github.com/enoreyes/starter-app
cd starter-app
```

Install dependencies:

```bash
npm install
```

Run the desktop application:

```bash
npm run tauri:dev
```

This will launch a native desktop window application, not just a browser tab. The first build may take a few minutes as Rust dependencies are compiled.

## Available Commands

- `npm run tauri:dev` - Start the desktop application in development mode
- `npm run tauri:build` - Build the desktop application for production
- `npm test` - Run tests
- `npm run lint` - Run linting

## Project Structure

```
starter-app/
├── src/               # Frontend source code (React)
│   ├── App.tsx        # Main application component
│   └── backend.ts     # Interface to Rust backend
├── src-tauri/         # Rust backend code
│   ├── src/main.rs    # Main Rust entry point
│   └── tauri.conf.json # Tauri configuration
└── README.md          # This file
```

## Next Steps

After getting the app running, try adding new features or modifying the existing code to see how Tauri works with React and TypeScript.

## Learn More

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [React Documentation](https://reactjs.org/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
