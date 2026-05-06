// ============================================================
// StateStore.adapter.js — SDOA v4 Centralized State
// version: 4.0.0
// Last modified: 2026-05-04 03:11 UTC
// layer: 3 (adapter)
//
// Single source of truth for all application state.
// Replaces scattered window.* globals, localStorage reads,
// and module-local variables.
//
// Usage:
//   StateStore.get("currentProject")
//   StateStore.set("currentProject", "myProject")
//   StateStore.watch("currentProject", (val, old) => { ... })
// ============================================================

(function () {
    "use strict";

    // ── SDOA v4 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:       "StateStore",
        type:     "service",
        layer:    3,
        runtime:  "Browser",
        version:  "4.0.0",

        requires: [],
        dataFiles: [],

        lifecycle: ["init", "destroy"],

        actions: {
            commands: {
                get:       { description: "Get a state value by key.",                          input: { key: "string" },                   output: "any" },
                set:       { description: "Set a state value. Notifies all watchers.",           input: { key: "string", value: "any" },     output: "void" },
                watch:     { description: "Subscribe to changes on a key. Returns unsub fn.",    input: { key: "string", handler: "fn" },    output: "fn" },
                getAll:    { description: "Get the entire state snapshot.",                      input: {},                                  output: "object" },
                reset:     { description: "Reset a key to its default value.",                   input: { key: "string" },                   output: "void" },
                hydrate:   { description: "Restore persisted state from localStorage.",          input: {},                                  output: "void" },
            },
            events: {
                "state:changed": { description: "Emitted when any state key changes.", payload: "{ key, value, oldValue }" },
            },
            accepts: {},
            slots: {},
        },

        backendDeps: [],

        docs: {
            description: "Centralized reactive state store. Replaces all window.* globals and scattered localStorage usage. Modules subscribe to specific keys via watch().",
            author: "ProtoAI team",
            sdoa: "4.0.0"
        }
    };
    // ── end MANIFEST ─────────────────────────────────────────

    // ── Default state shape ──────────────────────────────────
    const _defaults = {
        currentProject:  "default",
        currentProfile:  "default",
        activeSession:   null,
        backendStatus:   "connecting",
        attachedFiles:   [],
        settings:        {},
        policy:          {},
        projects:        [],
        profiles:        [],
    };

    // Keys that auto-persist to localStorage
    const _persistKeys = new Set([
        "currentProject",
        "currentProfile",
        "activeSession",
    ]);

    // ── Internal state ───────────────────────────────────────
    const _state    = { ..._defaults };
    const _watchers = new Map();  // key → Set of handler fns
    const _LS_PREFIX = "protoai:state:";

    // ── get ──────────────────────────────────────────────────
    function get(key) {
        return _state[key];
    }

    // ── getAll ───────────────────────────────────────────────
    function getAll() {
        return { ..._state };
    }

    // ── set ──────────────────────────────────────────────────
    function set(key, value) {
        const oldValue = _state[key];

        // Skip if identical (shallow compare)
        if (oldValue === value) return;

        _state[key] = value;

        // Auto-persist
        if (_persistKeys.has(key)) {
            try {
                localStorage.setItem(_LS_PREFIX + key, JSON.stringify(value));
            } catch (e) {
                console.warn(`[StateStore] Failed to persist "${key}":`, e);
            }
        }

        // Notify watchers for this key
        _notify(key, value, oldValue);

        // Notify wildcard watchers
        _notify("*", { key, value, oldValue }, undefined);

        // Bridge to EventBus if available
        if (window.EventBus) {
            window.EventBus.emit("state:changed", { key, value, oldValue });
        }
    }

    // ── watch ────────────────────────────────────────────────
    // Returns an unsubscribe function.
    function watch(key, handler) {
        if (!_watchers.has(key)) _watchers.set(key, new Set());
        _watchers.get(key).add(handler);

        // Return unsub function
        return () => {
            _watchers.get(key)?.delete(handler);
        };
    }

    // ── reset ────────────────────────────────────────────────
    function reset(key) {
        if (key in _defaults) {
            set(key, structuredClone(_defaults[key]));
        }
    }

    // ── hydrate ──────────────────────────────────────────────
    // Restores persisted keys from localStorage on startup.
    function hydrate() {
        for (const key of _persistKeys) {
            try {
                const raw = localStorage.getItem(_LS_PREFIX + key);
                if (raw !== null) {
                    _state[key] = JSON.parse(raw);
                }
            } catch (e) {
                console.warn(`[StateStore] Failed to hydrate "${key}":`, e);
            }
        }
    }

    // ── _notify ──────────────────────────────────────────────
    function _notify(key, value, oldValue) {
        const set = _watchers.get(key);
        if (!set || set.size === 0) return;
        for (const handler of set) {
            try {
                handler(value, oldValue);
            } catch (e) {
                console.error(`[StateStore] Watcher error on "${key}":`, e);
            }
        }
    }

    // ── init ─────────────────────────────────────────────────
    function init() {
        hydrate();
        console.log("[StateStore] Initialized. Persisted keys:", [..._persistKeys].join(", "));
    }

    // ── Legacy compatibility bridge ──────────────────────────
    // Provides backward compatibility during v3→v4 migration.
    // Modules that still read window.currentProject will get
    // the StateStore value via a getter.
    function _installLegacyGetters() {
        Object.defineProperty(window, "currentProject", {
            get: () => get("currentProject"),
            set: (v) => set("currentProject", v),
            configurable: true,
        });
    }

    // ── Export ────────────────────────────────────────────────
    window.StateStore = {
        MANIFEST,
        get,
        getAll,
        set,
        watch,
        reset,
        hydrate,
        init,
        _installLegacyGetters,
    };

    // Auto-init
    init();
    _installLegacyGetters();

})();
