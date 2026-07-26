---
"@agent-native/core": patch
---

Stop charging every agent turn for guidance the model already reads elsewhere.
The runtime system prompt restated whole tool descriptions: rule 5 repeated
`refresh-screen`'s description nearly verbatim, rule 12 repeated every bullet of
`manage-progress`'s start/update/complete discipline, rule 10 re-described
`tool-search`, and the production `connect-builder` section restated the
`builderEnabled` semantics and its "never send users to Builder org settings"
guard three separate times. Deferred tools are loaded through `tool-search`, so
the model always reads a tool's description before it can call the tool — the
prompt only needs to say the capability exists and when it applies.

Each of those now states its trigger and defers the mechanics to the tool
description, and the two overlapping response-style sections merged into one
(both told the model to "lead with the outcome"). Also dropped the arbitrary
formatting prescriptions (bullet counts, nesting bans) and the dev-mode few-shot
`bash` examples in favor of stating the intent. Security, anti-fabrication, and
`db-*` isolation rules are unchanged.

The default production prompt is ~9% smaller and the verbose variant ~17%, with
no capability removed.
