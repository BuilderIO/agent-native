---
"@agent-native/core": patch
---

Fix a batch of verified bugs found in a deep core bug hunt:

- **Token usage double-counted on `ai-sdk:*` engines.** The AI SDK translator emitted usage from both `finish-step` (per-step) and `finish` (total), so cost tracking, quotas, and context-budget logic saw ~2× the real tokens. Now usage is emitted only from the terminal `finish`.
- **Cross-tenant screen remounts.** Agent-initiated `refresh-screen` was emitted deployment-global (no owner), so one user's refresh remounted/refetched every other logged-in user's screen. The poll detector is now per-session and owner-scoped, and reads the newest row deterministically (`ORDER BY`/max instead of arbitrary `rows[0]`).
- **Recoverable soft-timeout turns turned into dead chats.** A transient `thread_data` save failure during a soft-timeout continuation discarded the stashed `auto_continue` and surfaced a hard error; the client now still resumes.
- **Extension viewer→owner privilege escalation.** A shared/org extension could re-announce its bridge binding from inside the iframe to escalate from viewer to owner. The binding is now latched to the first (pre-user-content) announcement.
- **LLM-judge evals saw empty transcripts.** The eval transcript builder matched `tool-call`/`tool-result` event types that are never persisted (real shapes are `tool_start`/`tool_done`), stripping all tool activity from judged runs.
- **MCP static `ACCESS_TOKEN` compared non-constant-time** — now uses `timingSafeEqual`.
- **Webhook dedup dropped same-second messages** (Telegram/WhatsApp second-resolution timestamps); dedup now prefers the platform's unique message id.
- **Agent `web-request` and notification webhooks had weaker SSRF protection** than the extension proxy; both now use the shared DNS/redirect/connect-time safe fetch path.
- **Google Docs reply dedup didn't survive serverless cold starts** (in-memory `Set`), causing duplicate agent replies; processed reply ids are now persisted in the SQL thread mapping.
- **`upload-image` buffered the entire remote body before enforcing the 25 MB cap** (OOM risk); it now checks `Content-Length` and streams with an early abort.
- **`useAgentChatGenerating` ignored `tabId`**, so any finished run cleared the generating state of unrelated chat surfaces; it now filters by the run it started.
- Plus: trace span matching for concurrent same-named tool calls (FIFO), code-mode toggle rollback on server rejection, awareness-map leak prune, retry-delay abort-listener leak, demo-mode status reading the wrong session field, and `removeThread` calling setState inside a state updater.
