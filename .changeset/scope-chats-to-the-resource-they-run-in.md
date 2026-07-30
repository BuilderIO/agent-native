---
"@agent-native/core": patch
---

Keep each resource's agent chat to itself instead of showing one chat everywhere.

A chat thread's `scope` carried two meanings at once: "general chat, visible in
every resource" and "nobody has told the server this thread's scope yet". Because
those were indistinguishable, a thread that lost its scope silently became a
permanent global chat — it followed the user into every design/deck/form, and
because an unscoped chat is allowed to stay visible, no per-resource chat was ever
started.

Two paths dropped the scope. The server created the row on the first message
without one (`persistSubmittedUserMessage`), even though the client already sends
it and `production-agent` had already normalized it onto
`RequestRunContext.chatScope` — nothing read that field. The client then asserted
`scope: null` on every save for any thread missing from its local list, which the
`PUT` applies unconditionally, cementing the null.

Now the run's scope is used when the row is created, a thread with no scope adopts
the scope of the resource it is used in (`resolveRunThreadScope`, which never
retags or clears an already-scoped thread), and the client only mirrors a scope it
actually knows — `detachThread` remains the single path that clears one. Adoption
also heals threads already stored with `scope: null`. A saved active-chat pointer
is no longer trusted when the thread's known scope belongs to another resource.

Genuinely general chats are unaffected until they are used inside a resource.
