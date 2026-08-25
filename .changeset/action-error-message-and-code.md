---
"@agent-native/core": patch
---

Give UI and agents the parts of a `fail()` failure they were missing.

Action errors now carry `actionMessage`, the text the action wrote with no
`Action <name> failed:` framing, plus an `actionErrorMessage()` helper exported
from `@agent-native/core/client/hooks`. Templates render `error.message`
directly, so a refusal surfaced as "Action update-brand-kit failed: That name
is taken." The helper returns `undefined` when nothing authored a message (a
network drop, a proxy's HTML error page, a bare status line), so a UI cannot
mistake transport noise for copy.

Tool results now include the `errorCode` an action chose, as
`Error running get-meeting: No such meeting (errorCode: not_found)`, on both
the in-app agent loop and MCP. The model can branch on the code without parsing
prose. `fail()`'s default `action_failed` is omitted, since it says only "it
failed", which the word "Error" already said.
