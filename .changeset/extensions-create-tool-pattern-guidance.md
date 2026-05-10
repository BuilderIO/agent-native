---
"@agent-native/core": patch
---

Strengthen the `create-extension` tool description so the agent generates more
robust extensions: prefer `<script>` + `Alpine.data('name', () => ({...}))`
for any non-trivial component instead of stuffing methods, branching, and
template literals into an inline `x-data="..."` attribute (HTML parser
pitfalls cause `ReferenceError` failures); require a real LLM key via
`${keys.*}` for AI features or route the AI work to the agent chat instead
of shipping a stubbed analysis step.
