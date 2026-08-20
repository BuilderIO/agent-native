# Base

The un-opinionated agent-native starter — standard auth, actions, live sync, and
settings with an empty home screen. Start here when you want a real browser app
you can grow into a to-do list, an SEO agent, or any other domain without
inheriting another product's traces.

## Features

- Empty home screen ready for your first route or layout.
- Auth, live sync, and application state wired out of the box.
- The action surface the agent and UI share, plus one example action to copy.
- English-only by default — no locale catalogs or changelog until you opt in.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-app --standalone --template base
cd my-app
pnpm install
pnpm dev
```

`--template starter` is a legacy alias for Base. Use `--template chat` when you
want the Chat product (locales, language picker, changelog, full-page chat).
