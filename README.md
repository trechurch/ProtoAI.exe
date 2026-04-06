# ProtoAI

A Tauri v2 desktop application that bridges local IDE-style workflows with AI-powered chat, code analysis, image generation, and research tools.

## Architecture

ProtoAI uses a layered architecture:

- **Tauri v2 (Rust)** — native window management, security, sidecar process lifecycle
- **Node.js IPC server** — stdin/stdout JSON-lines protocol for persistent AI workflow execution
- **Electron-like UI** — HTML/CSS/JS frontend rendered in WebView2

## Features

- Chat with AI using multiple providers via OpenRouter (Anthropic, OpenAI, Qwen, etc.)
- Per-project chat sessions with persistent history
- File context resolution with import dependency tracking and tiered loading (eager/cached/lazy)
- Image generation via Pollinations.ai
- Deep search via Wikipedia, DuckDuckGo, and arXiv
- Auto-restarting sidecar watchdog with crash recovery
- Split view (single/vertical/horizontal)
- Monaco code editor integration

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (no framework)
- **Backend**: Tauri v2 (Rust 1.x) + Node.js 24+
- **Package Manager**: OpenRouter (multi-provider API gateway)
- **Target Platform**: Windows (x86_64)

## Getting Started

### Prerequisites

- Rust 1.75+ and Cargo
- Node.js 24+
- Tauri CLI (`cargo install tauri-cli`)
- OpenRouter API key (stored in `data/secret.key`)

### Development

```bash
cd tauri-app/src-tauri
cargo tauri dev
```

### Building

```bash
cd tauri-app/src-tauri
cargo tauri build
```

## SDOA Architecture

This project follows the Self-Describing Object Architecture (SDOA) v1.2 pattern, where every module declares its own MANIFEST and DOCS directly in the source code.

## Privacy

See [PRIVACY.md](PRIVACY.md) for details on how ProtoAI handles your data, API keys, and messages.

## License

MIT
