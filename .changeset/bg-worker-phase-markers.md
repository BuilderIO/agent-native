---
"@agent-native/core": patch
---

diag(agent): add awaited phase markers (`aw_env`, `aw_presend`, `aw_actions`, `aw_owner`) across the durable background worker's post-`model_done` setup. The awaited `post_model` probe lands (writes work after model resolution), so the worker's stall is a main-flow stall, not a DB hang — these markers advance `worker_stage` to the last phase the main flow actually reached, pinpointing the stall.
