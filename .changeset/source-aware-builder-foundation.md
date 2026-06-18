---
"@agent-native/core": minor
---

Add source-aware Builder database foundation: derive the real Builder space name via the Admin GraphQL API and surface it (plus the connected spaces) through the Builder status route and `useBuilderStatus`, with non-blocking, cached lookups so the connect-flow polling never blocks on Builder.
