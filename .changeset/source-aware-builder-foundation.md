---
"@agent-native/core": minor
---

Add source-aware Builder database foundation: derive the real Builder space name via the Admin GraphQL API and surface it (plus the connected spaces) through the Builder status route and `useBuilderStatus`, with non-blocking, cached lookups so the connect-flow polling never blocks on Builder.

Builder deploy credentials remain blocked from impersonating signed-in users in hosted production. Local development can explicitly opt into env-key fallback for Builder dogfooding with `AGENT_NATIVE_LOCAL_BUILDER_ENV=1`; the escape hatch is non-production only.
