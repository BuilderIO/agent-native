---
"@agent-native/core": patch
---

Stop sending unbounded inline base64 attachments to the model. Text attachments
were capped; binary ones were not, so a large screenshot or PDF went out as a
multi-megabyte `file_url` and OpenAI rejected the entire request ("string too
long", 4,149,128 against a 1,048,576 limit), killing the turn. The upload to
blob storage already happened — the hosted URL is now used in place of the bytes
when they exceed the cap, instead of being discarded.
