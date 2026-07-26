---
"@agent-native/core": patch
---

Restructure the generated workspace `AGENTS.md` so the whole file actually
reaches the model. It was 8,294 characters, and the compact prompt hard-slices
each injected resource at 6,000, so the last ~2,300 characters — the entire
"Adding Apps" workflow — were silently dropped from every workspace agent's
system prompt with no build-time signal.

The always-on layer is now 5,265 characters: purpose, a skills index placed
immediately after the purpose line so truncation can never reach it, the core
invariants, a framework-docs pointer, and the workspace action index. The
long-form detail moved verbatim into two new workspace skills the agent loads on
demand: `workspace-conventions` (docs and source lookup, shared vs app-owned
code, file/blob storage, env and secrets, agent scratch files, Dispatch
Resources) and `adding-workspace-apps` (classifying an "agent" request,
scaffolding `apps/<app-name>`, discovery and descriptions, mounting and base
paths, action-first data, database portability, finishing a chat-template app).
No guidance was removed.
