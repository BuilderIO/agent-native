# Mail

An open-source, agent-native alternative to Superhuman. An agent-powered,
keyboard-first email client for Gmail — the agent can read, draft, send, and
organize email for you, and the codebase is yours to own.

**Live app: [mail.agent-native.com](https://mail.agent-native.com)**

Connect one or more Gmail accounts and drive a fast, keyboard-first inbox
yourself, or ask the agent to do anything you can. The agent always knows which
view you're in and which thread is open, so "archive this" just works.

## Features

- Keyboard-first triage (`J`/`K` to move, `E` to archive, `R` to reply, `C` to compose).
- Multiple Gmail accounts in one inbox.
- Ask the agent to summarize, draft, reply, archive, or bulk-clean your inbox.
- Natural-language auto-triage rules (label, archive, mark read, star, trash).
- Open and click tracking on emails you send.
- Search across every connected inbox with one query.
- Queue drafts for review from teammates or Slack.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-mail --standalone --template mail
cd my-mail
pnpm install
pnpm dev
```

Connecting Gmail in dev needs a Google OAuth client — see the docs for setup.
Full docs: [agent-native.com/docs/template-mail](https://agent-native.com/docs/template-mail).
