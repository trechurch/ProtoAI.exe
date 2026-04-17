// ============================================================
// EventBus.ui.js — Central SDOA v3 Event Bus
// version: 1.0.0
// load order: second — after tauri-utils.js, before all modules
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── EventBus ─────────────────────────────────────────────
    // Central pub/sub for cross-module SDOA v3 coordination.
    //
    // Activates the action surface declared in every module
    // manifest — commands, triggers, emits, workflows all
    // route through here so modules never need direct
    // references to each other.
    //
    // Usage:
    //   EventBus.on("module:event", handler)
    //   EventBus.once("module:event", handler)
    //   EventBus.off("module:event", handler)
    //   EventBus.emit("module:event", data)
    //   EventBus.command("module", "commandName", payload)
    //
    // Event naming convention: "moduleid:eventname"
    //   e.g. "backend:statusChanged"
    //        "llmbridge:generateStarted"
    //        "filemanager:fileOpened"
    //        "modelmanager:archetypeActivated"
    // ── end of EventBus ──────────────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "EventBus.ui",
        type:    "service",
        runtime: "Browser",
        version: "1.0.0",

        capabilities: [
            "event.publish",
            "event.subscribe",
            "event.unsubscribe",
            "command.dispatch",
            "module.bridge"
        ],
        dependencies: ["tauri-utils.js"],
        docs: {
            description: "Central pub/sub event bus. Activates the SDOA v3 action surface across all UI modules. Modules emit events here; app.js and other modules subscribe. Eliminates direct module-to-module coupling.",
            author: "ProtoAI team",
            sdoa_compatibility: `
                SDOA v3 contract — all versions forward/backward compatible.
                Lower versions ignore unknown fields.
                Higher versions preserve old semantics.
            `
        },
        actions: {
            commands: {
                emit:    { description: "Publish an event to all subscribers.",          input: { event: "string", data: "any" },    output: "void" },
                on:      { description: "Subscribe to an event.",                        input: { event: "string", handler: "fn" }, output: "void" },
                once:    { description: "Subscribe to an event — fires once then unsubs.", input: { event: "string", handler: "fn" }, output: "void" },
                off:     { description: "Unsubscribe from an event.",                    input: { event: "string", handler: "fn" }, output: "void" },
                command: { description: "Dispatch a named command to a module.",         input: { module: "string", cmd: "string", payload: "any" }, output: "Promise<any>" },
            },
            triggers: {
                "*": { description: "Any event published on the bus." }
            },
            emits: {
                "bus:error": { description: "Emits when a listener throws.", payload: { event: "string", error: "string" } }
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── internal state ────────────────────────────────────────
    const _listeners  = new Map();  // event → Set of { handler, once }
    const _commands   = new Map();  // "module:command" → handler fn
    const _history    = [];         // last N events for debugging
    const HISTORY_MAX = 50;
    let   _debug      = false;
    // ── end of internal state ─────────────────────────────────

    // ── on ────────────────────────────────────────────────────
    // Subscribe to an event. Handler receives (data, event).
    // Returns an unsubscribe function for convenience.
    // ── end of on ────────────────────────────────────────────

    function on(event, handler) {
        if (!_listeners.has(event)) _listeners.set(event, new Set());
        const entry = { handler, once: false };
        _listeners.get(event).add(entry);
        return () => off(event, handler);
    }

    // ── once ──────────────────────────────────────────────────
    // Subscribe to an event — fires once then auto-unsubscribes.
    // ── end of once ──────────────────────────────────────────

    function once(event, handler) {
        if (!_listeners.has(event)) _listeners.set(event, new Set());
        const entry = { handler, once: true };
        _listeners.get(event).add(entry);
        return () => _removeEntry(event, entry);
    }

    // ── off ───────────────────────────────────────────────────
    // Unsubscribe a handler from an event.
    // ── end of off ───────────────────────────────────────────

    function off(event, handler) {
        const set = _listeners.get(event);
        if (!set) return;
        for (const entry of set) {
            if (entry.handler === handler) {
                set.delete(entry);
                break;
            }
        }
    }

    function _removeEntry(event, entry) {
        _listeners.get(event)?.delete(entry);
    }

    // ── emit ──────────────────────────────────────────────────
    // Publish an event to all subscribers.
    // Wildcard listeners on "*" receive every event.
    // ── end of emit ──────────────────────────────────────────

    function emit(event, data) {
        if (_debug) console.log(`[EventBus] ${event}`, data);

        // Record in history
        _history.push({ event, data, ts: Date.now() });
        if (_history.length > HISTORY_MAX) _history.shift();

        // Fire specific listeners
        _fire(event, data);

        // Fire wildcard listeners
        if (event !== "*") _fire("*", { event, data });
    }

    function _fire(event, data) {
        const set = _listeners.get(event);
        if (!set || set.size === 0) return;

        const toRemove = [];
        for (const entry of set) {
            try {
                entry.handler(data, event);
            } catch (err) {
                console.error(`[EventBus] Listener error on "${event}":`, err);
                emit("bus:error", { event, error: err.message });
            }
            if (entry.once) toRemove.push(entry);
        }
        toRemove.forEach(e => set.delete(e));
    }

    // ── command ───────────────────────────────────────────────
    // Register or dispatch a named command on a module.
    //
    // Register:   EventBus.command("filemanager", "open", handler)
    // Dispatch:   await EventBus.command("filemanager", "open", payload)
    //
    // First call with a function handler = register.
    // First call with a non-function payload = dispatch.
    // ── end of command ────────────────────────────────────────

    function command(module, cmd, payloadOrHandler) {
        const key = `${module}:${cmd}`;
        if (typeof payloadOrHandler === "function") {
            // Register
            _commands.set(key, payloadOrHandler);
            return;
        }
        // Dispatch
        const handler = _commands.get(key);
        if (!handler) {
            console.warn(`[EventBus] No command handler registered: ${key}`);
            return Promise.resolve(null);
        }
        try {
            return Promise.resolve(handler(payloadOrHandler));
        } catch (err) {
            console.error(`[EventBus] Command error "${key}":`, err);
            return Promise.reject(err);
        }
    }

    // ── bridge ────────────────────────────────────────────────
    // Connects a module's local emit() to the global bus.
    // Call once per module after instantiation:
    //   EventBus.bridge("backend", window.backendConnector);
    //
    // The module's local emit() calls are forwarded to the bus
    // as "moduleid:eventname" so all app-level subscribers
    // receive them without any change to the module itself.
    // ── end of bridge ────────────────────────────────────────

    function bridge(moduleId, instance) {
        if (!instance || typeof instance.emit !== "function") {
            console.warn(`[EventBus] Cannot bridge "${moduleId}" — no emit() method`);
            return;
        }

        const originalEmit = instance.emit.bind(instance);
        instance.emit = function (event, data) {
            originalEmit(event, data);
            emit(`${moduleId}:${event}`, data);
        };
    }

    // ── debug helpers ─────────────────────────────────────────

    function setDebug(enabled) { _debug = enabled; }
    function getHistory()      { return [..._history]; }
    function listListeners()   {
        const result = {};
        _listeners.forEach((set, event) => { result[event] = set.size; });
        return result;
    }

    // ── end of debug helpers ──────────────────────────────────

    // ── window export ─────────────────────────────────────────
    window.EventBus = { MANIFEST, on, once, off, emit, command, bridge, setDebug, getHistory, listListeners };
    // ── end of window export ─────────────────────────────────

    domReady(() => {
        // Auto-bridge all known modules once DOM is ready
        // Modules may not be instantiated yet — bridge lazily
        const _autoBridge = () => {
            const modules = {
                "backend":       window.backendConnector,
                "llmbridge":     window.llmBridge,
                "llmpolicy":     window.llmPolicyEngine,
                "qmd":           window.qmdAdapter,
                "filemanager":   window.fileManager,
                "modelmanager":  window.modelManager,
            };
            Object.entries(modules).forEach(([id, instance]) => {
                if (instance && typeof instance.emit === "function") {
                    // Only bridge if not already bridged
                    if (!instance._busBridged) {
                        bridge(id, instance);
                        instance._busBridged = true;
                    }
                }
            });
        };

        // Try immediately, then again after a tick to catch late-init modules
        _autoBridge();
        setTimeout(_autoBridge, 100);
        setTimeout(_autoBridge, 500);
    });

})();
