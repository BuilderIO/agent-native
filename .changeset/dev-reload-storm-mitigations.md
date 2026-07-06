---
"@agent-native/core": patch
---

Reduce full-page reload churn while an agent (e.g. Builder Fusion) is editing app source in dev: coalesce the AGENTS.md / SKILL.md watcher's dev-server full-reload into a single reload per write burst (module invalidation still happens per event), and add a 2s cooldown to the host-bridge `hardReload` / `hard-reload` postMessage commands so an embedding host cannot keep the page permanently mid-reload.
