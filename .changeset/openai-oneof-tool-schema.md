---
"@agent-native/core": patch
---

Rewrite `oneOf` to `anyOf` in generated tool schemas. OpenAI's function-calling
validator rejects `oneOf` outright, and Zod v4 emits it for every
`z.discriminatedUnion`, so a single action carrying one 400'd the entire chat
request before any token streamed — every tool in the payload, not just that
action. Measured at 178k errors across 786 users over seven weeks. Also stops a
settings-read failure in the chat-health pager from reading as "never paged".
