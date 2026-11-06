---
"@agent-native/core": patch
---

Local and self-hosted databases that core 0.210 to 0.220 booted now get the `agent_harness_sessions` columns `approval_resolution_id` and `expiry_cleanup_id` on their next boot. Before, the harness recovery sweeps logged `column "approval_resolution_id" does not exist` every 20 seconds and every harness session save failed, because those columns came only from release-only legacy migrations and a baseline these databases had already recorded.
