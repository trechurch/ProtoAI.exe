// Last modified: 2026-05-04 03:11 UTC
"use strict";

const fs = require("fs");

class Middleware {
    static _logFile = null;

    /**
     * Initialize logging. Safe to call before logFile is set.
     * @param {string} logFile Path to the log file.
     */
    static initLogging(logFile) {
        this._logFile = logFile;
        if (this._logFile) {
            try {
                fs.appendFileSync(this._logFile, `\n--- IPC server started at ${new Date().toISOString()} ---\n`);
            } catch (err) {
                // If it fails, we fall back to stderr
                process.stderr.write(`[Middleware] Warning: could not open log file: ${err.message}\n`);
                this._logFile = null;
            }
        }
    }

    /**
     * Safe logging. Writes to stderr so it doesn't pollute stdout (which is the IPC stream).
     * @param  {...any} args
     */
    static log(...args) {
        const line = args.map(a =>
            a instanceof Error ? `${a.message}\n${a.stack}` :
            typeof a === "string" ? a :
            JSON.stringify(a)
        ).join(" ");

        process.stderr.write(line + "\n");

        if (this._logFile) {
            try { fs.appendFileSync(this._logFile, line + "\n"); } catch { /* log file not writable */ }
        }
    }
}

module.exports = Middleware;
