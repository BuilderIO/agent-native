---
"@agent-native/core": minor
---

Resurrect end-to-end action type inference.

`defineAction` overloads now return a typed `ActionDefinition<TInput, TReturn>` instead of `any`. The schema-inferred input type (via `StandardSchemaV1.InferOutput<TSchema>`) and the run callback's return type flow through to `useActionQuery`, `useActionMutation`, and `callAction` once the generated `.generated/action-types.d.ts` is included in the project's TypeScript config.

- Added `ActionDefinition<TInput, TReturn>` interface (exported from `@agent-native/core`).
- All 15 template `tsconfig.json` files now include `.generated/**/*` so the generated registry d.ts is picked up automatically.
- Scaffold default tsconfig updated to match.
- Exports `ActionDefinition` from the core package index.
