---
"@agent-native/core": patch
---

diag(agent): add awaited `post_model_awaited` and `pre_claim` probes in the durable background worker. `worker_stage` stalls at `model_done` even though the code right after is trivial sync; these awaited (withDbTimeout-bounded) writes distinguish a hung bg-fn DB connection right after model resolution (probe never lands) from a later main-flow stall (probe lands, then the stall is downstream).
