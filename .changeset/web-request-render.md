---
"@agent-native/core": minor
---

Add a vendor-neutral `render` capability to the `web-request` tool. Setting `render: true` (GET only) executes the page through a configured page renderer before extraction, so JavaScript-rendered SPAs and anti-bot-protected pages — which the built-in fetch + Readability path returns empty or blocked — extract correctly.

The tool surface stays neutral: callers pass `render: true`, never a vendor name. Renderer backends are pluggable behind a `PageRenderer` abstraction (`web-render.ts`) and resolved at call time. This change ships one backend (Firecrawl, via `FIRECRAWL_API_KEY`); a browser-automation renderer (chrome-devtools / playwright) is the natural second backend and slots in at `RENDERER_FACTORIES` without touching the tool. The rendered HTML flows through the existing extraction pipeline, so all `responseMode`/`search`/`links`/`saveToFile` behavior is unchanged.
