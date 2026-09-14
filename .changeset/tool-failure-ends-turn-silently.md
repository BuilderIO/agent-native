---
"@agent-native/core": patch
---

Stop a turn that ends on a failed tool call from reporting itself as a finished
answer. The run manager treated only a *successful* trailing tool result as an
unfinished turn, so whether a run continued depended on whether some earlier
call in the same turn happened to succeed. A turn whose tail was a failure
terminated as a plain `done`, and the client could render only "The agent
stopped after these actions ... without sending a final message" — the tool's
real error, an expired handoff URL or a missing provider credential, never
reached the user, and asking the agent to continue by hand was the only way to
see it.

A failed tool result now counts as an unfinished turn, so the run continues and
the model reads and reports the error the way it does for any mid-turn failure.
When a turn still ends there, the chat names the action that failed and quotes
its error instead of pointing at the tool card.
