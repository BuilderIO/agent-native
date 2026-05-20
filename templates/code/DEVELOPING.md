# Developing Agent-Native Code

This template is hidden because it is an ecosystem/developer surface, not a public SaaS template.

Use it to customize the Agent-Native Code UI:

1. Edit the shared UI package in `packages/code-agents-ui` when the change should benefit Desktop and every host.
2. Edit `templates/code/app/routes/_index.tsx` when the change is specific to this browser-hosted template.
3. Edit `templates/code/actions/*` when changing the local host adapter.

Keep prompt entry shared. Code-specific UI may add slots for Auto / Plan,
cwd/project metadata, and host actions, but the input field itself should stay
on `AgentComposerFrame`, `PromptComposer`, and `TiptapComposer` from
`@agent-native/core/client`. Commands and skills come from `.agents/commands`
and `.agents/skills`, not a new in-component registry.

Keep background execution shared too. Use `@agent-native/core/code-agents` for
local Code sessions, its background-run adapter/foundation for cross-surface
run lists, and the core `run-manager` / `agent-teams` harness for hosted
background agents. Do not create a second background-agent runner for
template-only UI changes.

Treat this as the regression hook for Code, Brain, and sidebar prompt surfaces:
prompt entry stays on `PromptComposer`, and background work stays on the shared
adapters (`code-agents`, background-run, `run-manager`, or Agent Teams).
Follow-ups should be durable two-way messages: steer at a safe continuation
point when possible, otherwise queue safely.

Run:

```bash
pnpm --filter @agent-native/code-agents-ui typecheck
pnpm --filter code typecheck
```
