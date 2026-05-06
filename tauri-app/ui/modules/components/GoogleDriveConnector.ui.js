// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// GoogleDriveConnector.ui.js — UI for Google Drive Integration
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    class GoogleDriveConnector {
        constructor() {
            this.modal = null;
            this.clientId = "";
            this.clientSecret = "";
            this.project = "";
        }

        async open(project) {
            this.project = project;
            this._ensureModal();
            this.modal.classList.remove("hidden");
            await this._refreshSettings();
            this._renderInitialState();
        }

        _ensureModal() {
            if (this.modal) return;

            this.modal = document.createElement("div");
            this.modal.id = "gdriveModal";
            this.modal.className = "sdoa-modal-overlay hidden";
            this.modal.innerHTML = `
                <div class="sdoa-modal" style="max-width: 500px;">
                    <div class="modal-header">
                        <h3>Google Drive Connector</h3>
                        <button class="close-btn">✕</button>
                    </div>
                    <div class="modal-body" id="gdriveContent">
                        <!-- Dynamic Content -->
                    </div>
                </div>
            `;
            document.body.appendChild(this.modal);

            this.modal.querySelector(".close-btn").addEventListener("click", () => {
                this.modal.classList.add("hidden");
            });
        }

        async _refreshSettings() {
            const settings = await window.backendConnector.runWorkflow("get_settings");
            this.clientId = settings?.googleDrive?.clientId || "";
            this.clientSecret = settings?.googleDrive?.clientSecret || "";
        }

        _renderInitialState() {
            const content = this.modal.querySelector("#gdriveContent");
            if (!this.clientId || !this.clientSecret) {
                content.innerHTML = `
                    <p style="font-size: 13px; color: var(--text-dim);">Please provide your Google Cloud Client credentials to connect.</p>
                    <div class="setting-row">
                        <label>Client ID</label>
                        <input type="text" id="gdClientId" value="${this.clientId}" class="settings-input" />
                    </div>
                    <div class="setting-row">
                        <label>Client Secret</label>
                        <input type="password" id="gdClientSecret" value="${this.clientSecret}" class="settings-input" />
                    </div>
                    <button class="primary" id="gdSaveBtn" style="width:100%; margin-top:10px;">Save & Connect</button>
                `;
                content.querySelector("#gdSaveBtn").addEventListener("click", () => this._saveAndConnect());
            } else {
                this._renderBrowser();
            }
        }

        async _saveAndConnect() {
            const cid = this.modal.querySelector("#gdClientId").value.trim();
            const sec = this.modal.querySelector("#gdClientSecret").value.trim();
            if (!cid || !sec) return alert("Client ID and Secret are required");

            await window.backendConnector.runWorkflow("update_settings", {
                key: "googleDrive",
                value: { clientId: cid, clientSecret: sec }
            });

            this.clientId = cid;
            this.clientSecret = sec;

            const res = await window.backendConnector.runWorkflow("GoogleDriveWorkflow", {
                action: "get_auth_url",
                params: { clientId: cid }
            });

            if (res.url) {
                window.open(res.url, "_blank");
                this._renderCodeInput();
            }
        }

        _renderCodeInput() {
            const content = this.modal.querySelector("#gdriveContent");
            content.innerHTML = `
                <p style="font-size: 13px;">A browser window has opened. Please authenticate and paste the authorization code below:</p>
                <input type="text" id="gdAuthCode" placeholder="Paste code here..." class="settings-input" />
                <button class="primary" id="gdExchangeBtn" style="width:100%; margin-top:10px;">Verify Code</button>
            `;
            content.querySelector("#gdExchangeBtn").addEventListener("click", async () => {
                const code = content.querySelector("#gdAuthCode").value.trim();
                const res = await window.backendConnector.runWorkflow("GoogleDriveWorkflow", {
                    action: "exchange_code",
                    params: { clientId: this.clientId, clientSecret: this.clientSecret, code }
                });
                if (res.message) {
                    this._renderBrowser();
                } else {
                    alert("Verification failed: " + res.error);
                }
            });
        }

        async _renderBrowser() {
            const content = this.modal.querySelector("#gdriveContent");
            content.innerHTML = `<p>Loading files from Google Drive...</p>`;

            const res = await window.backendConnector.runWorkflow("GoogleDriveWorkflow", {
                action: "list_files",
                params: {}
            });

            if (res.error === "AUTH_EXPIRED") {
                this.clientId = ""; // Force re-auth
                this._renderInitialState();
                return;
            }

            if (!res.files) {
                content.innerHTML = `<p>Error loading files: ${res.error || "Unknown error"}</p>`;
                return;
            }

            content.innerHTML = `
                <div style="max-height: 300px; overflow-y: auto;">
                    <ul class="file-list" id="gdFileList">
                        ${res.files.map(f => `
                            <li class="file-item" data-id="${f.id}" data-name="${f.name}" style="padding: 8px; border-bottom: 1px solid var(--border-subtle); cursor: pointer; display: flex; align-items: center; gap: 8px;">
                                <span>${f.mimeType === "application/vnd.google-apps.folder" ? "📁" : "📄"}</span>
                                <span style="flex:1;">${f.name}</span>
                                <button class="import-btn" style="padding: 2px 8px; font-size: 11px;">Import</button>
                            </li>
                        `).join("")}
                    </ul>
                </div>
            `;

            content.querySelectorAll(".import-btn").forEach(btn => {
                btn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const li = btn.closest("li");
                    const fileId = li.dataset.id;
                    const fileName = li.dataset.name;
                    btn.textContent = "⏳";
                    btn.disabled = true;

                    const dl = await window.backendConnector.runWorkflow("GoogleDriveWorkflow", {
                        action: "download_file",
                        params: { fileId, fileName, project: this.project }
                    });

                    if (dl.message) {
                        btn.textContent = "✅";
                        window.showToast?.(`Imported ${fileName}`);
                    } else {
                        btn.textContent = "❌";
                        alert("Download failed: " + dl.error);
                        btn.disabled = false;
                    }
                });
            });
        }
    }

    domReady(() => {
        window.googleDriveConnector = new GoogleDriveConnector();
    });

})();
