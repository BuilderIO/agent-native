---
"@agent-native/core": minor
---

Lazy-load the assistant-ui chat stack (~650-700 KB gzip) off the critical path of every page.

- `AgentPanel`: `MultiTabAssistantChat` converted to `React.lazy` + `Suspense`; sidebar chrome renders immediately while the chat chunk loads.
- `AssistantChat`: `react-markdown` + `remark-gfm` deferred via a module-level async loader (same pattern as shiki); plain-text fallback shown during the one-frame load window.
- New `@agent-native/core/client/api-path` source alias registered in `CORE_CLIENT_SUBPATHS` and `getCoreSourceAliases` so monorepo dev resolves it from `src/`.
- All `templates/*/app/entry.client.tsx` (and the scaffold copy) changed to `import { appBasePath } from '@agent-native/core/client/api-path'` so the full client barrel — and its transitive chat-stack imports — are no longer in the static closure of the client entry point.
- `@agent-native/core/client/api-path` is an existing public export; `AssistantChat`, `MultiTabAssistantChat`, `ResourcesPanel`, `SettingsPanel`, and `AgentTerminal` remain re-exported from the barrel for consumers that use them directly (marked minor because the barrel lazy-routing is a behaviour change for those named re-exports).
