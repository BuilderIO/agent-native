---
"@agent-native/core": patch
---

Bind agent chat threads to the resource in view again, and track runs per thread.

`MultiTabAssistantChat` was passing `scope: null` into `useChatThreads`, so every
chat was global: opening a second design (deck, form, …) restored — and typed
into — the previously opened one's thread. Chats started while viewing a resource
are tagged with it again, and the open-tab list is per-scope, so unscoped general
chats still follow the user everywhere while a resource's chat stays with it.

Active-run state (`agent-chat-active-run`) is now keyed by thread instead of a
single global slot. Two chats running at once no longer erase each other's
reconnect cursor, and stopping (or sending while running in) one chat can no
longer abort another chat's run. Callers ask for a specific thread's run;
`listActiveRuns()` is the only way to see all of them, so code with no thread in
hand has to decide what to do about ambiguity instead of silently acting on a
stranger's run.
