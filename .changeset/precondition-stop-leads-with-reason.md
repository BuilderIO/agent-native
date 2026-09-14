---
"@agent-native/core": patch
---

Agent chat: a `permanent_precondition` stop now leads with the concrete reason from the tool error ("mutate-dashboard can't run yet: Requires editor role on dashboard … (have viewer)") instead of a generic "needs a setup step" sentence, for both the user-facing headline and the tool result the model sees.
