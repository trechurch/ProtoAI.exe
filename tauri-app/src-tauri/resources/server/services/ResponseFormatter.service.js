// Last modified: 2026-05-04 03:11 UTC
"use strict";

class ResponseFormatter {
    /**
     * Safely parse an incoming JSON line
     * @param {string} str 
     * @returns {{ok: boolean, value?: any, error?: any}}
     */
    static safeJsonParse(str) {
        try { 
            return { ok: true, value: JSON.parse(str) }; 
        } catch (err) { 
            return { ok: false, error: err }; 
        }
    }

    /**
     * Write a JSON-lines response to the Tauri frontend via stdout
     * @param {Object} obj The response object
     */
    static writeResponse(obj) {
        if (obj === null || obj === undefined) return; // Never write null to stdout
        try {
            process.stdout.write(JSON.stringify(obj) + "\n");
        } catch (err) {
            process.stderr.write("[ResponseFormatter] ❌ Failed to serialize IPC response: " + err.message + "\n");
        }
    }

    /**
     * Format and write an error response
     * @param {string} id The request ID
     * @param {string} error Error summary
     * @param {string} [detail] Optional error stack or detail
     */
    static writeError(id, error, detail = null) {
        this.writeResponse({ id, ok: false, error, detail });
    }

    /**
     * Format and write a success response
     * @param {string} id The request ID
     * @param {any} data The payload data
     */
    static writeSuccess(id, data) {
        this.writeResponse({ id, ok: true, data });
    }
}

module.exports = ResponseFormatter;
