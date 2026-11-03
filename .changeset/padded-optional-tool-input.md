---
"@agent-native/core": patch
---

Stop refusing tool calls that pad optional fields with null beside empty values when the call is read-only or the empty value equals the schema default. Writes with a non-default empty value still refuse.
