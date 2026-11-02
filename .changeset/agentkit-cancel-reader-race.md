---
"@agent-native/core": patch
---

Keep AgentKit run readers attached while a cancel is in flight, so a turn whose event stream closes before the cancel settles still delivers its `run.cancelled` event instead of ending with "event stream ended without a completion".
