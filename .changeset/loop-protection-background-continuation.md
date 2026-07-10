---
"@agent-native/core": patch
---

Fix long agent-chat turns dying with a Netlify "508 Loop Detected" error after several server-driven continuation chunks: nested self-dispatch chains now break proactively before the platform's undocumented loop-protection limit, and a 508 that does occur is classified distinctly and deferred to the existing unclaimed-run sweep for recovery instead of failing the turn outright.
