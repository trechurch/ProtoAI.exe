# ProtoAI Application Analysis Report

## Executive Summary

ProtoAI is a local, AI-powered desktop assistant built using Tauri v2. It follows a distinct 3-layer architecture leveraging a Rust-based host shell, a Node.js workflow engine (IPC sidecar), and a Vanilla JavaScript UI rendered via WebView2. The project has reached a high level of implementation (approximately 81% complete) with core features like multi-model orchestration, streaming, file browsing, and process crash recovery currently operational.

The application incorporates a unique "Self-Describing Object Architecture" (SDOA v1.2/v3) that enforces modules to declare their capabilities, definitions, and manifestations within the source code directly.

## Architecture & Components

The application is structured into three primary layers connected via an IPC contract (H1):

1. **Rust / Tauri Shell** (`tauri-app/src-tauri`):
   - **`engine_bridge.rs` & `node_process_backend.rs`**: Manages the lifecycle of the Node sidecar, handles crash recovery with an exponential backoff watchdog (up to 3 crashes), and facilitates the `stdin/stdout` JSON-lines based IPC.
   - **`commands.rs`**: Exposes the Rust backend to the frontend UI for actions that don't need the Node engine, including robust native file system operations.

2. **Node.js Sidecar** (`tauri-app/resources/server`):
   - **`server-ipc.cjs`**: The main entry point for the workflow engine. Reads IPC commands from stdin, queues them serially, and dispatches them to respective workflows.
   - **Workflow Engine (`orchestration/`)**: Handles all critical AI operations: `SendMessageWorkflow`, `ImageGenWorkflow`, `DeepSearchWorkflow`, and a `MultiModelSendWorkflow` which provides an advanced routing pipeline (Route → Engineer → Prime → Watch → Audit) for local models using `node-llama-cpp`.

3. **UI Layer** (`tauri-app/ui`):
   - Vanilla JS without a heavy framework (React/Vue).
   - Component state injected directly into the DOM and orchestrated via a global EventBus.
   - Advanced features include a split-screen workspace, "PartnerTicker" state machine for orchestrator visibility, and a paginated virtual file system (VFS) viewer.

## Current Project Status & Recent Fixes

The app is functionally stable with recent critical P0 fixes resolved successfully:
- **UI Markdown Rendering:** Addressed and resolved parsing bugs for Markdown streaming responses.
- **Local Model GPU Instability:** Repaired an `ErrorDeviceLost` crash in the `LocalModelAdapter` by defaulting to CPU-based inference.
- **History Save Logic:** Reworked IPC handlers to reliably save prompts immediately, independent of whether the workflow succeeds or errors out.
- **Orchestrator Stability:** Finished wiring the orchestrator. Now includes dynamic ESM loads, a 4-step execution pipeline, and staggered event playback.

## Known Errors & Blocking Issues (P0/P1)

Despite the stable core, there are several known issues and unfinished features that require immediate attention:

1. **VFS Context Not Reaching LLM (High Priority Bug)**:
   - *Issue*: `ChatBehavior.buildContext()` correctly builds the file context arrays, but `SendMessageWorkflow` does not currently accept or inject this `systemExtra` content into the API system prompt payload. This effectively severs the LLM from understanding project files.
   
2. **Missing Multi-Session UI**:
   - *Issue*: While the backend (`ChatSessionWorkflow`) works to manage multiple chat sessions, there is no frontend switch in the sidebar to create, select, or manage these sessions.

3. **Monaco Editor Initialization Errors**:
   - *Issue*: The Code tab displays a blank pane. It appears the Monaco editor script fails to load properly in `PrimaryPanel._initMonaco()`. Error logging needs to be established to debug this silently failing view.

4. **Settings Application Latency**:
   - *Issue*: Changes made within the Settings modal do not apply instantly; they require a hard application reload.

## Proposed Steps Forward & Potential Improvements

Based on the documentation and analysis, the following implementation plan is recommended for advancing the project:

### 1. The Archetype & Hybrid Profile System (Next Steps)
The application defines 9 distinct "Archetypes" (e.g., Coding Super Hero, Ruthless Strategist, Deep Thinking Research Assistant) in `data/archetypes/*.json`, but they are entirely disconnected from the routing logic. 
- **Action**: Update `cli/claude-select.cjs` and `server/lib/SettingsManager.js` to implement an inheritance resolution chain (`archetype` → `profile` → `settings`). Add a frontend UI selector to permit users to spawn profiles based on these defined archetypes.

### 2. Complete File Manager Redesign
- The current File Manager is functional but cramped. Execute the approved redesign: responsive top/bottom or left/right splits via `ResizeObserver`, dedicated `#folderTree` with lazy loading, and an interactive `#fileList` supporting multi-select, context menus, and drag-and-drop operations for `fs_copy` / `fs_rename`.

### 3. VFS Tier Integration
- Implement the planned "Tier Dot" system (eager, cached, lazy) per file, allowing developers to granularly control what files are pre-loaded in the LLM's context token window to save API costs and improve context relevance.

### 4. Technical Debt & Quality of Life Features
- Fix the `SendMessageWorkflow` to inject the built VFS context.
- Implement response caching for repeated queries to lower API costs.
- Complete the "Browser" and "Terminal" tab placeholders using `<webview>` tags and ANSI-colored `<pre>` output blocks for native log viewing.
- Setup explicit Error mapping on IPC calls so frontend alerts contain actionable traces rather than generic wrapper errors.
