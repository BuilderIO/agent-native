# Dispatch

The agent-native workspace control plane — a central Slack/Telegram inbox, a
secrets vault, scheduled jobs, approvals, and an orchestrator agent that delegates
work to the right specialist app over A2A.

**Live app: [dispatch.agent-native.com](https://dispatch.agent-native.com)**

Where other templates are domain apps (Mail, Calendar, Analytics, Brain),
Dispatch is the app you run _alongside_ them to coordinate everything. It routes
messages, holds shared credentials, runs cross-app jobs, and gates sensitive
actions behind approvals.

## Features

- Central inbox for Slack DMs, Telegram, email, and A2A requests from other agents.
- Orchestrator agent that triages and delegates domain work over A2A.
- Secrets vault with per-app grants and an audit trail.
- Workspace resources: shared skills, guardrails, agent profiles, and MCP servers.
- Cross-app scheduled/recurring jobs.
- Approval queue for destructive or external actions.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-dispatch --standalone --template dispatch
cd my-dispatch
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-dispatch](https://agent-native.com/docs/template-dispatch).
