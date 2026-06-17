---
"@agent-native/core": minor
---

Add the core of Observational Memory (OM): background compaction of a long
agent thread into a dated, three-tier context (recent raw messages → dense
"observations" → higher-level "reflections") so long-running threads cost far
fewer tokens and stay prompt-cache stable.

This ships the store (a new ownable, dialect-agnostic `observational_memory`
table + additive migrations), the Observer and Reflector compaction passes
(provider-agnostic internal agent calls — no hardcoded model), the
`maybeCompactThread` compactor entry point, and the `buildObservationalContext`
read API returning the three tiers ready for prompt injection, all exported
from `@agent-native/core/agent/observational-memory`.

The read API and compactor are intentionally not yet wired into the agent loop:
injecting `buildObservationalContext` output into `production-agent.ts` (and
registering the migration plugin in the default plugin set) is a follow-up so it
does not collide with concurrent agent-loop changes. The store creates its table
lazily on first use, so OM is fully functional in the meantime.
