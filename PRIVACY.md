# Privacy Statement for ProtoAI

**Last updated:** 2026-04-06

## What ProtoAI Does With Your Data

ProtoAI is a desktop application that runs entirely on your machine. It does not include telemetry, analytics, or remote servers of its own. Everything below describes what happens when you interact with third-party AI services through the app.

## API Keys

You provide API keys for external providers (Anthropic, OpenAI, OpenRouter). These keys are stored in one of two places:

1. **`server/data/settings.json`** — if you entered keys through the Settings dashboard (Ctrl+Shift+S). This file lives in the application's root directory on your machine.
2. **`data/secret.key`** — the legacy location, created manually before the Settings dashboard existed.

Your API keys never leave your machine except when sent directly to the provider's API during an LLM request. ProtoAI does not store, transmit, or share your keys with any third party other than the provider you chose.

## Messages and Prompts

Messages you type in the chat are sent to the AI provider associated with your active profile (typically OpenRouter). The provider's own privacy policy applies to those messages. ProtoAI:

- Retains chat history **locally** on your machine in JSON files within your project directories.
- Does **not** upload, sync, or broadcast your chat history to any server.
- Does **not** use your messages for training, analytics, or any purpose other than sending the request to your selected AI provider.

## File Context and Ingestion

When you attach folders or files to a project, ProtoAI:

- Reads those files from your local filesystem only.
- Builds file context locally and sends the combined context along with your message when you invoke an AI workflow.
- Does not copy your files to any external server beyond what the AI provider receives as part of your message payload.

## Third-Party Services

ProtoAI communicates with these external services:

| Service | Purpose | Data Sent |
|---------|---------|-----------|
| OpenRouter | Multi-provider AI API gateway | API key (auth), your messages, file context |
| Anthropic API | Direct Claude model calls | API key (auth), your messages |
| OpenAI API | Direct GPT model calls | API key (auth), your messages |
| GitHub Releases | Update checking | None (public API call) |
| Pollinations.ai | Image generation | Your text prompt (no auth required) |
| Wikipedia / DuckDuckGo / arXiv | Research tool | Your search queries (public APIs, no auth required) |

Each provider has its own privacy policy. ProtoAI acts as a conduit — it forwards your requests and returns the results.

## Crash Logs and Diagnostics

ProtoAI writes minimal logs to `data/logs/server-ipc.log` on your local machine. These logs contain timestamps, workflow names, and error messages. They do **not** contain your API keys, full message payloads, or personal data. Logs are never transmitted outside your machine.

## Local-Only Settings

All configuration is stored locally in `server/data/settings.json`. This includes:

- API keys (stored as plaintext)
- Enabled/disabled models
- Default profiles
- Ingestion preferences (file size limits, extensions, depth)
- Backend tuning (timeouts, retry counts)

This file is never uploaded, synced, or shared. The repository's `.gitignore` explicitly excludes it from version control.

## What ProtoAI Does NOT Do

- No analytics or tracking
- No telemetry or crash reporting to the developers
- No cloud accounts or remote user profiles
- No data collection beyond what you explicitly configure
- No machine learning on your data
- No remote updates without your consent (update check, then manual download)

## Changes to This Statement

Any changes to this privacy statement will be documented in the repository with an updated revision date.

## Contact

For questions about privacy or how ProtoAI handles your data, open an issue at [github.com/trechurch/ProtoAI.exe](https://github.com/trechurch/ProtoAI.exe/issues).
