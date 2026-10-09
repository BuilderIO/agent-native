# Analytics evals

Run the Analytics eval suite with an explicit caller identity:

```sh
pnpm exec agent-native eval --owner-email person@example.com --org-id org_example --json
```

The runner requires an adapter that invokes the mounted production chat handler
and returns a bounded setup receipt for request preparation, assembled prompt,
prefetch status, final guard, identity, and read-only action surface. Identity
must come from these CLI flags or an explicitly injected resolver; it is never
read from environment variables or app configuration. Results are not persisted.

The current `production-context.ts` exports the Analytics guard, prompt rules,
and static read-only actions, but it cannot invoke the production HTTP handler.
That handler owns `prepareRequest`, request-time prefetch, and dynamic prompt/tool
assembly inside its plugin closure. The eval command therefore fails closed
until a safe test adapter for that path is exposed. Direct-loop results are not
accepted as production-path eval evidence.

If either identity value or the adapter is missing, the command exits with an
error before running or scoring any case.
