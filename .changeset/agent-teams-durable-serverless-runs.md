---
"@agent-native/core": patch
---

Agent Teams sub-agents now run reliably on serverless hosts (Netlify/Vercel/AWS Lambda).

Previously a spawned sub-agent executed as an in-process detached promise from the spawning request. Serverless hosts freeze the function the moment that response flushes, so the sub-agent was suspended mid-run and never completed — yet `spawn` had already returned `status: "running"`, which the orchestrator narrated as "done." Background "batch" jobs reported success but produced no output.

Sub-agents now use the framework's durable enqueue-to-SQL + self-fire-HTTP pattern (the same one A2A async tasks and integration webhooks use): `spawnTask` enqueues the run and self-fires a fresh, HMAC-signed POST to a new `/_agent-native/agent-teams/_process-run` route, which executes the run in its own function invocation with its own timeout budget. Runs longer than one function's wall-clock checkpoint at the soft-timeout boundary and self-fire a continuation chunk (the server-side analog of the main chat's client-driven continuation), folding into one durable assistant message via a stable turn id. An atomic SQL claim makes duplicate dispatches idempotent.

Status reporting is now truthful and observable: `status`/`read-result`/`list` reconcile against the durable queue (a single completed chunk at a continuation boundary no longer prematurely marks a multi-chunk task done), dropped dispatches are re-fired, and genuinely-stalled runs fail with a real message instead of hanging as "running." The RunsTray now self-heals an owner's in-flight runs on read, so it reflects precise status without waiting on the orchestrator to poll.

This path is host-agnostic — it works anywhere Nitro deploys (no `waitUntil` dependency) and falls back to localhost self-dispatch in dev. It requires `APP_URL`/`URL`/`DEPLOY_URL`/`BETTER_AUTH_URL` to be set in production/shared deployments so the deployment can reach its own URL (the same requirement async A2A and webhooks already carry).

Note: the previous best-effort "sub-agent finished" auto-recap on the parent thread (a second in-process run that also never survived serverless) is removed; the orchestrator is instead prompted to read `status`/`read-result`, and the RunsTray surfaces completion.
