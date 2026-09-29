---
"@agent-native/agentkit": patch
"@agent-native/core": patch
---

Render model-authored follow-up suggestions only for the latest successfully completed turn, retire stale suggestions across new turns and restores, and submit full suggestion prompts through normal context and permission checks. Keep initial empty-state starters separate from conversational follow-ups.

Pass the active thread ID to fullscreen callbacks instead of a menu selection event.
