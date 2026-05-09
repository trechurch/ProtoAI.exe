// ============================================================
// AuthListener.service.js — SDOA v4 Service
// version: 4.1.0
// Last modified: 2026-05-09 04:31 UTC
// ============================================================
"use strict";

const http = require("http");
const url = require("url");
const Middleware = require("./Middleware.service");

class AuthListener {
    constructor() {
        this.server = http.createServer((req, res) => this._handleRequest(req, res));
        this.server.setMaxListeners(30);
        this.port = 3000;
        this.lastCode = null;
        this._retryCount = 0;
        
        this.server.on("error", (err) => this._handleError(err));
    }

    start() {
        this._listen();
    }

    _handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        
        if (parsedUrl.pathname === "/callback") {
            const code = parsedUrl.query.code;
            if (code) {
                this.lastCode = code;
                Middleware.log(`[AuthListener] Received code: ${code.slice(0, 5)}...`);
                
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(`
                    <html>
                        <body style="font-family: sans-serif; background: #1a1a1a; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                            <div style="background: #2a2a2a; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center;">
                                <h1 style="color: #4f8cff; margin-bottom: 10px;">Authentication Success</h1>
                                <p style="color: #ccc; margin-bottom: 20px;">You have successfully authenticated with Google Drive.</p>
                                <div style="background: rgba(79, 140, 255, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(79, 140, 255, 0.3); margin-bottom: 20px;">
                                    <code style="font-size: 18px; color: #4f8cff;">${code}</code>
                                </div>
                                <p style="font-size: 13px; color: #888;">Copy the code above and paste it into ProtoAI, or simply close this window.</p>
                                <button onclick="window.close()" style="background: #4f8cff; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">Close Window</button>
                            </div>
                        </body>
                    </html>
                `);
            } else {
                res.writeHead(400);
                res.end("No code found in request");
            }
        } else {
            res.writeHead(404);
            res.end("Not found");
        }
    }

    _handleError(err) {
        if (err.code === "EADDRINUSE") {
            this._retryCount++;
            
            // SDOA v4 Stealth Mode: Only log periodically and cap at 5 attempts
            if (this._retryCount <= 5) {
                Middleware.log(`[AuthListener] Port ${this.port} in use. Retry ${this._retryCount}/5 in 60s...`);
                setTimeout(() => {
                    try { this.server?.close(); } catch(_) {}
                    this._listen();
                }, 60000);
            } else if (this._retryCount === 6) {
                Middleware.log(`[AuthListener] Port ${this.port} remains busy. Authentication listener suspended.`);
            }
        } else {
            Middleware.log(`[AuthListener] Server error: ${err.message}`);
        }
    }

    _listen() {
        try {
            this.server.listen(this.port, () => {
                Middleware.log(`[AuthListener] Listening on port ${this.port}`);
                this._retryCount = 0;
            });
        } catch (e) {
            // Handled by error listener
        }
    }

    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

module.exports = new AuthListener();
