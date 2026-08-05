# Email Automation Fresh

An Agent-Native Email Automation Console built on the chat scaffold. The
`/automations` route edits a daily digest, saves the configuration, creates a
durable preview-only test run, and hands the selected run to the contextual
AgentSidebar for review. The `/` route remains the full-page chat surface.

**Live app: [chat.agent-native.com](https://chat.agent-native.com)**

The MVP deliberately sends no email. It provides a safe local loop for
reviewing the digest before a real delivery action is connected.

## Features

- ChatGPT-style shell with a threads list and durable chat history.
- Auth, live sync, and application state wired out of the box.
- The action surface the agent and UI share, plus one example action to copy.
- Sparse automation setup and preview UI with recent-run history.
- Shared actions for reading, updating, listing runs, and creating previews.
- AgentSidebar handoffs with bounded automation/run context.

## Develop locally

Run locally:

```bash
npx @agent-native/core@latest create my-app --standalone --template chat
cd my-app
pnpm install
pnpm dev
```

The committed `agent-native.json` uses `connect` onboarding in development and
`connect-and-integrations` in production. For an account-free loopback preview,
create the ignored `.env` with `AUTH_DISABLED=1`. For local agent work,
optionally set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` there and restart.

Full docs: [agent-native.com/docs/template-chat](https://agent-native.com/docs/template-chat).
