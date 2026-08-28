---
"@agent-native/core": patch
---

Emit `$ai_http_status` on `$ai_generation` events. A model call that streamed to completion reports 200; the call a run died in reports the provider status the engine named. A failure that carried no status omits the field rather than defaulting it, so a transport drop is never reported as a healthy call or an invented rejection.
