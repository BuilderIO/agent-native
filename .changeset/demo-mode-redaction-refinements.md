---
"@agent-native/core": patch
---

Refine Demo Mode redaction: only coerce a name-key value to a fake name when it's a 2–4 word person name (mail labels/tabs like "Important" no longer mangled); stable mappings via a bounded, TTL'd, leak-free cache plus produced-fake idempotency so names/emails don't drift when a draft is edited and refetched; realistic stand-in email domains instead of example.com; protect SQL/query/expression/code keys so analytics panel queries aren't corrupted by redaction (chart titles/names still faked, queries run intact); fetch interceptor hardened to be a zero-overhead pass-through when demo mode is off and to never touch agent/run/streaming transport. Plus DemoModeSection/action-routes wiring and tightened TiptapComposer, use-chat-threads, and use-db-sync behavior.
