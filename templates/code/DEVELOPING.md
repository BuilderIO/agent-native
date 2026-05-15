# Developing Agent-Native Code

This template is hidden because it is an ecosystem/developer surface, not a public SaaS template.

Use it to customize the Agent-Native Code UI:

1. Edit the shared UI package in `packages/code-agents-ui` when the change should benefit Desktop and every host.
2. Edit `templates/code/app/routes/_index.tsx` when the change is specific to this browser-hosted template.
3. Edit `templates/code/actions/*` when changing the local host adapter.

Run:

```bash
pnpm --filter @agent-native/code-agents-ui typecheck
pnpm --filter code typecheck
```
