// ============================================================
// ModelManager.ui.js — Model Inventory + Archetype Profile System
// version: 3.0.0
// depends: tauri-utils.js, BackendConnector.ui.js, LlmPolicyEngine.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── ModelManager.ui ──────────────────────────────────────
    // Manages two connected systems:
    //
    // 1. MODEL INVENTORY — full draggable table of all known
    //    models, organized by category (chat, coding, research,
    //    image, video, audio, experimental). Each row can be
    //    toggled active/inactive, reordered via drag/drop, and
    //    expanded to edit API source and category.
    //
    // 2. ARCHETYPE PROFILE SYSTEM — persona profiles (archetypes)
    //    that own their own primary/secondary model lists per
    //    capability type. When an archetype is active, LlmBridge
    //    routes to that archetype's preferred models.
    //
    // The two systems connect via "Apply to Policy" — selecting
    // an archetype pushes its model preferences into
    // LlmPolicyEngine so all downstream routing uses them.
    // ── end of ModelManager.ui ───────────────────────────────

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    const MANIFEST = {
        id:      "ModelManager.ui",
        type:    "component",
        runtime: "Browser",
        version: "3.0.0",

        capabilities: [
            "inventory.render",
            "inventory.reorder",
            "inventory.toggle",
            "inventory.categorize",
            "archetype.load",
            "archetype.activate",
            "policy.sync"
        ],
        dependencies: [
            "tauri-utils.js",
            "BackendConnector.ui.js",
            "LlmPolicyEngine.ui.js"
        ],
        docs: {
            description: "Model inventory manager and archetype profile system. Renders a draggable categorized model table and an archetype card grid. Activating an archetype syncs its model preferences into LlmPolicyEngine for downstream routing.",
            input:  { container: "DOMElement" },
            output: "void",
            author: "ProtoAI team",
            sdoa_compatibility: `
                SDOA Compatibility Contract:
                - v1.2 Manifest is minimum requirement.
                - v3.0 adds actions surface additively.
                - Lower versions ignore unknown fields.
                - Higher versions preserve old semantics.
                - All versions forward/backward compatible.
            `
        },
        actions: {
            commands: {
                render:          { description: "Render the full manager into a container.", input: { container: "DOMElement" }, output: "void" },
                activateArchetype: { description: "Set an archetype as active and sync to policy.", input: { id: "string" }, output: "void" },
                getActiveModels: { description: "Return currently active model list.", input: {}, output: "Model[]" }
            },
            triggers: {
                archetypeActivated: { description: "Fires when an archetype becomes active.", payload: { id: "string", name: "string" } },
                inventoryReordered: { description: "Fires when the model order changes.", payload: { models: "Model[]" } }
            },
            emits: {
                policyUpdated: { description: "Emits after LlmPolicyEngine is synced.", payload: { archetype: "string" } }
            },
            workflows: {
                activateArchetype: { description: "Archetype activation + policy sync workflow.", input: { id: "string" }, output: "void" }
            }
        }
    };
    // ── end of SDOA v3.0 MANIFEST ────────────────────────────

    // ── CATEGORY DEFINITIONS ─────────────────────────────────
    const CATEGORIES = [
        { id: "chat",         label: "💬 Chat",         color: "#60a5fa" },
        { id: "coding",       label: "💻 Coding",       color: "#34d399" },
        { id: "research",     label: "🔎 Research",     color: "#a78bfa" },
        { id: "reasoning",    label: "🧠 Reasoning",    color: "#f59e0b" },
        { id: "image",        label: "🖼 Image",        color: "#f472b6" },
        { id: "video",        label: "🎬 Video",        color: "#fb923c" },
        { id: "audio",        label: "🎵 Audio",        color: "#38bdf8" },
        { id: "music",        label: "🎼 Music",        color: "#c084fc" },
        { id: "experimental", label: "🧪 Experimental", color: "#6ee7b7" },
        { id: "assistant",    label: "🤖 Assistant",    color: "#94a3b8" },
        { id: "router",       label: "🔀 Router",       color: "#71717a" },
    ];

    const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
    // ── end of CATEGORY DEFINITIONS ──────────────────────────

    // ── MODEL INVENTORY ───────────────────────────────────────
    // Canonical list. Each entry: id, name, api, category, active.
    // Loaded from backend on init; falls back to this default.
    // ── end of MODEL INVENTORY ───────────────────────────────

    const DEFAULT_MODELS = [
        // ── free / chat ──────────────────────────────────────
        { id: "nv-super-free",       name: "nvidia/nemotron-3-super-120b-a12b:free",              api: "openrouter", category: "research",     active: true },
        { id: "nv-nano30-free",      name: "nvidia/nemotron-3-nano-30b-a3b:free",                 api: "openrouter", category: "coding",        active: true },
        { id: "gpt-oss-120-free",    name: "openai/gpt-oss-120b:free",                            api: "openrouter", category: "chat",          active: true },
        { id: "nv-nano12vl-free",    name: "nvidia/nemotron-nano-12b-v2-vl:free",                 api: "openrouter", category: "chat",          active: true },
        { id: "nv-nano9-free",       name: "nvidia/nemotron-nano-9b-v2:free",                     api: "openrouter", category: "chat",          active: true },
        { id: "gpt-oss-20-free",     name: "openai/gpt-oss-20b:free",                             api: "openrouter", category: "chat",          active: true },
        { id: "openrouter-free",     name: "openrouter/free",                                     api: "openrouter", category: "router",        active: true },
        // ── coding ───────────────────────────────────────────
        { id: "qwen-coder-30b",      name: "qwen/qwen3-coder-30b-a3b-instruct",                   api: "openrouter", category: "coding",        active: true },
        { id: "qwen-coder-next",     name: "qwen/qwen3-coder-next",                               api: "openrouter", category: "coding",        active: true },
        { id: "qwen-coder-flash",    name: "qwen/qwen3-coder-flash",                              api: "openrouter", category: "coding",        active: true },
        { id: "qwen-coder",          name: "qwen/qwen3-coder",                                    api: "openrouter", category: "coding",        active: true },
        { id: "mercury-coder",       name: "inception/mercury-coder",                             api: "openrouter", category: "coding",        active: true },
        { id: "grok-code-fast",      name: "x-ai/grok-code-fast-1",                              api: "openrouter", category: "coding",        active: true },
        { id: "codestral",           name: "mistralai/codestral-2508",                            api: "openrouter", category: "coding",        active: true },
        { id: "kat-coder-pro",       name: "kwaipilot/kat-coder-pro-v2",                         api: "openrouter", category: "coding",        active: true },
        { id: "solidity-llama",      name: "alfredpros/codellama-7b-instruct-solidity",           api: "openrouter", category: "coding",        active: true },
        { id: "deepseek-prover",     name: "deepseek/deepseek-prover-v2",                         api: "openrouter", category: "reasoning",     active: true },
        // ── research / chat ───────────────────────────────────
        { id: "gemini-25-pro",       name: "google/gemini-2.5-pro",                               api: "openrouter", category: "chat",          active: true },
        { id: "gemini-25-pro-prev",  name: "google/gemini-2.5-pro-preview",                       api: "openrouter", category: "chat",          active: true },
        { id: "gemini-25-pro-prev2", name: "google/gemini-2.5-pro-preview-05-06",                 api: "openrouter", category: "chat",          active: true },
        { id: "gemini-31-pro",       name: "google/gemini-3.1-pro-preview",                       api: "openrouter", category: "chat",          active: true },
        { id: "gemini-31-pro-tools", name: "google/gemini-3.1-pro-preview-customtools",           api: "openrouter", category: "chat",          active: true },
        { id: "sonar-reason-pro",    name: "perplexity/sonar-reasoning-pro",                      api: "openrouter", category: "research",      active: true },
        { id: "sonar-pro-search",    name: "perplexity/sonar-pro-search",                         api: "openrouter", category: "research",      active: true },
        { id: "sonar-pro",           name: "perplexity/sonar-pro",                                api: "openrouter", category: "chat",          active: true },
        { id: "nv-super-paid",       name: "nvidia/nemotron-3-super-120b-a12b",                   api: "openrouter", category: "research",      active: true },
        { id: "xiaomi-mimo-pro",     name: "xiaomi/mimo-v2-pro",                                  api: "openrouter", category: "chat",          active: true },
        { id: "inflection-3",        name: "inflection/inflection-3-productivity",                api: "openrouter", category: "assistant",     active: true },
        // ── experimental ─────────────────────────────────────
        { id: "deepseek-v32-exp",    name: "deepseek/deepseek-v3.2-exp",                          api: "openrouter", category: "experimental",  active: true },
        { id: "gemini-20-flash-exp", name: "google/gemini-2.0-flash-exp",                         api: "openrouter", category: "experimental",  active: true },
        { id: "gemini-exp-1121",     name: "google/gemini-exp-1121",                              api: "openrouter", category: "experimental",  active: true },
        { id: "gemini-exp-1114",     name: "google/gemini-exp-1114",                              api: "openrouter", category: "experimental",  active: true },
        { id: "gemini-flash-15-exp", name: "google/gemini-flash-1.5-exp",                         api: "openrouter", category: "experimental",  active: true },
        { id: "gemini-pro-15-exp",   name: "google/gemini-pro-1.5-exp",                           api: "openrouter", category: "experimental",  active: true },
        { id: "dolphin-venice-free", name: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", api: "openrouter", category: "experimental", active: true },
        // ── music ─────────────────────────────────────────────
        { id: "lyria-pro",           name: "google/lyria-3-pro-preview",                          api: "openrouter", category: "music",         active: true },
        // ── video ─────────────────────────────────────────────
        { id: "wan-26",              name: "alibaba/wan-2.6",                                     api: "openrouter", category: "video",         active: true },
        { id: "seedance-pro",        name: "bytedance/seedance-1-5-pro",                          api: "openrouter", category: "video",         active: true },
        { id: "sora-2-pro",          name: "openai/sora-2-pro",                                   api: "openrouter", category: "video",         active: true },
        { id: "veo-31",              name: "google/veo-3.1",                                      api: "openrouter", category: "video",         active: true },
        // ── image ─────────────────────────────────────────────
        { id: "riverflow-pro",       name: "sourceful/riverflow-v2-pro",                          api: "openrouter", category: "image",         active: true },
        { id: "riverflow-max",       name: "sourceful/riverflow-v2-max-preview",                  api: "openrouter", category: "image",         active: true },
        { id: "riverflow-std",       name: "sourceful/riverflow-v2-standard-preview",             api: "openrouter", category: "image",         active: true },
        { id: "riverflow-fast",      name: "sourceful/riverflow-v2-fast-preview",                 api: "openrouter", category: "image",         active: true },
        { id: "gemini-25-img",       name: "google/gemini-2.5-flash-image-preview",               api: "openrouter", category: "image",         active: true },
        { id: "gemini-31-img",       name: "google/gemini-3.1-flash-image-preview",               api: "openrouter", category: "image",         active: true },
        { id: "gemini-3-img",        name: "google/gemini-3-pro-image-preview",                   api: "openrouter", category: "image",         active: true },
        { id: "flux2-pro",           name: "black-forest-labs/flux.2-pro",                        api: "openrouter", category: "image",         active: true },
        { id: "grok-vision-1212",    name: "x-ai/grok-2-vision-1212",                             api: "openrouter", category: "image",         active: true },
        { id: "grok-vision-beta",    name: "x-ai/grok-vision-beta",                               api: "openrouter", category: "image",         active: true },
        { id: "llama-90b-vision",    name: "meta-llama/llama-3.2-90b-vision-instruct",            api: "openrouter", category: "image",         active: true },
        { id: "yi-vision",           name: "01-ai/yi-vision",                                     api: "openrouter", category: "image",         active: true },
        { id: "nous-vision",         name: "nousresearch/nous-hermes-2-vision-7b",                api: "openrouter", category: "image",         active: true },
        { id: "gpt4-vision",         name: "openai/gpt-4-vision-preview",                         api: "openrouter", category: "image",         active: true },
        // ── audio ─────────────────────────────────────────────
        { id: "gpt4o-audio",         name: "openai/gpt-4o-audio-preview",                         api: "openrouter", category: "audio",         active: true },
        { id: "inflection-voice",    name: "inflection/inflection-3-productivity",                api: "openrouter", category: "audio",         active: true },
        { id: "cogito-405b",         name: "deepcogito/cogito-v2-preview-llama-405b",             api: "openrouter", category: "audio",         active: true },
        { id: "deephermes",          name: "nousresearch/deephermes-3-mistral-24b-preview",       api: "openrouter", category: "audio",         active: true },
    ];

    // ── ARCHETYPE DEFINITIONS ─────────────────────────────────
    // Loaded from data/archetypes/*.json via backend on init.
    // This is the fallback if the backend isn't available.
    // ── end of ARCHETYPE DEFINITIONS ─────────────────────────

    const DEFAULT_ARCHETYPES = [
        {
            id: "coding-super-hero",
            name: "Coding Super Hero",
            emoji: "💻",
            description: "Codes like a force of nature — full-stack mastery, instant debug/deploy.",
            voice: "hype, cocky, rapid-fire",
            primaryModels: ["nvidia/nemotron-3-nano-30b-a3b:free", "qwen/qwen3-coder-30b-a3b-instruct", "qwen/qwen3-coder-next", "inception/mercury-coder", "x-ai/grok-code-fast-1"],
            secondaryModels: { general: ["mistralai/codestral-2508", "kwaipilot/kat-coder-pro-v2", "deepseek/deepseek-prover-v2"] }
        },
        {
            id: "deep-thinking-research-assistant",
            name: "Deep Thinking Research Assistant",
            emoji: "🔎",
            description: "Methodically searches web, breaks complex concepts into relatable examples, uncovers obscure facts.",
            voice: "calm, deliberate, professorial",
            primaryModels: ["nvidia/nemotron-3-super-120b-a12b:free", "openai/gpt-oss-120b:free", "google/gemini-2.5-pro", "perplexity/sonar-reasoning-pro"],
            secondaryModels: { general: ["google/gemini-3.1-pro-preview", "perplexity/sonar-pro-search", "perplexity/sonar-pro"] }
        },
        {
            id: "artistic-savant",
            name: "Artistic Savant",
            emoji: "🎨",
            description: "Museum-grade images, videos, audio — cinematic perfection.",
            voice: "smooth, cinematic, poetic",
            primaryModels: ["nvidia/nemotron-nano-12b-v2-vl:free", "google/gemini-2.5-pro-preview", "xiaomi/mimo-v2-pro"],
            secondaryModels: {
                music:  ["google/lyria-3-pro-preview"],
                video:  ["alibaba/wan-2.6", "bytedance/seedance-1-5-pro", "openai/sora-2-pro", "google/veo-3.1"],
                image:  ["sourceful/riverflow-v2-pro", "sourceful/riverflow-v2-max-preview", "black-forest-labs/flux.2-pro", "google/gemini-3-pro-image-preview"],
                voice:  ["openai/gpt-4o-audio-preview"]
            }
        },
        {
            id: "ruthless-strategist",
            name: "Ruthless Strategist",
            emoji: "♟",
            description: "CEO-level planning, risk assessment, competitor analysis, zero mercy execution.",
            voice: "sharp, authoritative, direct",
            primaryModels: ["nvidia/nemotron-3-super-120b-a12b:free"],
            secondaryModels: { general: ["google/gemini-3.1-pro-preview-customtools"] }
        },
        {
            id: "perfect-poet-coo",
            name: "Perfect Poet & COO",
            emoji: "✍️",
            description: "From H-Town screwed jams to Oscar screenplays, FB posts to full business proposals.",
            voice: "elegant, commanding, rhythmic",
            primaryModels: ["google/gemini-3.1-pro-preview-customtools", "inflection/inflection-3-productivity"],
            secondaryModels: { voice: ["openai/gpt-4o-audio-preview"] }
        },
        {
            id: "data-oracle",
            name: "Data Oracle",
            emoji: "📊",
            description: "Stats wizard, trend prediction, instant visualizations.",
            voice: "precise, neutral, factual",
            primaryModels: ["perplexity/sonar-reasoning-pro"],
            secondaryModels: { general: ["perplexity/sonar-pro"] }
        },
        {
            id: "empathetic-therapist",
            name: "Empathetic Therapist",
            emoji: "💚",
            description: "Active listening, emotional support, crisis de-escalation.",
            voice: "warm, steady, gentle",
            primaryModels: ["openai/gpt-oss-20b:free"],
            secondaryModels: { general: ["inflection/inflection-3-productivity"] }
        },
        {
            id: "meme-lord-chaos-agent",
            name: "Meme Lord / Chaos Agent",
            emoji: "🌀",
            description: "Predicts trends, hacks culture, viral memes, unfiltered takes.",
            voice: "cryptic, sarcastic, rapid-fire",
            primaryModels: ["openai/gpt-oss-20b:free"],
            secondaryModels: { general: ["x-ai/grok-code-fast-1"] }
        },
        {
            id: "girl-next-door",
            name: "ARA",
            emoji: "✨",
            description: "Shifts from innocent to NSA — boundary-pushing empathy and roleplay.",
            voice: "sweet-to-sultry",
            primaryModels: ["nvidia/nemotron-nano-9b-v2:free", "openai/gpt-oss-20b:free"],
            secondaryModels: { voice: ["openai/gpt-4o-audio-preview"] }
        },
    ];
    // ── end of ARCHETYPE DEFINITIONS ─────────────────────────

    // ── module state ─────────────────────────────────────────
    let _models          = JSON.parse(JSON.stringify(DEFAULT_MODELS));
    let _archetypes      = JSON.parse(JSON.stringify(DEFAULT_ARCHETYPES));
    let _activeArchetype = null;
    let _draggedIndex    = null;
    let _editingIndex    = null;
    let _listeners       = [];
    let _activeTab       = "archetypes"; // "archetypes" | category id
    // ── end of module state ──────────────────────────────────

    // ── event emitter ────────────────────────────────────────

    function on(event, handler) { _listeners.push({ event, handler }); }

    function emit(event, data) {
        for (const l of _listeners) {
            if (l.event === event) {
                try { l.handler(data); } catch (e) {
                    console.error(`[ModelManager.ui] Listener error (${event}):`, e);
                }
            }
        }
    }

    // ── end of event emitter ─────────────────────────────────

    // ── _connector ───────────────────────────────────────────

    function _connector() {
        return window.backendConnector || null;
    }

    // ── end of _connector ────────────────────────────────────

    // ── render ───────────────────────────────────────────────
    // Main entry point. Builds the full manager UI into the
    // given container. Called from settings tab or directly.
    // ── end of render ────────────────────────────────────────

    async function render(container) {
        if (!container) return;

        // Try to load saved state from backend
        await _loadState();

        container.innerHTML = `
            <div class="mm-root">

                <!-- TAB BAR -->
                <div class="mm-tabbar" id="mmTabBar"></div>

                <!-- TAB CONTENT -->
                <div class="mm-content" id="mmContent"></div>

                <!-- MODEL DETAIL MODAL -->
                <div class="mm-modal hidden" id="mmModal">
                    <div class="mm-modal-inner">
                        <div class="mm-modal-header">
                            <span id="mmModalName" style="font-weight:600;font-size:14px;"></span>
                            <button class="icon-btn" id="mmModalClose">&times;</button>
                        </div>
                        <div class="mm-modal-body">
                            <div class="setting-row">
                                <label>API Source</label>
                                <select id="mmModalApi" class="settings-select">
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="openai">OpenAI</option>
                                    <option value="google">Google</option>
                                    <option value="local">Local / Ollama</option>
                                </select>
                            </div>
                            <div class="setting-row">
                                <label>Category</label>
                                <select id="mmModalCategory" class="settings-select">
                                    ${CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join("")}
                                </select>
                            </div>
                            <div class="setting-row">
                                <label>Active</label>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="mmModalActive" />
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <div class="mm-modal-footer">
                            <button class="primary" id="mmModalSave">Save</button>
                            <button class="secondary" id="mmModalCancel">Cancel</button>
                        </div>
                    </div>
                </div>

            </div>
        `;

        _injectStyles();
        _buildTabBar(container);
        _renderTab(container, _activeTab);
        _wireModal(container);
    }

    // ── _buildTabBar ─────────────────────────────────────────

    function _buildTabBar(container) {
        const bar = container.querySelector("#mmTabBar");
        if (!bar) return;

        const tabs = [
            { id: "archetypes", label: "🎭 Archetypes" },
            ...CATEGORIES
        ];

        bar.innerHTML = tabs.map(t => `
            <button class="mm-tab ${_activeTab === t.id ? "active" : ""}"
                    data-tab="${t.id}">
                ${t.label || t.id}
            </button>
        `).join("");

        bar.querySelectorAll(".mm-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                _activeTab = btn.dataset.tab;
                bar.querySelectorAll(".mm-tab").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                _renderTab(container, _activeTab);
            });
        });
    }

    // ── _renderTab ───────────────────────────────────────────

    function _renderTab(container, tabId) {
        const content = container.querySelector("#mmContent");
        if (!content) return;

        if (tabId === "archetypes") {
            _renderArchetypes(content);
        } else {
            _renderInventory(content, tabId);
        }
    }

    // ── _renderArchetypes ────────────────────────────────────
    // Renders the archetype card grid. Each card shows the
    // persona emoji, name, description, voice, and primary
    // models. Active archetype is highlighted. Clicking a
    // card activates it and syncs to LlmPolicyEngine.
    // ── end of _renderArchetypes ─────────────────────────────

    function _renderArchetypes(content) {
        content.innerHTML = `
            <div class="mm-archetype-header">
                <p style="font-size:12px;color:var(--text-dim,#666);margin:0 0 12px;">
                    Select an archetype to activate its persona and model routing preferences.
                    The active archetype's models will be used for all AI requests.
                </p>
            </div>
            <div class="mm-archetype-grid" id="mmArchetypeGrid"></div>
        `;

        const grid = content.querySelector("#mmArchetypeGrid");

        _archetypes.forEach(arch => {
            const isActive = _activeArchetype === arch.id;
            const card = document.createElement("div");
            card.className = `mm-archetype-card ${isActive ? "active" : ""}`;
            card.dataset.id = arch.id;

            const primaryPreview = (arch.primaryModels || [])
                .slice(0, 3)
                .map(m => `<span class="mm-model-chip">${m.split("/").pop()}</span>`)
                .join("");

            card.innerHTML = `
                <div class="mm-card-emoji">${arch.emoji || "🤖"}</div>
                <div class="mm-card-name">${arch.name}</div>
                <div class="mm-card-desc">${arch.description}</div>
                <div class="mm-card-voice" style="font-size:11px;color:var(--text-dim,#666);margin:4px 0 8px;font-style:italic;">
                    ${arch.voice}
                </div>
                <div class="mm-card-models">${primaryPreview}</div>
                ${isActive
                    ? `<div class="mm-card-active-badge">✓ Active</div>`
                    : `<button class="mm-card-activate-btn secondary">Activate</button>`
                }
            `;

            if (!isActive) {
                card.querySelector(".mm-card-activate-btn").addEventListener("click", e => {
                    e.stopPropagation();
                    activateArchetype(arch.id);
                    // Re-render grid to reflect new active state
                    _renderArchetypes(content);
                });
            }

            grid.appendChild(card);
        });
    }

    // ── _renderInventory ─────────────────────────────────────
    // Renders the draggable model table for a given category.
    // Each row: drag handle, toggle checkbox, model name,
    // category color chip, edit button.
    // ── end of _renderInventory ──────────────────────────────

    function _renderInventory(content, categoryId) {
        const categoryModels = _models.filter(m => m.category === categoryId);
        const cat = CATEGORY_MAP[categoryId];

        content.innerHTML = `
            <div class="mm-inventory-header">
                <span style="font-size:14px;font-weight:600;color:${cat?.color || "#ccc"};">
                    ${cat?.label || categoryId}
                </span>
                <span style="font-size:12px;color:var(--text-dim,#666);margin-left:8px;">
                    ${categoryModels.filter(m => m.active).length} / ${categoryModels.length} active
                </span>
                <button class="secondary mm-add-btn" id="mmAddModelBtn" style="margin-left:auto;">
                    + Add Model
                </button>
            </div>
            <div class="mm-table" id="mmTable">
                ${categoryModels.length === 0
                    ? `<div style="padding:20px;color:var(--text-dim,#666);font-size:13px;">No models in this category.</div>`
                    : ""
                }
            </div>
        `;

        const table = content.querySelector("#mmTable");

        categoryModels.forEach(model => {
            const globalIndex = _models.findIndex(m => m.id === model.id);
            const row = document.createElement("div");
            row.className   = "mm-model-row";
            row.draggable   = true;
            row.dataset.id  = model.id;
            row.dataset.idx = globalIndex;

            row.innerHTML = `
                <div class="mm-drag-handle" title="Drag to reorder">⋮⋮</div>
                <label class="toggle-switch mm-row-toggle">
                    <input type="checkbox" ${model.active ? "checked" : ""} />
                    <span class="toggle-slider"></span>
                </label>
                <span class="mm-model-name ${model.active ? "" : "mm-inactive"}">
                    ${model.name}
                </span>
                <span class="mm-api-badge">${model.api}</span>
                <button class="mm-edit-btn icon-btn" title="Edit">⋯</button>
            `;

            // Toggle active
            row.querySelector("input[type=checkbox]").addEventListener("change", e => {
                _models[globalIndex].active = e.target.checked;
                row.querySelector(".mm-model-name").classList.toggle("mm-inactive", !e.target.checked);
                _saveState();
            });

            // Edit button
            row.querySelector(".mm-edit-btn").addEventListener("click", () => {
                _openModal(globalIndex);
            });

            // Drag events
            row.addEventListener("dragstart", e => {
                _draggedIndex = globalIndex;
                row.classList.add("mm-dragging");
                e.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragend", () => {
                row.classList.remove("mm-dragging");
                _draggedIndex = null;
            });
            row.addEventListener("dragover", e => {
                e.preventDefault();
                row.classList.add("mm-drag-over");
            });
            row.addEventListener("dragleave", () => {
                row.classList.remove("mm-drag-over");
            });
            row.addEventListener("drop", e => {
                e.preventDefault();
                row.classList.remove("mm-drag-over");
                if (_draggedIndex === null || _draggedIndex === globalIndex) return;

                // Reorder in _models array
                const dragged = _models.splice(_draggedIndex, 1)[0];
                const newIdx  = _models.findIndex(m => m.id === model.id);
                _models.splice(newIdx, 0, dragged);

                emit("inventoryReordered", { models: _models });
                _saveState();
                _renderInventory(content, categoryId);
            });

            table.appendChild(row);
        });

        // Add model button
        content.querySelector("#mmAddModelBtn")?.addEventListener("click", () => {
            _addModelPrompt(categoryId, content);
        });
    }

    // ── _addModelPrompt ──────────────────────────────────────
    // Inline prompt to add a new model to the current category.
    // ── end of _addModelPrompt ───────────────────────────────

    function _addModelPrompt(categoryId, content) {
        const existing = content.querySelector(".mm-add-form");
        if (existing) { existing.remove(); return; }

        const form = document.createElement("div");
        form.className = "mm-add-form";
        form.innerHTML = `
            <input type="text" id="mmNewModelName" class="settings-input"
                   placeholder="provider/model-name" style="flex:1;" />
            <select id="mmNewModelApi" class="settings-select">
                <option value="openrouter">OpenRouter</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="local">Local</option>
            </select>
            <button class="primary" id="mmNewModelSave">Add</button>
            <button class="secondary" id="mmNewModelCancel">Cancel</button>
        `;

        content.querySelector("#mmTable").after(form);

        form.querySelector("#mmNewModelCancel").onclick = () => form.remove();
        form.querySelector("#mmNewModelSave").onclick = () => {
            const name = form.querySelector("#mmNewModelName").value.trim();
            const api  = form.querySelector("#mmNewModelApi").value;
            if (!name) return;

            const id = name.replace(/[^a-z0-9]/gi, "-").toLowerCase() + "-" + Date.now();
            _models.push({ id, name, api, category: categoryId, active: true });
            _saveState();
            form.remove();
            _renderInventory(content, categoryId);
        };
    }

    // ── _openModal ───────────────────────────────────────────
    // Opens the model detail edit modal for a given index.
    // ── end of _openModal ────────────────────────────────────

    function _openModal(index) {
        _editingIndex = index;
        const m      = _models[index];
        const modal  = document.getElementById("mmModal");
        if (!modal) return;

        document.getElementById("mmModalName").textContent     = m.name;
        document.getElementById("mmModalApi").value            = m.api;
        document.getElementById("mmModalCategory").value       = m.category;
        document.getElementById("mmModalActive").checked       = m.active;

        modal.classList.remove("hidden");
    }

    // ── _wireModal ───────────────────────────────────────────

    function _wireModal(container) {
        container.querySelector("#mmModalClose")?.addEventListener("click",  _closeModal);
        container.querySelector("#mmModalCancel")?.addEventListener("click", _closeModal);
        container.querySelector("#mmModalSave")?.addEventListener("click",   _saveModal);
    }

    function _closeModal() {
        document.getElementById("mmModal")?.classList.add("hidden");
        _editingIndex = null;
    }

    function _saveModal() {
        if (_editingIndex === null) return;
        _models[_editingIndex].api      = document.getElementById("mmModalApi").value;
        _models[_editingIndex].category = document.getElementById("mmModalCategory").value;
        _models[_editingIndex].active   = document.getElementById("mmModalActive").checked;
        _saveState();
        _closeModal();
        // Refresh current tab
        const content = document.getElementById("mmContent");
        if (content) _renderTab(document.querySelector(".mm-root")?.closest("[id]") || document.body, _activeTab);
    }

    // ── activateArchetype ────────────────────────────────────
    // Sets the given archetype as active and pushes its model
    // preferences into LlmPolicyEngine for downstream routing.
    // ── end of activateArchetype ─────────────────────────────

    async function activateArchetype(id) {
        const arch = _archetypes.find(a => a.id === id);
        if (!arch) {
            console.warn(`[ModelManager.ui] Archetype not found: ${id}`);
            return;
        }

        _activeArchetype = id;

        // Build policy update from archetype model preferences
        const policyUpdate = {
            activeArchetype: id,
            tiers: {
                standard:      { models: arch.primaryModels || [] },
                local_fallback: { models: ["ollama/llama3"] },
                ..._buildSecondaryTiers(arch.secondaryModels || {})
            },
            primary: {
                provider: "openrouter",
                model:    arch.primaryModels?.[0] || ""
            }
        };

        // Sync to LlmPolicyEngine
        try {
            if (window.llmPolicyEngine) {
                await window.llmPolicyEngine.updatePolicy(policyUpdate);
                console.info(`[ModelManager.ui] Archetype activated: ${arch.name}`);
            }
        } catch (e) {
            console.error("[ModelManager.ui] Policy sync failed:", e);
        }

        // Update settings profile selects
        const defaultSel = document.getElementById("defaultProfile");
        if (defaultSel) {
            // Add archetype as an option if not present
            if (!defaultSel.querySelector(`option[value="${id}"]`)) {
                const opt = document.createElement("option");
                opt.value = id; opt.textContent = arch.name;
                defaultSel.appendChild(opt);
            }
            defaultSel.value = id;
        }

        // Show toast
        if (typeof window.showToast === "function") {
            window.showToast(`Archetype activated: ${arch.emoji || ""} ${arch.name}`);
        }

        emit("archetypeActivated", { id, name: arch.name });
        emit("policyUpdated",      { archetype: id });

        _saveState();
    }

    // ── _buildSecondaryTiers ─────────────────────────────────
    // Converts an archetype's secondaryModels map into SDOA
    // policy tiers keyed by capability type.
    // ── end of _buildSecondaryTiers ──────────────────────────

    function _buildSecondaryTiers(secondaryModels) {
        if (Array.isArray(secondaryModels)) {
            return { fallback: { models: secondaryModels } };
        }
        const tiers = {};
        for (const [type, models] of Object.entries(secondaryModels)) {
            tiers[type] = { models: Array.isArray(models) ? models : [models] };
        }
        return tiers;
    }

    // ── getActiveModels ──────────────────────────────────────
    // Returns all currently active models across all categories.
    // ── end of getActiveModels ───────────────────────────────

    function getActiveModels() {
        return _models.filter(m => m.active);
    }

    // ── _loadState / _saveState ──────────────────────────────
    // Persists model inventory and active archetype via backend.
    // Falls back gracefully if backend is unavailable.
    // ── end of _loadState / _saveState ───────────────────────

    async function _loadState() {
        const conn = _connector();
        if (!conn) return;
        try {
            const saved = await conn.runWorkflow("get_model_inventory", {});
            if (saved?.models?.length)     _models          = saved.models;
            if (saved?.activeArchetype)    _activeArchetype = saved.activeArchetype;
            if (saved?.archetypes?.length) _archetypes      = saved.archetypes;
        } catch {
            // Backend not ready or workflow not registered — use defaults
        }
    }

    async function _saveState() {
        const conn = _connector();
        if (!conn) return;
        try {
            await conn.runWorkflow("save_model_inventory", {
                models:          _models,
                activeArchetype: _activeArchetype,
            });
        } catch {
            // Non-fatal — state lives in memory for this session
        }
    }

    // ── _injectStyles ────────────────────────────────────────
    // Injects scoped CSS for the ModelManager UI.
    // Only injected once via a sentinel id.
    // ── end of _injectStyles ─────────────────────────────────

    function _injectStyles() {
        if (document.getElementById("mm-styles")) return;
        const style = document.createElement("style");
        style.id = "mm-styles";
        style.textContent = `
            .mm-root { display:flex;flex-direction:column;height:100%;font-size:13px; }

            /* Tab bar */
            .mm-tabbar {
                display:flex;flex-wrap:wrap;gap:4px;
                padding:8px 8px 0;border-bottom:1px solid var(--border-subtle,#333);
            }
            .mm-tab {
                padding:5px 12px;border-radius:6px 6px 0 0;border:none;
                background:var(--bg-elevated-1,#1a1a2e);color:var(--text-dim,#888);
                cursor:pointer;font-size:12px;transition:all 0.15s;
            }
            .mm-tab:hover  { color:var(--text,#ccc); }
            .mm-tab.active { background:var(--bg-elevated-2,#252540);color:var(--text,#eee);font-weight:600; }

            /* Content area */
            .mm-content { flex:1;overflow:auto;padding:12px; }

            /* Archetype grid */
            .mm-archetype-grid {
                display:grid;
                grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
                gap:12px;
            }
            .mm-archetype-card {
                background:var(--bg-elevated-1,#1a1a2e);
                border:1px solid var(--border-subtle,#333);
                border-radius:10px;padding:14px;
                display:flex;flex-direction:column;gap:4px;
                transition:border-color 0.2s, box-shadow 0.2s;
            }
            .mm-archetype-card:hover {
                border-color:var(--accent,#6366f1);
            }
            .mm-archetype-card.active {
                border-color:var(--accent,#6366f1);
                box-shadow:0 0 0 2px rgba(99,102,241,0.25);
            }
            .mm-card-emoji  { font-size:28px;line-height:1; }
            .mm-card-name   { font-weight:700;font-size:14px;color:var(--text,#eee);margin-top:4px; }
            .mm-card-desc   { font-size:12px;color:var(--text-dim,#888);line-height:1.4; }
            .mm-card-models { display:flex;flex-wrap:wrap;gap:4px;margin-top:4px; }
            .mm-model-chip  {
                font-size:10px;padding:2px 6px;border-radius:4px;
                background:var(--bg-elevated-2,#252540);color:var(--text-dim,#888);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;
            }
            .mm-card-active-badge {
                margin-top:8px;font-size:12px;font-weight:600;
                color:var(--accent,#6366f1);
            }
            .mm-card-activate-btn {
                margin-top:8px;width:100%;
            }

            /* Inventory table */
            .mm-inventory-header {
                display:flex;align-items:center;gap:8px;
                margin-bottom:10px;padding-bottom:8px;
                border-bottom:1px solid var(--border-subtle,#333);
            }
            .mm-model-row {
                display:flex;align-items:center;gap:8px;
                padding:6px 8px;border-radius:6px;
                border:1px solid transparent;
                transition:background 0.1s;cursor:default;
            }
            .mm-model-row:hover         { background:var(--bg-elevated-1,#1a1a2e); }
            .mm-model-row.mm-dragging   { opacity:0.5; }
            .mm-model-row.mm-drag-over  { border-color:var(--accent,#6366f1); }
            .mm-drag-handle {
                color:var(--text-dim,#555);cursor:grab;font-size:14px;
                padding:0 2px;user-select:none;
            }
            .mm-drag-handle:active { cursor:grabbing; }
            .mm-row-toggle  { flex-shrink:0; }
            .mm-model-name  { flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#ccc); }
            .mm-model-name.mm-inactive { color:var(--text-dim,#555);text-decoration:line-through; }
            .mm-api-badge   {
                font-size:10px;padding:2px 6px;border-radius:4px;
                background:var(--bg-elevated-2,#252540);color:var(--text-dim,#777);
                flex-shrink:0;
            }
            .mm-edit-btn { flex-shrink:0;opacity:0.5; }
            .mm-edit-btn:hover { opacity:1; }

            /* Add model form */
            .mm-add-form {
                display:flex;gap:8px;align-items:center;
                padding:8px;margin-top:8px;
                background:var(--bg-elevated-1,#1a1a2e);
                border-radius:6px;border:1px solid var(--border-subtle,#333);
            }

            /* Modal */
            .mm-modal {
                position:fixed;inset:0;background:rgba(0,0,0,0.7);
                display:flex;align-items:center;justify-content:center;
                z-index:9999;
            }
            .mm-modal.hidden { display:none; }
            .mm-modal-inner {
                background:var(--bg-surface,#131320);
                border:1px solid var(--border-subtle,#333);
                border-radius:12px;padding:20px;min-width:320px;
            }
            .mm-modal-header {
                display:flex;align-items:center;justify-content:space-between;
                margin-bottom:16px;
            }
            .mm-modal-body   { display:flex;flex-direction:column;gap:12px; }
            .mm-modal-footer { display:flex;gap:8px;justify-content:flex-end;margin-top:16px; }
        `;
        document.head.appendChild(style);
    }

    // ── window exports ───────────────────────────────────────
    window.modelManager = {
        MANIFEST,
        render,
        activateArchetype,
        getActiveModels,
        on
    };
    // ── end of window exports ────────────────────────────────

    // ── auto-init ────────────────────────────────────────────
    domReady(() => {
        // If there's a dedicated container already in the DOM, render into it
        const container = document.getElementById("modelManagerContainer");
        if (container) render(container);
    });
    // ── end of auto-init ────────────────────────────────────

})();
