---
"@agent-native/core": patch
---

Stop apps from handing each other raw queries to execute. An action whose input
is a program the receiver runs — `sql`, `code`, `script`, `expression` — is no
longer invocable by a sibling app over A2A.

The app that owns the data owns its schema, data dictionary, reference
dashboards, and dialect quirks. A calling app has none of that, so passing SQL
across apps makes every caller reimplement the owner's schema knowledge from
guesses, and each copy silently rots the next time the owner's shape changes.
Callers ask the owning app a question, or call a shaped action that takes
semantic parameters; the owner forms the query. `publicAgent.allowRawQueryInput`
opts a specific action out when that is genuinely the right call.

`query` is deliberately not treated as a raw query field: across the templates
it is natural-language search text (Brain's `search-everything`,
`search-knowledge`), and blocking it would break the ask-don't-instruct calls
this rule exists to encourage. MCP and in-app tool surfaces are unchanged — this
narrows cross-app invocation only.

Agent cards also now publish each advertised skill's `inputSchema`, and
`describe-workspace-apps` renders it as `input: { field*: type }`. Advertising an
action without its parameters is what led callers to invoke it with `{}` and fail
on a required field.
