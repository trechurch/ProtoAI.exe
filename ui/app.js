// app.js — Tauri IPC version (no HTTP, no ports)
// ------------------------------------------------------------
// All backend calls now go through Tauri.invoke(), which routes
// into EngineBridge → NodeProcessBackend → server-ipc.js.
// ------------------------------------------------------------

const { invoke } = window.__TAURI__.core;

// ------------------------------------------------------------
// UI State
// ------------------------------------------------------------
let currentProject = null;
let currentProfile = null;
let currentEngine = "default"; // or whatever your UI uses
let chatContainer = null;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function appendMessage(sender, text) {
    const div = document.createElement("div");
    div.className = sender === "user" ? "msg-user" : "msg-ai";
    div.textContent = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function clearChat() {
    chatContainer.innerHTML = "";
}

// ------------------------------------------------------------
// Backend Calls (via Tauri invoke)
// ------------------------------------------------------------

async function loadProjects() {
    const res = await invoke("engine_projects");
    if (!res.ok) {
        console.error("Failed to load projects:", res.error);
        return [];
    }
    return res.data.projects || [];
}

async function loadHistory(project) {
    const res = await invoke("engine_history", { project });
    if (!res.ok) {
        console.error("Failed to load history:", res.error);
        return [];
    }
    return res.data.history || [];
}

async function loadProfiles() {
    const res = await invoke("engine_profiles");
    if (!res.ok) {
        console.error("Failed to load profiles:", res.error);
        return [];
    }
    return res.data.profiles || [];
}

async function sendChatMessage(project, profile, engine, message) {
    const res = await invoke("engine_chat", {
        project,
        profile,
        engine,
        message
    });

    if (!res.ok) {
        console.error("Chat error:", res.error);
        return { response: "Error: " + res.error };
    }

    return res.data;
}

async function uploadFile(project, filename, content) {
    const res = await invoke("engine_upload", {
        project,
        filename,
        content
    });

    if (!res.ok) {
        console.error("Upload error:", res.error);
        return false;
    }

    return true;
}

async function ingestProject(project) {
    const res = await invoke("engine_ingest", { project });

    if (!res.ok) {
        console.error("Ingest error:", res.error);
        return [];
    }

    return res.data.files || [];
}

// ------------------------------------------------------------
// UI Initialization
// ------------------------------------------------------------

async function init() {
    chatContainer = document.getElementById("chat");

    // Load profiles
    const profiles = await loadProfiles();
    const profileSelect = document.getElementById("profile");
    profileSelect.innerHTML = "";
    profiles.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id || p.name;
        opt.textContent = p.name;
        profileSelect.appendChild(opt);
    });
    if (profiles.length > 0) {
        currentProfile = profiles[0].id || profiles[0].name;
    }

    // Load projects
    const projects = await loadProjects();
    const projectSelect = document.getElementById("project");
    projectSelect.innerHTML = "";
    projects.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        projectSelect.appendChild(opt);
    });
    if (projects.length > 0) {
        currentProject = projects[0];
        await loadProjectHistory(currentProject);
    }

    // Event listeners
    profileSelect.addEventListener("change", e => {
        currentProfile = e.target.value;
    });

    projectSelect.addEventListener("change", async e => {
        currentProject = e.target.value;
        await loadProjectHistory(currentProject);
    });

    document.getElementById("send").addEventListener("click", sendMessageFromUI);
    document.getElementById("input").addEventListener("keydown", e => {
        if (e.key === "Enter") sendMessageFromUI();
    });

    document.getElementById("upload").addEventListener("change", handleUpload);
}

// ------------------------------------------------------------
// Load Project History
// ------------------------------------------------------------

async function loadProjectHistory(project) {
    clearChat();
    const history = await loadHistory(project);
    history.forEach(entry => {
        appendMessage("user", entry.user);
        appendMessage("ai", entry.ai);
    });
}

// ------------------------------------------------------------
// Sending Messages
// ------------------------------------------------------------

async function sendMessageFromUI() {
    const input = document.getElementById("input");
    const text = input.value.trim();
    if (!text) return;

    appendMessage("user", text);
    input.value = "";

    const result = await sendChatMessage(
        currentProject,
        currentProfile,
        currentEngine,
        text
    );

    appendMessage("ai", result.response || "(no response)");
}

// ------------------------------------------------------------
// Upload Handler
// ------------------------------------------------------------

async function handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const content = await file.text();
    const ok = await uploadFile(currentProject, file.name, content);

    if (ok) {
        alert("File uploaded successfully");
    } else {
        alert("Upload failed");
    }
}

// ------------------------------------------------------------
// Start UI
// ------------------------------------------------------------
window.addEventListener("DOMContentLoaded", init);
