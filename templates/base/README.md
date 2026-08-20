# Base

The un-opinionated agent-native starter — a chat-first shell with durable
threads, standard app navigation, auth, live sync, and actions. Start here
when you want a real browser app you can grow into a to-do list, an SEO
agent, or any other domain without inheriting another product's traces.

## Features

- Chat-first shell with a threads list and durable chat history.
- Auth, live sync, and application state wired out of the box.
- The action surface the agent and UI share, plus one example action to copy.
- A minimal, brandable base for any domain app.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-app --standalone --template base
cd my-app
pnpm install
pnpm dev
```

`--template starter` is a legacy alias for Base. Use `--template chat` when you
want the Chat product (locales, language picker, changelog), not this starter.
