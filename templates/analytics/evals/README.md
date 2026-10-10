# Analytics evals

Run the Analytics eval suite with an explicit caller identity:

```sh
pnpm exec agent-native eval --owner-email person@example.com --org-id org_example --json
```

The Analytics adapter assembles the production framework prompt, Analytics
instructions, initial tools, read-only action registry, and request-time catalog
prefetch. It invokes the shared production `runAgentLoop` with the real Analytics
final-response guard, caller email, organization id, abort signal, and usage
capture. The runner checks a bounded receipt for those conditions and rejects
failed or timed-out prefetch, missing guard/usage, skipped cases, or cancellation.

This exercises the shared production agent-loop boundary; it does not dispatch
through the mounted HTTP chat handler or its thread/run persistence path. The
CLI passes `persist: false`, so it does not write eval-result rows. Identity
must come from these CLI flags or an explicitly injected resolver; it is never
read from environment variables or app configuration.

If either identity value or the production adapter is missing, the command
exits with an error before running or scoring any case.
