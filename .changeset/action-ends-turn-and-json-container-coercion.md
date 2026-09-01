---
"@agent-native/core": patch
---

Let actions declare `endsTurn`, and unwrap a JSON-encoded tool argument on its container type.

`endsTurn` already stopped the agent loop for core's own `ask-question`, but
`defineAction` never exposed it, so a template action that puts a question or
form on screen could not say the turn was over. The loop asked the model for
another step and a completion guard scored the paused turn as a failure.

`coerceStringifiedJsonToolValues` also required a stringified argument's parsed
contents to fully validate before unwrapping it. A model that JSON-encoded an
array whose items were missing a property was told only "must be array" — never
the per-item defect — so it re-encoded the same payload until its retry budget
ran out.
