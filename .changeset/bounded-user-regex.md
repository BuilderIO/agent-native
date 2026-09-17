---
"@agent-native/core": patch
---

Add `compileUserRegex`, `testUserRegex`, and `analyzeRegexSource` to
`@agent-native/core/shared` for evaluating regular expressions that come from an
agent or an end user rather than from source.

`new RegExp(source).test(value)` is not a bounded operation, and JavaScript has
no way to time a match out once V8 is inside it. A pattern an LLM routinely
writes to mean "at least two words" — `^([A-Za-z]+\s?)+$` — is 17 characters,
compiles cleanly, and backtracks exponentially: a 26-character non-matching
value already costs ~750 ms and the cost doubles with every further character.
Stored on a form field it froze the respondent's tab and, because the same
pattern was re-checked on submit, the request handler's event loop with it.
Capping the input length does not help, because the blowup is reached well
inside any sane cap.

`analyzeRegexSource` recognises the ambiguity signatures that cause
super-linear backtracking (nested and adjacent overlapping repetition, nullable
parts under an unbounded repeat, overlapping single-atom alternatives) and
refuses those patterns instead of running them. Patterns it clears are still
evaluated against a capped input. `testUserRegex` returns a tri-state result so
"did not match" and "was not evaluated" stay distinguishable — collapsing the
second into the first is how an unenforceable rule silently becomes an
enforced-looking one.
