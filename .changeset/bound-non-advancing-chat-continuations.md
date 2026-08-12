---
"@agent-native/core": patch
---

Stop runaway chat turns: one "did this continuation advance?" budget now covers every reason code including `loop_limit`, failed prior-turn tool calls replay as failures instead of successes, and a retry `clear` no longer deletes narration from earlier steps of the turn.
