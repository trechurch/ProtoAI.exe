// ============================================================
// Backend Bridge
// Tauri IPC primary; HTTP localhost:17890 fallback
// ============================================================

const TAURI_AVAILABLE = !!(window.__TAURI__?.core?.invoke);
const HTTP_BASE = "http://127.0.0.1:17890";

const ENGINES = [
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-opus-4.1",
  "openai/gpt-4o-mini",
  "qwen/qwen-2-7b-instruct:free",
  "qwen/qwen3.6-plus:free",
];

console.log(`[ProtoAI] Backend: ${TAURI_AVAILABLE ? "Tauri IPC" : "HTTP :17890"}`);

// ============================================================
// Backend Status — tooltip on badge + sidebar dot
// ============================================================

function setBackendStatus(mode, detail = "") {
  const labels = {
    tauri:       "Backend: Tauri IPC (sidecar active)",
    http:        "Backend: HTTP fallback — port 17890",
    crashed:     "Sidecar crashed (3/3). Use Reconnect.",
    unavailable: "Backend: sidecar initializing…",
    offline:     "Backend: offline",
  };
  const text = labels[mode] ?? mode;

  const badge = document.getElementById("currentProfileName");
  if (badge) badge.title = detail ? `${text}\n${detail}` : text;

  const dot  = document.getElementById("statusDot");
  const label = document.getElementById("sidebarStatusText");
  if (dot) {
    dot.className = `status-dot ${mode}`;
  }
  if (label) {
    label.textContent = { tauri: "Tauri IPC", http: "HTTP :17890",
      crashed: "Crashed", unavailable: "Starting…", offline: "Offline" }[mode] ?? mode;
  }
}

// ============================================================
// Reconnect button inside chat
// ============================================================

function showReconnectButton() {
  if (!TAURI_AVAILABLE) return;
  if (chatContainer?.querySelector(".reconnect-btn")) return;

  const btn = document.createElement("button");
  btn.textContent = "Reconnect Sidecar";
  btn.className = "secondary reconnect-btn";
  btn.style.cssText = "margin: 8px 0; display: block;";
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Reconnecting…";
    try {
      await window.__TAURI__.core.invoke("engine_reconnect");
      setBackendStatus("tauri");
      btn.remove();
    } catch (err) {
      btn.textContent = "Reconnect failed — try again";
      btn.disabled = false;
      showError(`Reconnect failed: ${err}`);
    }
  };
  chatContainer?.appendChild(btn);
}

// ============================================================
// Toast — lightweight "btw" nudge, non-blocking
// ============================================================

function showToast(msg) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ============================================================
// fetch with timeout
// ============================================================

async function fetchWithTimeout(url, opts = {}, ms = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// HTTP fallback — workflow name → REST endpoint
// ============================================================

async function httpFallback(name, payload) {
  switch (name) {
    case "ListProjectsWorkflow": {
      const res = await fetchWithTimeout(`${HTTP_BASE}/projects`);
      if (!res.ok) throw new Error(`/projects ${res.status}`);
      return res.json();
    }
    case "ListProfilesWorkflow": {
      const res = await fetchWithTimeout(`${HTTP_BASE}/profiles`);
      if (!res.ok) throw new Error(`/profiles ${res.status}`);
      const data = await res.json();
      const profiles = Object.entries(data.profiles || {}).map(([id, p]) => ({
        id, name: typeof p === "object" ? (p.name || id) : id,
      }));
      return { profiles };
    }
    case "LoadProjectHistoryWorkflow": {
      const res = await fetchWithTimeout(`${HTTP_BASE}/history/${encodeURIComponent(payload.project)}`);
      if (!res.ok) throw new Error(`/history ${res.status}`);
      const data = await res.json();
      const flat = Array.isArray(data.history) ? data.history : [];
      const history = [];
      for (let i = 0; i + 1 < flat.length; i += 2)
        history.push({ user: flat[i]?.message ?? "", ai: flat[i + 1]?.message ?? "" });
      return { history };
    }
    case "ChatSessionWorkflow": {
      const { action, project, chatId, name, entry } = payload;
      const res = await fetchWithTimeout(`${HTTP_BASE}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, project, chatId, name }),
      });
      if (!res.ok) throw new Error(`/sessions ${res.status}`);
      return await res.json();
    }
    case "SendMessageWorkflow": {
      const { project, profile, engine, message } = payload;
      const res = await fetchWithTimeout(`${HTTP_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, profile, engine, message }),
      });
      if (!res.ok) throw new Error(`/chat ${res.status}`);
      const data = await res.json();
      return { reply: data.response || data.reply || "(no response)" };
    }
    default:
      throw new Error(`No HTTP fallback for workflow: ${name}`);
  }
}

// ============================================================
// runWorkflow — routes to engine_* Tauri commands (persistent
// sidecar IPC), then HTTP fallback if unavailable.
// ============================================================

async function invokeTauri(workflow, payload) {
  const inv = window.__TAURI__.core.invoke;
  switch (workflow) {
    case "ListProjectsWorkflow":
      return inv("engine_projects");
    case "ListProfilesWorkflow":
      return inv("engine_profiles");
    case "LoadProjectHistoryWorkflow":
      return inv("engine_history", { project: payload.project });
    case "SendMessageWorkflow":
      return inv("engine_chat", {
        project: payload.project,
        profile: payload.profile || "",
        engine:  payload.engine  || "",
        message: payload.message,
      });
    case "UploadWorkflow":
      return inv("engine_upload", {
        project:  payload.project,
        filename: payload.filename,
        content:  payload.content || "",
      });
    case "IngestWorkflow":
      return inv("engine_ingest", {
        project: payload.project,
      });
    case "SpellcheckWorkflow":
    case "VoiceChatWorkflow":
    case "VersionInfoWorkflow":
    default:
      // One-shot workflows fall back to run_workflow
      return inv("run_workflow", { name: workflow, payload: JSON.stringify(payload) })
        .then(raw => JSON.parse(raw));
  }
}

async function runWorkflow(name, payload) {
  try {
    let result;
    if (TAURI_AVAILABLE) {
      try {
        result = await invokeTauri(name, payload);
        setBackendStatus("tauri");
      } catch (tauriErr) {
        const msg = String(tauriErr);
        // Only fall back to HTTP for transport-level failures (sidecar crashed / not responding).
        // Application errors (LLM failed, bad input, empty response) should bubble up directly.
        const isTransportError = msg.toLowerCase().includes("crash")
          || msg.toLowerCase().includes("not ready")
          || msg.toLowerCase().includes("sidecar")
          || msg.toLowerCase().includes("timed out")
          || msg.toLowerCase().includes("write to sidecar")
          || msg.toLowerCase().includes("failed to fetch")
          || msg.toLowerCase().includes("net::err");
        // Do NOT match "ipc error" — that's application-level errors from the sidecar
        if (isTransportError) {
          console.warn(`[Workflow] Tauri transport failed (${msg})`);
          try {
            const status = await window.__TAURI__.core.invoke("engine_status");
            if (status === "crashed") { setBackendStatus("crashed"); showReconnectButton(); }
          } catch (_) {}
          result = await httpFallback(name, payload);
          setBackendStatus("http");
        } else {
          // Real application error — rethrow it.
          console.warn(`[Workflow] Tauri app error (${msg})`);
          throw new Error(msg);
        }
      }
    } else {
      result = await httpFallback(name, payload);
      setBackendStatus("http");
    }
    return result;
  } catch (err) {
    setBackendStatus("offline");
    throw err;
  }
}

// ============================================================
// UI State
// ============================================================

let currentProject  = null;
let currentProfile  = null;
let currentEngine   = ENGINES[0];
let chatContainer   = null;
let isSending       = false;
let splitMode       = "single";
let attachedFiles   = [];
let monacoEditor    = null;   // Monaco instance for Code tab
let activeRightMode = "files"; // tracks current right-pane tab
let allProfiles     = {};     // full profiles object: { id: {model, ...} }

// Chat session state
let chatSessions    = [];     // [{ id, name, createdAt }, ...]
let currentChatId   = null;   // currently active session id

// Browser tab state
let browserHistory  = [];      // stack of visited URLs
let browserHistoryIdx = -1;    // current position in history
let browserFrameLoaded = false; // tracks if iframe successfully loaded
let previousRightMode = "files"; // last non-browser tab (for fallback)

// ============================================================
// Message rendering
// ============================================================

function appendMessage(role, text, isHtml = false) {
  // Hide empty state once there's a real message
  setEmptyState(false);

  const wrap = document.createElement("div");
  wrap.className = `message ${role === "user" ? "user" : "assistant"}`;

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "ProtoAI";

  const body = document.createElement("div");
  body.className = "message-body";

  if (role === "user") {
    body.textContent = text;
  } else {
    if (isHtml) {
      body.innerHTML = text;
    } else {
      body.innerHTML = (typeof marked !== "undefined")
        ? marked.parse(text)
        : text.replace(/</g, "&lt;");
    }
  }

  wrap.appendChild(label);
  wrap.appendChild(body);
  chatContainer.appendChild(wrap);
  // Auto-scroll only if already near the bottom
  const atBottom = chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop < 80;
  if (atBottom) chatContainer.scrollTop = chatContainer.scrollHeight;
  updateScrollButton();
  return wrap;
}

function clearChat() {
  chatContainer.innerHTML = "";
  chatContainer.appendChild(buildEmptyState());
  setEmptyState(true);
  hideScrollButton();
}

// ============================================================
// Scroll-to-Bottom Indicator
// ============================================================

function setupScrollIndicator() {
  chatContainer.addEventListener("scroll", () => {
    updateScrollButton();
  });
}

function updateScrollButton() {
  const { scrollHeight, clientHeight, scrollTop } = chatContainer;
  const distFromBottom = scrollHeight - clientHeight - scrollTop;
  const hasOverflow = scrollHeight > clientHeight;

  if (hasOverflow && distFromBottom > 100) {
    showScrollButton();
  } else {
    hideScrollButton();
  }
}

function showScrollButton() {
  if (document.getElementById("scrollToBottom")) return;
  const btn = document.createElement("button");
  btn.id = "scrollToBottom";
  btn.className = "scroll-bottom-btn";
  btn.innerHTML = "↓ New messages below";
  btn.addEventListener("click", () => {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
  });
  document.body.appendChild(btn);
}

function hideScrollButton() {
  document.getElementById("scrollToBottom")?.remove();
}

function showError(msg) {
  setEmptyState(false);
  const wrap = document.createElement("div");
  wrap.className = "message error";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = `⚠ ${msg}`;
  wrap.appendChild(body);
  chatContainer.appendChild(wrap);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ============================================================
// Empty State
// ============================================================

function buildEmptyState() {
  const el = document.createElement("div");
  el.className = "chat-empty-state";
  el.id = "chatEmptyState";
  el.innerHTML = `
    <img class="empty-logo" src="icon.png" alt="ProtoAI" draggable="false" />
    <div class="empty-title">ProtoAI</div>
    <div class="empty-hint">Select a project from the sidebar to begin</div>
  `;
  return el;
}

function setEmptyState(visible) {
  const el = document.getElementById("chatEmptyState");
  if (el) el.style.display = visible ? "" : "none";
}

// ============================================================
// Loaders
// ============================================================

async function loadProjects() {
  const res = await runWorkflow("ListProjectsWorkflow", {});
  return res.projects || [];
}

async function loadProfiles() {
  const res = await runWorkflow("ListProfilesWorkflow", {});
  // engine_profiles returns { profiles: {id: {...}, ...} }
  // tauri-entry returns { profiles: [{id, name}, ...] }
  return res.profiles || {};
}

async function loadHistory(project) {
  const res = await runWorkflow("LoadProjectHistoryWorkflow", { project });
  const raw = res.history || [];
  // Normalize: engine_history returns [{ role, message }], HTTP fallback
  // returns pre-paired [{ user, ai }]. Detect and normalize to flat role-based.
  if (raw.length > 0 && ("user" in raw[0] || "ai" in raw[0])) {
    // Already paired (HTTP fallback shape) — flatten back to role-based
    const flat = [];
    raw.forEach(pair => {
      if (pair.user) flat.push({ role: "user",      message: pair.user });
      if (pair.ai)   flat.push({ role: "assistant",  message: pair.ai });
    });
    return flat;
  }
  return raw; // already [{ role, message }]
}

async function sendChatMessage(project, profile, engine, message) {
  // Let the server resolve file context via permissions + tiers
  // This keeps the message small — file resolution happens server-side
  const res = await runWorkflow("SendMessageWorkflow", { project, profile, engine, message });
  // Detect error payload from IPC
  if (res && res.error) {
    throw new Error(res.detail || res.error || (res.stderr ? res.stderr.slice(0, 200) : "Unknown LLM error"));
  }
  // engine_chat returns { response: "..." }, HTTP fallback returns { reply: "..." }
  return res.response || res.reply || "(no response)";
}

// ============================================================
// Initialization
// ============================================================

async function init() {
  chatContainer = document.getElementById("chatContainer");

  setBackendStatus(TAURI_AVAILABLE ? "unavailable" : "http");

  setupSpellcheck();
  setupEngineSelects();
  setupSplitView();
  setupCanvasToggle();
  setupShortcutOverlay();
  setupQuickActions();
  setupFileAttach();
  setupRightPaneTabs();
  setupScrollIndicator();

  document.getElementById("sendBtn").addEventListener("click", sendMessageFromUI);
  document.getElementById("messageInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessageFromUI(); }
  });
  document.getElementById("newProjectBtn").addEventListener("click", onNewProject);
  document.getElementById("newChatBtn").addEventListener("click", onNewChat);
  document.getElementById("addSourceBtn").addEventListener("click", onAddSource);
  document.getElementById("applyEngineBtn").addEventListener("click", () => {
    const sel = document.getElementById("otfmsEngineSelect");
    currentEngine = sel.value;
    document.getElementById("engineSelect").value = currentEngine;
    showToast(`⚡ Engine set to ${currentEngine}`);
  });

  // Global keyboard shortcuts
  document.addEventListener("keydown", e => {
    if (e.key === "?" && e.shiftKey)              { showShortcutOverlay(); return; }
    if (e.key === "Escape")                        { hideShortcutOverlay(); hideCommandPalette(); window.closeSettingsPanel?.(); return; }
    if (e.ctrlKey && e.key === "Enter")            { e.preventDefault(); sendMessageFromUI(); }
    if (e.ctrlKey && e.key === "k")               { e.preventDefault(); toggleCommandPalette(); }
    if (e.ctrlKey && e.key === "/")                { e.preventDefault(); cycleSplitMode(); }
    if (e.ctrlKey && e.shiftKey && e.key === "N") { e.preventDefault(); onNewProject(); }
    if (e.ctrlKey && e.shiftKey && e.key === "C") { e.preventDefault(); onNewChat(); }
    if (e.ctrlKey && e.shiftKey && e.key === "M") { e.preventDefault(); document.getElementById("otfmsEngineSelect").focus(); }
    if (e.ctrlKey && e.shiftKey && e.key === "S") { e.preventDefault(); window.openSettingsPanel?.(); return; }
    if (e.ctrlKey && e.shiftKey && e.key === "F") { e.preventDefault(); document.getElementById("fileInput").click(); }
    if (e.altKey && e.key === "f")               { e.preventDefault();
                                                        const fi = document.getElementById("folderInput");
                                                        if (fi) fi.click();
                                                        else document.getElementById("fileInput").click(); }
  });

  // Retry backend connection — sidecar can take a few seconds to start
  loadBackendData();
}

async function loadBackendData(attempt = 1) {
  const MAX_ATTEMPTS = 6;
  const RETRY_MS    = 2000;

  try {
    const [profiles, projects] = await Promise.all([loadProfiles(), loadProjects()]);
    populateProfiles(profiles);
    populateProjects(projects);
    if (projects.length > 0) await selectProject(projects[0]);
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[init] Backend not ready, retry ${attempt}/${MAX_ATTEMPTS - 1} in ${RETRY_MS}ms — ${err.message}`);
      setBackendStatus("unavailable");
      setTimeout(() => loadBackendData(attempt + 1), RETRY_MS);
    } else {
      console.error("[init] Gave up after retries:", err);
      showError(
        `Failed to connect to backend after ${MAX_ATTEMPTS - 1} attempts. ` +
        (TAURI_AVAILABLE ? "Sidecar failed to start." : `Is server.js running on port 17890?`) +
        ` (${err.message})`
      );
    }
  }
}

// ============================================================
// Profiles & Projects
// ============================================================

function populateProfiles(profiles) {
  const sel = document.getElementById("profileSelect");
  sel.innerHTML = "";

  // Normalize: engine_profiles returns {id: {config}, ...}
  // tauri-entry returns [{id, name}, ...] — store full objects
  if (profiles && typeof profiles === "object" && !Array.isArray(profiles)) {
    allProfiles = profiles;
  } else if (Array.isArray(profiles)) {
    allProfiles = {};
    profiles.forEach(p => { allProfiles[p.id || p.name] = p; });
  } else {
    allProfiles = {};
  }

  const list = Object.keys(allProfiles);
  list.forEach(k => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k.charAt(0).toUpperCase() + k.slice(1);
    sel.appendChild(opt);
  });
  if (list.length > 0) {
    currentProfile = list[0];
    document.getElementById("currentProfileName").textContent = currentProfile;
  }
}

function populateProjects(projects) {
  const list = document.getElementById("projectList");
  list.innerHTML = "";
  projects.forEach(p => {
    // engine_* returns plain strings; tauri-entry returns {id, name}
    const name = typeof p === "string" ? p : (p.name || p.id || String(p));
    const li = document.createElement("li");
    li.textContent = name;
    li.dataset.project = name;
    li.addEventListener("click", () => selectProject(name));
    list.appendChild(li);
  });
}

async function selectProject(project) {
  currentProject = project;
  document.getElementById("currentProjectName").textContent = project;

  // Highlight active project in sidebar
  document.querySelectorAll("#projectList li").forEach(li => {
    li.classList.toggle("active", li.dataset.project === project);
  });

  clearChat();

  // Restore attached files from project directory
  await restoreAttachedFiles(project);

  // Load chat sessions for this project
  await loadChatSessions(project);
}

async function loadChatSessions(project) {
  chatSessions = [];
  currentChatId = null;

  try {
    const res = await runWorkflow("ChatSessionWorkflow", { action: "list", project });
    chatSessions = res.sessions || [];
  } catch {
    chatSessions = [];
  }

  renderChatSessions();

  if (chatSessions.length > 0) {
    await selectChatSession(chatSessions[0].id);
  } else {
    // No sessions yet — first message will create a default one
    setEmptyState(true);
  }
}

function renderChatSessions() {
  const container = document.getElementById("chatTabs");
  container.innerHTML = "";
  chatSessions.forEach(session => {
    const btn = document.createElement("button");
    btn.className = "chat-session-tab" + (session.id === currentChatId ? " active" : "");
    btn.dataset.chatId = session.id;
    btn.textContent = session.name;
    btn.addEventListener("click", () => selectChatSession(session.id));

    // Double-click to rename
    btn.addEventListener("dblclick", e => {
      e.preventDefault();
      e.stopPropagation();
      renameChatSession(session.id);
    });

    container.appendChild(btn);
  });
}

async function selectChatSession(chatId) {
  currentChatId = chatId;
  clearChat();

  // Update tab active state
  document.querySelectorAll(".chat-session-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.chatId === chatId);
  });

  try {
    const res = await runWorkflow("ChatSessionWorkflow", { action: "load", project: currentProject, chatId });
    const messages = res.messages || [];
    if (messages.length === 0) {
      setEmptyState(true);
    } else {
      messages.forEach(entry => {
        const role = entry.role === "user" ? "user" : "assistant";
        if (entry.message) appendMessage(role, entry.message);
      });
    }
  } catch (err) {
    showError(`Could not load chat "${chatId}": ${err.message}`);
  }
}

async function onNewChat() {
  if (!currentProject) { showToast("Select a project first."); return; }

  try {
    const res = await runWorkflow("ChatSessionWorkflow", {
      action: "create",
      project: currentProject,
      name: `Chat ${chatSessions.length + 1}`
    });
    chatSessions.push({ id: res.id, name: res.name, createdAt: new Date().toISOString() });
    renderChatSessions();
    await selectChatSession(res.id);
  } catch {
    showError("Failed to create new chat");
  }
}

async function renameChatSession(chatId) {
  const session = chatSessions.find(s => s.id === chatId);
  if (!session) return;

  const input = prompt("New chat name:", session.name);
  if (!input || !input.trim()) return;

  try {
    await runWorkflow("ChatSessionWorkflow", { action: "rename", project: currentProject, chatId, name: input.trim() });
    session.name = input.trim();
    renderChatSessions();
  } catch {
    showError("Failed to rename chat");
  }
}

async function onNewProject() {
  const name = prompt("New project name:");
  if (!name?.trim()) return;
  try {
    await runWorkflow("UploadWorkflow", {
      project: name.trim(), filename: ".init", content: "",
    }).catch(() => {}); // best-effort
  } catch (_) {}
  const list = document.getElementById("projectList");
  const li = document.createElement("li");
  li.textContent = name.trim();
  li.dataset.project = name.trim();
  li.addEventListener("click", () => selectProject(name.trim()));
  list.appendChild(li);
  await selectProject(name.trim());
}

// onNewChat moved to session-based implementation in loadChatSessions()

// ============================================================
// Sending Messages — BTW toast on double-send
// ============================================================

async function sendMessageFromUI() {
  const input = document.getElementById("messageInput");
  const text  = input.value.trim();
  if (!text) return;

  if (isSending) {
    showToast("✋ Still working on your last message…");
    return;
  }

  if (!currentProject) { showError("Select or create a project first."); return; }

  // Auto-create a default session if none exist for this project
  if (!currentChatId || chatSessions.length === 0) {
    try {
      const res = await runWorkflow("ChatSessionWorkflow", {
        action: "create",
        project: currentProject,
        name: `Chat 1`
      });
      chatSessions.push({ id: res.id, name: res.name, createdAt: new Date().toISOString() });
      renderChatSessions();
      await selectChatSession(res.id);
    } catch {
      showError("Failed to create chat session");
      return;
    }
  }

  isSending = true;
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;

  // Save user message to session immediately
  try {
    await runWorkflow("ChatSessionWorkflow", {
      action: "append",
      project: currentProject,
      chatId: currentChatId,
      entry: { role: "user", message: text, timestamp: Date.now() }
    });
  } catch (_) {}

  appendMessage("user", text);
  input.value = "";

  // Thinking indicator
  const thinking = appendMessage("assistant", "");
  thinking.classList.add("thinking");

  try {
    const reply = await sendChatMessage(currentProject, currentProfile, currentEngine, text);
    thinking.remove();
    appendMessage("assistant", reply);

    // Save AI reply to session
    try {
      await runWorkflow("ChatSessionWorkflow", {
        action: "append",
        project: currentProject,
        chatId: currentChatId,
        entry: { role: "assistant", message: reply, timestamp: Date.now() }
      });
    } catch (_) {}
  } catch (err) {
    thinking.remove();
    showError(`Backend error: ${err.message}`);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

// ============================================================
// Task chips + Quick Actions (right sidebar)
// ============================================================

const ACTION_CONFIG = {
  // Writes an image prompt for you (no actual image)
  image: {
    prompt: "🖼 Image Prompt",
    handler: "imagePromptHandler",
    systemPrefix:
      "Create a single, vivid image generation prompt based on the user's description. " +
      "Write just the prompt text — one paragraph, no preamble. " +
      "Make it detailed with lighting, composition, mood, and style. ",
  },
  // Actually generates and displays a real image
  image_gen: {
    prompt: "🎨 Generate Image",
    handler: "imageGenHandler",
  },
  // Searches real APIs (Wikipedia, DuckDuckGo, arXiv)
  deepsearch: {
    prompt: "🔎 Search",
    handler: "deepSearchHandler",
  },
  podcast: {
    prompt: "🎙 Podcast Script",
    systemPrefix:
      "[PODCAST MODE] Act as a podcast script writer. " +
      "When the user gives a topic, write an engaging podcast script with intro, segments, and outro. " +
      "Include host cues, timing estimates, and natural transitions. ",
  },
  quiz: {
    prompt: "🧠 Quiz Mode",
    systemPrefix:
      "[QUIZ MODE] Act as a quiz master. " +
      "When the user names a topic, give them one multiple-choice question at a time. " +
      "After each answer, tell them if they're right or wrong and ask the next question. " +
      "Start with the first question now.",
  },
  connectors: {
    prompt: "🔌 Connectors",
    systemPrefix:
      "[CONNECTORS MODE] List and describe the available tools, connectors, and integrations in the ProtoAI system. " +
      "Explain what each one does and how to use it. ",
  },
};

function setupQuickActions() {
  document.querySelectorAll("button.chip").forEach(btn =>
    btn.addEventListener("click", () => triggerAction(btn.dataset.action))
  );
  document.querySelectorAll(".action-item").forEach(btn =>
    btn.addEventListener("click", () => triggerAction(btn.dataset.action))
  );
}

function triggerAction(action) {
  if (!currentProject) { showToast("Select a project first."); return; }
  const cfg = ACTION_CONFIG[action];
  if (!cfg) { showToast(`No handler for ${action}`); return; }

  const input = document.getElementById("messageInput");
  let text = input.value.trim();

  // Handler-based actions (image_gen, deepsearch — real workflows)
  if (cfg.handler === "imageGenHandler") {
    if (!text) { appendMessage("user", "🎨 Generate Image"); appendMessage("assistant", "💡 Type a description in the message box, then click this button again."); return; }
    input.value = "";
    appendMessage("user", text);
    const thinking = appendMessage("assistant", "");
    thinking.classList.add("thinking");
    runWorkflow("ImageGenWorkflow", { text, project: currentProject })
      .then(res => {
        thinking.remove();
        if (res && res.html) {
          appendMessage("assistant", `**Image Generated!**\n_Prompt: ${res.prompt}_\n\n${res.html}`, true);
        } else {
          appendMessage("assistant", res && res.url ? `✅ Image URL: [View directly](${res.url})` : "❌ Image generation returned no result.");
        }
      })
      .catch(err => { thinking.remove(); showError(`Image generation failed: ${err.message}`); });
    return;
  }

  if (cfg.handler === "deepSearchHandler") {
    if (!text) { appendMessage("user", "🔎 Search"); appendMessage("assistant", "💡 Type a search query in the message box, then click this button again."); return; }
    input.value = "";
    appendMessage("user", text);
    const thinking = appendMessage("assistant", "");
    thinking.classList.add("thinking");
    runWorkflow("DeepSearchWorkflow", { query: text })
      .then(res => {
        thinking.remove();
        if (res && res.markdown) {
          appendMessage("assistant", res.markdown, true);
        } else {
          appendMessage("assistant", "Search returned no results. Try a different query.");
        }
      })
      .catch(err => { thinking.remove(); showError(`Deep search failed: ${err.message}`); });
    return;
  }

  if (cfg.handler === "imagePromptHandler") {
    // Prompt Creator: write an optimized image prompt based on user's description
    if (!text) { appendMessage("user", "🖼 Prompt Creator"); appendMessage("assistant", "💡 Type a description of what you want to see, then click this button."); return; }
    input.value = "";
    appendMessage("user", "🖼 Creating image prompt from: " + text);
    const thinking = appendMessage("assistant", "");
    thinking.classList.add("thinking");
    const fullMessage = `${cfg.systemPrefix}\n\nUser's description: ${text}`;
    sendChatMessage(currentProject, currentProfile, currentEngine, fullMessage)
      .then(reply => { thinking.remove(); appendMessage("assistant", reply); })
      .catch(err => { thinking.remove(); showError(`Prompt Creator failed: ${err.message}`); });
    return;
  }

  // Text-based actions (podcast, quiz, connectors) — send with system prefix
  if (!text) { appendMessage("user", cfg.prompt); appendMessage("assistant", "💡 Type a topic in the message box, then click this button."); return; }
  input.value = "";
  appendMessage("user", cfg.prompt + ": " + text);
  const fullMessage = `${cfg.systemPrefix}\n\nTopic: ${text}`;
  sendChatMessage(currentProject, currentProfile, currentEngine, fullMessage)
    .then(reply => appendMessage("assistant", reply))
    .catch(err => showError(`Backend error: ${err.message}`));
  input.focus();
}

// ============================================================
// Engine Selects — keep both in sync
// ============================================================

function setupEngineSelects() {
  const main = document.getElementById("engineSelect");
  const otfms = document.getElementById("otfmsEngineSelect");

  [main, otfms].forEach(sel => {
    sel.innerHTML = "";
    ENGINES.forEach(e => {
      const opt = document.createElement("option");
      opt.value = e; opt.textContent = e;
      sel.appendChild(opt);
    });
    sel.value = currentEngine;
  });

  main.addEventListener("change", () => {
    currentEngine = main.value;
    otfms.value = currentEngine;
  });
  otfms.addEventListener("change", () => {
    currentEngine = otfms.value;
    main.value = currentEngine;
  });
}

// ============================================================
// Spellcheck Toggle — 3 states: Local → Engine → Off
// ============================================================

const SPELL_STATES = [
  { label: "ABC ✓",  title: "Browser spellcheck: ON",   inputState: true,  engineMode: false, cls: "mode-local" },
  { label: "ABC ⬡", title: "Engine spellcheck: ON — click to check last message", inputState: false, engineMode: true, cls: "mode-engine" },
  { label: "ABC ✗",  title: "Spellcheck: OFF",           inputState: false, engineMode: false, cls: "mode-off" },
];

let isSpellcheckEngineMode = () => false;

function setupSpellcheck() {
  const btn   = document.getElementById("spellcheckToggle");
  const input = document.getElementById("messageInput");
  let stateIdx = 0;

  isSpellcheckEngineMode = () => SPELL_STATES[stateIdx] != null && SPELL_STATES[stateIdx].engineMode;

  function update() {
    const state = SPELL_STATES[stateIdx];
    input.spellcheck = state.inputState;
    btn.textContent  = state.label;
    btn.title        = state.title;
    SPELL_STATES.forEach(s => btn.classList.remove(s.cls));
    btn.classList.add(state.cls);
  }

  btn.addEventListener("click", () => {
    stateIdx = (stateIdx + 1) % SPELL_STATES.length;
    update();
  });
}

// ============================================================
// Split View
// ============================================================

function setupSplitView() {
  document.getElementById("splitToggleBtn").addEventListener("click", cycleSplitMode);
}

function cycleSplitMode() {
  if (splitMode === "single")   splitMode = "vertical";
  else if (splitMode === "vertical") splitMode = "horizontal";
  else splitMode = "single";
  applySplitMode();
}

function applySplitMode() {
  const ws   = document.getElementById("workspace");
  const pane = document.getElementById("pane-right");
  ws.classList.remove("split-vertical", "split-horizontal");
  const wasHidden = pane.style.display === "none" || pane.style.display === "";
  if (splitMode === "vertical") {
    ws.classList.add("split-vertical");
    pane.style.display = "flex";
    pane.style.flexDirection = "column";
  } else if (splitMode === "horizontal") {
    ws.classList.add("split-horizontal");
    pane.style.display = "flex";
    pane.style.flexDirection = "column";
  } else {
    pane.style.display = "none";
  }
  // Render right pane content when it first becomes visible
  if (wasHidden && splitMode !== "single") {
    renderRightPane();
    if (monacoEditor) setTimeout(() => monacoEditor.layout(), 50);
  }
}

// ============================================================
// Canvas Toggle
// ============================================================

function setupCanvasToggle() {
  document.getElementById("toggleCanvasBtn").addEventListener("click", () => {
    document.getElementById("canvas").classList.toggle("collapsed");
  });
}

// ============================================================
// Shortcut Overlay
// ============================================================

function setupShortcutOverlay() {
  document.getElementById("shortcutOverlay").addEventListener("click", e => {
    if (e.target === e.currentTarget) hideShortcutOverlay();
  });
}

function showShortcutOverlay() { document.getElementById("shortcutOverlay").classList.remove("hidden"); }
function hideShortcutOverlay() { document.getElementById("shortcutOverlay").classList.add("hidden"); }

// ============================================================
// File Attach
// ============================================================

function setupFileAttach() {
  const fileInput = document.getElementById("fileInput");
  const folderInput = document.getElementById("folderInput");

  // Default: folder picker (recursive). Ctrl+click: individual file(s).
  document.getElementById("attachFileBtn").addEventListener("click", e => {
    e.preventDefault();
    if (e.ctrlKey) { fileInput.click(); } else { folderInput.click(); }
  });

  fileInput.addEventListener("change", e => {
    handleNewFiles(Array.from(e.target.files || []));
    fileInput.value = "";
  });

  folderInput.addEventListener("change", e => {
    handleNewFiles(Array.from(e.target.files || []));
    folderInput.value = "";
  });
}

function handleNewFiles(files) {
  // De-duplicate by name
  const existing = new Set(attachedFiles.map(f => f.name));
  const newFiles = files.filter(f => !existing.has(f.name));
  newFiles.forEach(f => {
    attachedFiles.push(f);
    if (currentProject) uploadFile(f);
  });
  if (newFiles.length) updateFileList();
}

function updateFileList() {
  const list  = document.getElementById("fileList");
  const empty = document.getElementById("fileListEmpty");
  const count = document.getElementById("fileCount");

  list.innerHTML = "";
  count.textContent = String(attachedFiles.length);

  if (attachedFiles.length === 0) {
    empty.style.display = "";
  } else {
    empty.style.display = "none";
    attachedFiles.forEach(f => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="file-icon">📄</span><span class="file-name">${f.name}</span>`;
      list.appendChild(li);
    });
  }

  // Sync right pane if Files tab is visible
  if (activeRightMode === "files") renderRightPane();
}

async function uploadFile(file) {
  try {
    const content = await file.text();
    await runWorkflow("UploadWorkflow", {
      project: currentProject, filename: file.name, content,
    }).catch(() => {}); // best-effort
  } catch (_) {}
}

// Restore file LIST from project directory on project switch
// Lightweight: ingest returns filename-only, no file content I/O.
async function restoreAttachedFiles(project) {
  attachedFiles = [];
  try {
    const res = await runWorkflow("IngestWorkflow", { project });
    if (res && res.files && Array.isArray(res.files)) {
      res.files.forEach(f => {
        // Filename-only — we create a File placeholder so UI shows the names
        const blob = new Blob([], { type: "text/plain" });
        const fileObj = new File([blob], f.filename, { type: "text/plain" });
        attachedFiles.push(fileObj);
      });
    }
  } catch (_) {
    // Best-effort — if ingest fails, start with empty list
  }
  updateFileList();
}

// ============================================================
// Right Pane Tabs — Files / Code / Tools
// ============================================================

function setupRightPaneTabs() {
  document.querySelectorAll("#rightModeTabs .tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#rightModeTabs .tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      activeRightMode = tab.dataset.mode;
      renderRightPane();
    });
  });
}

function renderRightPane() {
  const content = document.getElementById("rightPaneContent");
  if (!content) return;

  if (activeRightMode === "files") {
    renderRightFiles(content);
  } else if (activeRightMode === "code") {
    renderRightCode(content);
  } else if (activeRightMode === "tools") {
    renderRightTools(content);
  } else if (activeRightMode === "browser") {
    // Save previous tab before switching to browser
    previousRightMode = ["files", "code", "tools"].includes(activeRightMode) ? activeRightMode : previousRightMode;
    renderRightBrowser(content);
  }
}

function renderRightFiles(container) {
  container.innerHTML = "";
  if (attachedFiles.length === 0) {
    container.innerHTML = '<div class="list-empty" style="padding:16px;text-align:center;">No files attached.<br><small>Use 📎 to attach files.</small></div>';
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "list";
  ul.style.cssText = "max-height:100%;padding:8px;";
  attachedFiles.forEach((f, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="file-icon">📄</span><span class="file-name">${f.name}</span>`;
    const rm = document.createElement("span");
    rm.textContent = "✕";
    rm.style.cssText = "cursor:pointer;opacity:0.5;font-size:10px;flex-shrink:0;";
    rm.title = "Remove file";
    rm.onclick = (e) => { e.stopPropagation(); attachedFiles.splice(idx, 1); updateFileList(); renderRightPane(); };
    li.appendChild(rm);
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

function renderRightCode(container) {
  container.innerHTML = "";

  // Monaco wrapper
  const editorDiv = document.createElement("div");
  editorDiv.id = "monacoContainer";
  editorDiv.style.cssText = "height:100%;width:100%;";
  container.appendChild(editorDiv);

  // If already initialized, re-layout
  if (monacoEditor) {
    try { monacoEditor.layout(); } catch (_) {}
    editorDiv.appendChild(monacoEditor.getDomNode());
    monacoEditor.layout();
    return;
  }

  // Initialize Monaco via the pre-loaded loader
  if (typeof require === "undefined") {
    editorDiv.textContent = "Monaco loader not available.";
    return;
  }

  require.config({ paths: { vs: "./lib/monaco/vs" } });
  require(["vs/editor/editor.main"], () => {
    monacoEditor = monaco.editor.create(editorDiv, {
      value: "// ProtoAI Code Editor\n// Paste or type code here…\n",
      language: "javascript",
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
    });
  });
}

function renderRightTools(container) {
  container.innerHTML = `
    <div style="padding:12px;display:flex;flex-direction:column;gap:8px;">
      <div class="section-title" style="padding-bottom:4px;">Available Workflows</div>
      <button class="action-item" data-workflow="SpellcheckWorkflow">✏️ Spellcheck Last Message</button>
      <button class="action-item" data-workflow="VoiceChatWorkflow">🎤 Voice Chat</button>
      <button class="action-item" data-workflow="VersionInfoWorkflow">ℹ️ Version Info</button>
      <div class="section-title" style="padding-top:8px;padding-bottom:4px;">Code Tools</div>
      <button class="action-item" id="codeIngestBtn">📥 Ingest Code File</button>
      <button class="action-item" id="filePermissionsBtn">🔒 File Permissions</button>
      <button class="action-item" id="exportChatBtn">📋 Export Chat</button>
    </div>
  `;
  container.querySelectorAll("[data-workflow]").forEach(btn => {
    btn.addEventListener("click", () => triggerWorkflowAction(btn.dataset.workflow));
  });
  container.querySelector("#codeIngestBtn")?.addEventListener("click", triggerIngest);
  container.querySelector("#filePermissionsBtn")?.addEventListener("click", showFilePermissionsDialog);
  container.querySelector("#exportChatBtn")?.addEventListener("click", exportChat);
}

// ============================================================
// Browser Tab — iframe with URL bar and navigation
// ============================================================

function renderRightBrowser(container) {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "browser-container";

  // URL bar
  const bar = document.createElement("div");
  bar.className = "browser-bar";

  const backBtn = document.createElement("button");
  backBtn.className = "browser-nav-btn";
  backBtn.textContent = "←";
  backBtn.title = "Back";
  backBtn.disabled = browserHistoryIdx <= 0;
  backBtn.onclick = () => browserGo(-1);

  const fwdBtn = document.createElement("button");
  fwdBtn.className = "browser-nav-btn";
  fwdBtn.textContent = "→";
  fwdBtn.title = "Forward";
  fwdBtn.disabled = browserHistoryIdx >= browserHistory.length - 1;
  fwdBtn.onclick = () => browserGo(1);

  const reloadBtn = document.createElement("button");
  reloadBtn.className = "browser-nav-btn";
  reloadBtn.textContent = "↻";
  reloadBtn.title = "Reload";
  reloadBtn.onclick = () => browserReload();

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "browser-url";
  urlInput.placeholder = "Enter URL and press Enter…";
  urlInput.spellcheck = false;
  urlInput.value = browserHistory.length > 0 ? browserHistory[browserHistoryIdx] : "";
  urlInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const url = normalizeUrl(urlInput.value.trim());
      if (url) browserNavigate(url);
    }
  });

  bar.appendChild(backBtn);
  bar.appendChild(fwdBtn);
  bar.appendChild(reloadBtn);
  bar.appendChild(urlInput);
  wrapper.appendChild(bar);

  // iframe
  const iframe = document.createElement("iframe");
  iframe.id = "browserFrame";
  iframe.sandbox = "allow-same-origin allow-scripts allow-popups allow-forms";
  iframe.style.flex = "1";
  iframe.minHeight = "200px";
  iframe.border = "none";
  iframe.width = "100%";

  // Detect load failure via timeout (X-Frame-Options, CSP, network errors)
  let loadTimer = null;
  const LOAD_TIMEOUT = 15000;

  iframe.onload = () => {
    if (loadTimer) clearTimeout(loadTimer);
    browserFrameLoaded = true;
    const urlInput = bar.querySelector(".browser-url");
    if (urlInput && browserHistory.length > 0) {
      urlInput.value = browserHistory[browserHistoryIdx];
    }
  };

  iframe.onerror = () => {
    if (loadTimer) clearTimeout(loadTimer);
    browserHandleError("Failed to load page");
  };

  // If a URL is already loaded, keep it; otherwise show splash
  if (browserHistory.length > 0 && browserHistoryIdx >= 0) {
    iframe.src = browserHistory[browserHistoryIdx];
    loadTimer = setTimeout(() => {
      // If the iframe didn't signal a load, treat it as maybe-blocked
      if (!browserFrameLoaded) {
        browserHandleError("Page may be blocking iframe embedding (X-Frame-Options)");
      }
    }, LOAD_TIMEOUT);
  } else {
    // Show a splash state in the iframe area
    const splash = document.createElement("div");
    splash.className = "browser-splash";
    splash.innerHTML = `
      <div class="browser-splash-icon">🌐</div>
      <div class="browser-splash-text">Enter a URL above to browse</div>
    `;
    wrapper.appendChild(splash);
    iframe.style.display = "none";
  }

  wrapper.appendChild(iframe);
  container.appendChild(wrapper);

  // Focus the URL input
  setTimeout(() => urlInput.focus(), 30);
}

function normalizeUrl(input) {
  // Auto-add https:// if missing
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  // Basic sanity check
  try {
    new URL(url);
    return url;
  } catch {
    return "";
  }
}

function browserNavigate(url) {
  // Push new URL onto history (truncate forward history)
  if (browserHistoryIdx < browserHistory.length - 1) {
    browserHistory = browserHistory.slice(0, browserHistoryIdx + 1);
  }
  // Avoid duplicate consecutive entries
  if (browserHistory.length === 0 || browserHistory[browserHistory.length - 1] !== url) {
    browserHistory.push(url);
  }
  browserHistoryIdx = browserHistory.length - 1;
  browserFrameLoaded = false;

  // Set iframe src
  const frame = document.getElementById("browserFrame");
  if (frame) {
    frame.src = url;

    // Start timeout to detect blocking
    setTimeout(() => {
      if (!browserFrameLoaded) {
        browserHandleError("Page may be blocking iframe embedding (X-Frame-Options)");
      }
    }, 15000);
  }

  // Update URL input
  const bar = document.querySelector(".browser-bar");
  const urlInput = bar?.querySelector(".browser-url");
  if (urlInput) urlInput.value = url;

  // Update navigation buttons
  browserUpdateNav();
}

function browserGo(delta) {
  const newIdx = browserHistoryIdx + delta;
  if (newIdx < 0 || newIdx >= browserHistory.length) return;
  browserHistoryIdx = newIdx;
  browserFrameLoaded = false;
  const url = browserHistory[browserHistoryIdx];
  const frame = document.getElementById("browserFrame");
  if (frame) {
    frame.src = url;
    setTimeout(() => {
      if (!browserFrameLoaded) {
        browserHandleError("Page may be blocking iframe embedding");
      }
    }, 15000);
  }
  const bar = document.querySelector(".browser-bar");
  const urlInput = bar?.querySelector(".browser-url");
  if (urlInput) urlInput.value = url;
  browserUpdateNav();
}

function browserReload() {
  if (browserHistory.length === 0 || browserHistoryIdx < 0) return;
  browserFrameLoaded = false;
  const frame = document.getElementById("browserFrame");
  if (frame) {
    frame.src = frame.src; // re-trigger load
    setTimeout(() => {
      if (!browserFrameLoaded) {
        browserHandleError("Page may be blocking iframe embedding");
      }
    }, 15000);
  }
  browserUpdateNav();
}

function browserUpdateNav() {
  const bar = document.querySelector(".browser-bar");
  if (!bar) return;
  const btns = bar.querySelectorAll(".browser-nav-btn");
  if (btns[0]) btns[0].disabled = browserHistoryIdx <= 0;
  if (btns[1]) btns[1].disabled = browserHistoryIdx >= browserHistory.length - 1;
}

function browserHandleError(msg) {
  // Put a message in the chat
  const url = browserHistory.length > 0 ? browserHistory[browserHistoryIdx] : "";
  appendMessage("assistant", `⚠️ **Browser**: ${msg}${url ? `\n\nAttempted URL: \`${url}\`` : ""}\n\nMany sites (Google, GitHub, etc.) block iframe embedding via \`X-Frame-Options\`. Try a docs site, Wikipedia, or personal blog.`);

  // If this was the first load, revert to previous tab
  if (!browserHistory.length || browserHistoryIdx === 0) {
    // Switch back to previous tab
    activeRightMode = previousRightMode;
    // Update tab UI
    document.querySelectorAll("#rightModeTabs .tab").forEach(t => {
      t.classList.toggle("active", t.dataset.mode === activeRightMode);
    });
    renderRightPane();
  } else {
    // Keep browser tab but show error state in it
    const splash = document.querySelector(".browser-splash");
    if (splash) {
      splash.innerHTML = `
        <div class="browser-splash-icon">🚫</div>
        <div class="browser-splash-text">${msg}</div>
        <div class="browser-splash-hint">Try a different URL or check the chat for details</div>
      `;
      const iframe = document.getElementById("browserFrame");
      if (iframe) iframe.style.display = "none";
      splash.style.display = "";
    }
    browserFrameLoaded = false;
  }
}

// ============================================================
// Command Palette (Ctrl+K)
// ============================================================

let commandPaletteVisible = false;

function toggleCommandPalette() {
  if (commandPaletteVisible) { hideCommandPalette(); } else { showCommandPalette(); }
}

function showCommandPalette() {
  if (document.getElementById("cmdPalette")) return;
  commandPaletteVisible = true;

  const overlay = document.createElement("div");
  overlay.id = "cmdPalette";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:600;background:rgba(2,6,23,0.75);
    display:flex;align-items:flex-start;justify-content:center;padding-top:80px;
    backdrop-filter:blur(4px);
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    background:var(--bg-elevated);border:1px solid var(--border-mid);border-radius:10px;
    width:480px;max-width:90vw;box-shadow:var(--shadow-soft);overflow:hidden;
  `;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search projects, chats, actions…";
  input.style.cssText = `
    width:100%;background:transparent;border:none;border-bottom:1px solid var(--border-subtle);
    color:var(--text);padding:14px 16px;font-size:14px;font-family:var(--font-sans);outline:none;
  `;

  const results = document.createElement("ul");
  results.style.cssText = "list-style:none;margin:0;padding:6px 0;max-height:320px;overflow-y:auto;";

  // Build command list
  const commands = [
    { label: "＋ New Project",           action: onNewProject },
    { label: "＋ New Chat",              action: onNewChat },
    { label: "⚡ Focus Model Swap",      action: () => document.getElementById("otfmsEngineSelect").focus() },
    { label: "📎 Attach File",           action: () => document.getElementById("fileInput").click() },
    { label: "⧉ Toggle Split View",     action: cycleSplitMode },
    { label: "✏️ Spellcheck Last Message", action: () => triggerWorkflowAction("SpellcheckWorkflow") },
    { label: "ℹ️ Version Info",          action: () => triggerWorkflowAction("VersionInfoWorkflow") },
    { label: "🔍 Check for Updates",    action: () => window.checkForUpdates?.() },
    { label: "⚙️ Open Settings",         action: () => window.openSettingsPanel?.() },
    { label: "📋 Export Chat",           action: exportChat },
    { label: "⌨️ Keyboard Shortcuts",   action: showShortcutOverlay },
  ];

  // Add project-switch commands
  document.querySelectorAll("#projectList li").forEach(li => {
    commands.push({ label: `📁 Switch to: ${li.dataset.project}`, action: () => selectProject(li.dataset.project) });
  });

  function renderResults(filter) {
    results.innerHTML = "";
    const filtered = filter
      ? commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()))
      : commands;
    filtered.forEach(cmd => {
      const li = document.createElement("li");
      li.textContent = cmd.label;
      li.style.cssText = "padding:9px 16px;cursor:pointer;font-size:13px;color:var(--text-muted);transition:background 0.1s;";
      li.onmouseenter = () => li.style.background = "var(--accent-soft)";
      li.onmouseleave = () => li.style.background = "";
      li.onclick = () => { hideCommandPalette(); cmd.action(); };
      results.appendChild(li);
    });
    if (filtered.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No results";
      li.style.cssText = "padding:9px 16px;font-size:12px;color:var(--text-dim);";
      results.appendChild(li);
    }
  }

  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.stopPropagation(); hideCommandPalette(); }
    if (e.key === "Enter") {
      const first = results.querySelector("li");
      if (first) first.click();
    }
  });

  overlay.addEventListener("click", e => { if (e.target === overlay) hideCommandPalette(); });

  box.appendChild(input);
  box.appendChild(results);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  renderResults("");
  setTimeout(() => input.focus(), 30);
}

function hideCommandPalette() {
  commandPaletteVisible = false;
  document.getElementById("cmdPalette")?.remove();
}

// ============================================================
// Workflow Actions — SpellcheckWorkflow, VoiceChat, VersionInfo
// ============================================================

async function triggerWorkflowAction(workflowName) {
  if (!currentProject) { showToast("Select a project first."); return; }

  if (workflowName === "SpellcheckWorkflow") {
    // Find last user message text
    const userMsgs = chatContainer.querySelectorAll(".message.user .message-body");
    const lastText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].textContent.trim() : "";
    if (!lastText) { showToast("No message to spellcheck."); return; }
    const thinking = appendMessage("assistant", "");
    thinking.classList.add("thinking");
    try {
      const res = await runWorkflow("SpellcheckWorkflow", { text: lastText });
      thinking.remove();
      const corrected = res.corrected || res.result || res.reply || lastText;
      appendMessage("assistant", `**Spellcheck result:**\n\n${corrected}`);
    } catch (err) {
      thinking.remove();
      showError(`Spellcheck failed: ${err.message}`);
    }
    return;
  }

  if (workflowName === "VoiceChatWorkflow") {
    // Use browser's Web Speech API for voice input, send via SendMessage
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      showError("Voice input is not supported in this browser/WebView.");
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    showToast("🎤 Listening…");
    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      document.getElementById("messageInput").value = transcript;
      sendMessageFromUI();
    };
    rec.onerror = (e) => showError(`Voice recognition error: ${e.error}`);
    rec.start();
    return;
  }

  if (workflowName === "VersionInfoWorkflow") {
    const thinking = appendMessage("assistant", "");
    thinking.classList.add("thinking");
    try {
      const res = await runWorkflow("VersionInfoWorkflow", {});
      thinking.remove();
      const info = res.version || res.result || res.reply || JSON.stringify(res);
      appendMessage("assistant", `**ProtoAI Version Info:**\n\n${info}`);
    } catch (err) {
      thinking.remove();
      showError(`Version info failed: ${err.message}`);
    }
    return;
  }
}

// ============================================================
// Add Source
// ============================================================

async function onAddSource() {
  const url = prompt("Enter a URL or paste text to add as a source:");
  if (!url?.trim()) return;
  const isUrl = /^https?:\/\//i.test(url.trim());
  if (isUrl) {
    showToast("📚 Fetching source…");
    try {
      const res = await runWorkflow("UploadWorkflow", {
        project: currentProject || "default",
        filename: `source_${Date.now()}.url`,
        content: url.trim(),
      });
      showToast("✅ Source added to project");
    } catch (err) {
      showError(`Could not add source: ${err.message}`);
    }
  } else {
    // Treat as plain text source
    if (!currentProject) { showToast("Select a project first."); return; }
    try {
      await runWorkflow("UploadWorkflow", {
        project: currentProject,
        filename: `source_${Date.now()}.txt`,
        content: url.trim(),
      });
      showToast("✅ Text source added");
    } catch (err) {
      showError(`Could not add source: ${err.message}`);
    }
  }
}

// ============================================================
// Export Chat
// ============================================================

// ============================================================
// Ingest — scan project directory and load file contents into context
// ============================================================

async function triggerIngest() {
  if (!currentProject) { showToast("Select a project first."); return; }

  // Open file picker to let user choose files to ingest
  document.getElementById("fileInput").click();

  // After files are attached, call the backend ingest to index them
  const thinking = appendMessage("assistant", "");
  thinking.classList.add("thinking");
  try {
    const res = await runWorkflow("UploadWorkflow", {
      project: currentProject,
      filename: ".ingest_trigger",
      content: new Date().toISOString(),
    });
    thinking.remove();
    const fileCount = attachedFiles.length;
    appendMessage("assistant", `✅ **Code ingested** — ${fileCount} file(s) attached to project "${currentProject}". Their contents are available as context for future messages.`);
  } catch (err) {
    thinking.remove();
    showError(`Ingest failed: ${err.message}`);
  }
}

// ============================================================
// File Permissions — manage AI editing access per project
// ============================================================

async function showFilePermissionsDialog() {
  if (!currentProject) { showToast("Select a project first."); return; }

  // Load current permissions
  let permissions;
  try {
    permissions = await runWorkflow("FilePermissionsWorkflow", {
      action: "list",
      project: currentProject
    });
  } catch (err) {
    showError(`Failed to load permissions: ${err.message}`);
    return;
  }

  // Build a dialog
  const dialog = document.createElement("div");
  dialog.style.cssText = `
    position:fixed;inset:0;z-index:600;background:rgba(2,6,23,0.75);
    display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);
  `;

  dialog.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--border-mid);border-radius:10px;width:500px;max-width:90vw;box-shadow:var(--shadow-soft);color:var(--text);">
      <div style="padding:16px 18px 12px;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;font-size:14px;">🔒 File Permissions</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Project: ${currentProject} • Default: <strong>${permissions.defaultPolicy}</strong></div>
        </div>
        <button id="permClose" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;line-height:1;">✕</button>
      </div>
      <div id="permList" style="padding:12px 18px;max-height:200px;overflow-y:auto;font-size:12px;"></div>
      <div style="padding:12px 18px;border-top:1px solid var(--border-subtle);">
        <div id="permActions" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;"></div>
        <div id="permForm" style="display:flex;gap:6px;align-items:center;margin-top:8px;">
          <select id="permTypeSelect" style="flex:0 0 90px;background:var(--bg-elevated-2);border:1px solid var(--border-subtle);color:var(--text);border-radius:6px;padding:4px 6px;font-size:12px;">
            <option value="file">File</option>
            <option value="directory">Directory</option>
            <option value="pattern">Pattern</option>
          </select>
          <select id="permTierSelect" style="flex:0 0 70px;background:var(--bg-elevated-2);border:1px solid var(--border-subtle);color:var(--text);border-radius:6px;padding:4px 6px;font-size:11px;">
            <option value="eager">eager</option>
            <option value="cached">cached</option>
            <option value="lazy">lazy</option>
          </select>
          <input id="permPathInput" type="text" placeholder="e.g. src/components/App.jsx" style="flex:1;background:var(--bg-elevated-2);border:1px solid var(--border-subtle);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;" />
          <button class="primary" id="permGrantBtn" style="font-size:12px;padding:5px 12px;">Grant</button>
        </div>
        <div id="permDefaultRow" style="display:flex;gap:6px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);">
          <span style="font-size:11px;color:var(--text-muted);">Default policy:</span>
          <button id="permAllowBtn" class="secondary" style="font-size:11px;padding:3px 10px;border-radius:4px;">Allow All</button>
          <button id="permDenyBtn" class="secondary" style="font-size:11px;padding:3px 10px;border-radius:4px;">Deny All</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  // Close on overlay click or ✕
  const closeDialog = () => dialog.remove();
  dialog.addEventListener("click", e => { if (e.target === dialog) closeDialog(); });
  dialog.querySelector("#permClose").onclick = closeDialog;

  // Render permission list
  function renderPerms() {
    const list = dialog.querySelector("#permList");
    const actions = dialog.querySelector("#permActions");
    list.innerHTML = "";
    actions.innerHTML = "";

    if (permissions.grantedPaths.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:12px;">No editing permissions granted yet</div>';
    } else {
      permissions.grantedPaths.forEach((g, i) => {
        const icon = g.type === "directory" ? "📁" : g.type === "file" ? "📄" : "🔗";
        const tierColors = { eager: "#4caf50", cached: "#2196f3", lazy: "#f59e0b" };
        const tierColor = tierColors[g.tier || "eager"] || tierColors.eager;
        const div = document.createElement("div");
        div.style.cssText = "padding:6px 8px;display:flex;align-items:center;gap:6px;border-radius:6px;";
        div.innerHTML = `
          <span style="cursor:default;">${icon}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${g.path}</span>
          <select data-tier-idx="${i}" style="font-size:10px;background:var(--bg-elevated-2);border:1px solid ${tierColor};color:${tierColor};border-radius:4px;padding:1px 4px;cursor:pointer;">
            <option value="eager" ${(g.tier||"eager")==="eager"?"selected":""}>eager</option>
            <option value="cached" ${(g.tier||"eager")==="cached"?"selected":""}>cached</option>
            <option value="lazy" ${(g.tier||"eager")==="lazy"?"selected":""}>lazy</option>
          </select>
          <span style="font-size:10px;color:var(--text-dim);white-space:nowrap;">${new Date(g.grantedAt).toLocaleDateString()}</span>
          <button data-revoke="${i}" style="background:none;border:none;color:var(--color-error);cursor:pointer;font-size:12px;flex-shrink:0;" title="Revoke">✕</button>
        `;
        list.appendChild(div);
      });
    }
  }
  renderPerms();

  // Revoke button delegation on permList
  dialog.querySelector("#permList").addEventListener("click", e => {
    const btn = e.target.closest("[data-revoke]");
    if (btn) {
      const idx = parseInt(btn.dataset.revoke);
      const target = permissions.grantedPaths[idx];
      triggerPermissionAction("revoke", target.type, target.path, () => {
        permissions.grantedPaths.splice(idx, 1);
        renderPerms();
      });
    }
  });

  // Tier select change — saves to permissions file via workflow
  dialog.querySelector("#permList").addEventListener("change", e => {
    const sel = e.target.closest("[data-tier-idx]");
    if (!sel) return;
    const idx = parseInt(sel.dataset.tierIdx);
    const target = permissions.grantedPaths[idx];
    triggerPermissionAction("set-tier", target.type, target.path, (result) => {
      permissions.grantedPaths[idx].tier = result.tier;
      renderPerms();
    }, sel.value);
  });

  // Grant button
  dialog.querySelector("#permGrantBtn").onclick = async () => {
    const typeSelect = dialog.querySelector("#permTypeSelect");
    const tierSelect = dialog.querySelector("#permTierSelect");
    const pathInput = dialog.querySelector("#permPathInput");
    const targetPath = pathInput.value.trim();
    if (!targetPath) return;

    const type = typeSelect.value;
    const grantTier = tierSelect ? tierSelect.value : "eager";
    await triggerPermissionAction("grant", type, targetPath, grantTier, (result) => {
      permissions.grantedPaths.push({
        type: result.granted.type,
        path: result.granted.path,
        tier: result.granted.tier || "eager",
        grantedAt: result.granted.grantedAt
      });
      pathInput.value = "";
      renderPerms();
    });
  };

  // Default policy buttons
  dialog.querySelector("#permAllowBtn").onclick = async () => {
    await triggerPermissionAction("set-default", "policy", "allow", () => {
      permissions.defaultPolicy = "allow";
      dialog.querySelector("#permList").previousElementSibling.querySelector("strong").textContent = "allow";
      closeDialog(); showFilePermissionsDialog();
    });
  };

  dialog.querySelector("#permDenyBtn").onclick = async () => {
    await triggerPermissionAction("set-default", "policy", "deny", () => {
      permissions.defaultPolicy = "deny";
      dialog.querySelector("#permList").previousElementSibling.querySelector("strong").textContent = "deny";
      closeDialog(); showFilePermissionsDialog();
    });
  };
}

async function triggerPermissionAction(action, type, target, onSuccess, tierValue) {
  try {
    let payload = { action, project: currentProject };
    if (type === "file") payload.file = target;
    else if (type === "directory") payload.directory = target;
    else if (type === "pattern") payload.pattern = target;
    else if (type === "policy") payload["default"] = target;
    if (tierValue) payload.tier = tierValue;

    const res = await runWorkflow("FilePermissionsWorkflow", payload);

    if (res.error) {
      showError(res.error);
    } else {
      showToast(res.message || "Permission updated");
      if (onSuccess) onSuccess(res);
    }
  } catch (err) {
    showError(`Permissions error: ${err.message}`);
  }
}

function exportChat() {
  const messages = chatContainer.querySelectorAll(".message");
  if (messages.length === 0) { showToast("Nothing to export."); return; }
  let text = `ProtoAI Chat Export — ${new Date().toLocaleString()}\nProject: ${currentProject || "none"}\n\n`;
  messages.forEach(msg => {
    const label = msg.querySelector(".message-label")?.textContent ?? (msg.classList.contains("user") ? "You" : "ProtoAI");
    const body  = msg.querySelector(".message-body")?.textContent ?? "";
    text += `${label}:\n${body}\n\n`;
  });
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `protoai-chat-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  showToast("💾 Chat exported");
}

// ============================================================
// Profile Detail Popover
// ============================================================

function showProfileDetail(profileId) {
  hideProfilePopover();

  const prof = allProfiles[profileId];
  if (!prof) return;

  const badge = document.getElementById("currentProfileName");
  if (!badge) return;

  const popover = document.createElement("div");
  popover.id = "profilePopover";
  const rect = badge.getBoundingClientRect();
  popover.style.cssText = `
    position:fixed;top:${rect.bottom + 8}px;left:${rect.left}px;z-index:300;
    background:var(--bg-elevated);border:1px solid var(--border-mid);border-radius:10px;
    padding:14px 18px;width:320px;box-shadow:var(--shadow-soft);font-size:12px;line-height:1.6;
    color:var(--text);font-family:var(--font-sans);
  `;

  // Render a clean profile card
  const rows = [
    ["Model",       prof.model],
    ["Fallback",    Array.isArray(prof.fallback) ? prof.fallback.join(" → ") : prof.fallback ?? "—"],
    ["Temperature", prof.temperature],
    ["Max Tokens",  prof.max_tokens],
    ["Verbosity",   prof.verbosity],
    ["Format",      prof.format],
    ["Memory Mode", prof.memory_mode],
    ["File Ingestion", prof.file_ingestion ? "On" : "Off"],
    ["CoT",         prof.cot],
    ["System",      prof.system],
  ];

  popover.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:var(--accent-strong);text-transform:capitalize;">${profileId}</div>
    ${rows.map(([k, v]) => `<div style="display:flex;gap:6px;padding:2px 0;"><span style="color:var(--text-dim);min-width:100px;flex-shrink:0;">${k}</span><span>${v}</span></div>`).join("")}
    <div style="border-top:1px solid var(--border-subtle);margin-top:8px;padding-top:6px;display:flex;gap:8px;">
      <button id="newProfileFromHere" class="secondary" style="font-size:11px;padding:4px 10px;">+ Clone as New Profile</button>
    </div>
  `;

  document.body.appendChild(popover);

  popover.querySelector("#newProfileFromHere")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideProfilePopover();
    showNewProfileDialog(prof);
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", hideProfilePopover, { once: true });
  }, 10);
}

function hideProfilePopover() {
  document.getElementById("profilePopover")?.remove();
}

function showNewProfileDialog(baseProfile) {
  const name = prompt("New profile name:");
  if (!name?.trim()) return;
  const id = name.trim().toLowerCase().replace(/\s+/g, "_");
  // Deep copy the base profile
  const prof = baseProfile ? { ...baseProfile } : {};
  allProfiles[id] = prof;

  // Update the select dropdown
  const sel = document.getElementById("profileSelect");
  let exists = false;
  sel.querySelectorAll("option").forEach(opt => { if (opt.value === id) exists = true; });
  if (!exists) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = name.trim();
    opt.selected = true;
    sel.appendChild(opt);
  } else {
    sel.value = id;
  }
  currentProfile = id;
  document.getElementById("currentProfileName").textContent = name.trim();
  showToast(`✅ Profile "${name.trim()}" created`);
}

// ============================================================
// Start
// ============================================================

window.addEventListener("DOMContentLoaded", async () => {
  // First-run detection — check settings, show wizard if needed
  try {
    let firstRun = true;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (typeof window.__TAURI__?.core?.invoke === "function") {
        try {
          const status = await window.__TAURI__.core.invoke("settings_first_run_status", {});

          firstRun = !!status.firstRunCompleted === false;
          break;
        } catch (_) {}
      }
      // HTTP fallback
      if (attempt > 0) {
        try {
          const r = await fetch("http://127.0.0.1:17890/settings");

          const data = await r.json();

          firstRun = !data?.settings?.firstRunCompleted;
          break;
        } catch (_) {}
      }
      await new Promise(res => setTimeout(res, 800));
    }
    if (!firstRun === false) {
      // firstRun is false (meaning firstRunCompleted is true) — proceed normally
    }
    if (firstRun) {
      window.openFirstRunWizard?.();
      return;
    }
  } catch (_) {}

  init();

  // Click on the profile badge shows detail
  document.getElementById("currentProfileName").addEventListener("click", (e) => {
    if (e.target.id === "currentProfileName" || e.target.closest("#currentProfileName")) {
      e.stopPropagation();
      if (currentProfile) showProfileDetail(currentProfile);
    }
  });

  // Profile select change
  document.getElementById("profileSelect").addEventListener("change", e => {
    currentProfile = e.target.value;
    document.getElementById("currentProfileName").textContent = currentProfile ? (currentProfile.charAt(0).toUpperCase() + currentProfile.slice(1)) : "No profile";
  });
});
