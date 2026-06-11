---
"@agent-native/core": minor
"@agent-native/skills": minor
---

Add best-effort install-funnel analytics to both skills CLIs (`npx @agent-native/skills` and `npx @agent-native/core skills`). Each run reports a step-by-step funnel — started, skills prompted, skills selected, clients selected, scope selected, install completed, MCP registered, connect, and completed/failed/cancelled — to the first-party Agent Native Analytics endpoint, so install volume, skill selection, and step-by-step dropoff can be measured. Events carry a stable per-machine install id (unique installs) and a per-run id (dropoff) and never include paths, repo names, or other identifying data. Telemetry is fire-and-forget, flushes before exit, and is opt-out via `DO_NOT_TRACK=1` or `AGENT_NATIVE_TELEMETRY_DISABLED=1`.
