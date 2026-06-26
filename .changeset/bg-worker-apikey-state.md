---
"@agent-native/core": patch
---

diag(agent): capture the durable background worker's API-key resolution state (engine, owner resolved, owner key, effective key, deploy-fallback-blocked) just before the anthropic key check. The worker stalls at `post_model_ok` and never reaches `aw_env` — the only exit between them is the anthropic key check's early return, so this pinpoints whether the worker bails for lack of an `effectiveApiKey`.
