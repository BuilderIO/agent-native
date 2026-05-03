---
title: "FAQ"
description: "Common questions about agent-native — what it is, who it's for, what you can build, and how it works."
---

# FAQ

Common questions about agent-native, organized from "I'm just looking" to "I'm wiring up auth right now."

## The basics {#general}

### What is agent-native? {#what-is-agent-native}

Agent-native is a framework for building apps where the AI agent and the UI are equal partners. They share the same database, the same state, and they always stay in sync. Everything the UI can do, the agent can do — and vice versa. See [What Is Agent-Native?](/docs/what-is-agent-native) for the full explanation.

### Who is this for? {#who-is-this-for}

Anyone who wants to ship an AI-powered product without spending a year building the boring parts. That includes:

- **Founders and PMs** who want to fork a working SaaS and make it their own — see [Cloneable SaaS](/docs/cloneable-saas).
- **Operators** who want a [pure-agent app](/docs/pure-agent-apps) — an agent that does work in the background with a minimal management UI.
- **Developers** building agent-driven products from scratch and want auth, multi-tenancy, real-time sync, and an architecture that won't break when AI is the primary user.

### How is this different from adding AI to an existing app? {#how-is-this-different}

Most apps bolt AI on as an afterthought — an autocomplete here, a chat sidebar there. The AI can't actually _do_ things in the app. In an agent-native app, the agent is a first-class citizen. It can create emails, schedule events, build forms, generate slides, and modify the app's own code. The architecture is designed for this from the ground up.

### Is it open source? {#is-this-open-source}

Yes. The framework and all templates are open source. You can run everything locally, self-host, or use Builder.io's cloud for managed hosting, collaboration, and team features.

### How much does it cost? {#how-much}

The framework itself is free. The two costs you'll see in practice:

- **AI usage.** You bring your own API key (Anthropic, OpenAI, etc.) and pay the model provider directly. There's no markup from us.
- **Hosting.** Whatever your host charges. Most templates run fine on free tiers (Netlify, Vercel, Cloudflare) for small workloads.

If you'd rather not manage any of this, the hosted version on `agent-native.com` (operated by Builder.io) bundles inference and hosting into a per-seat plan.

### Can I host this myself? {#can-i-self-host}

Yes. Pick any host that runs Node — Netlify, Vercel, Cloudflare, AWS, Deno Deploy, your own server — and any SQL database (Postgres, SQLite, Turso, D1). The framework is built to be portable. See [Deployment](/docs/deployment).

### What AI models does it support? {#what-models}

Anthropic Claude, OpenAI (GPT-5 family), Google Gemini, and any provider that speaks the OpenAI API shape (including local models via Ollama). You configure the model in settings; switching is a config change, not a code rewrite. The framework's heaviest tested path is Claude, so that's the default recommendation.

### Do I need to know AI/ML? {#do-i-need-to-know-ai}

No. You don't train models, fine-tune, or deal with embeddings. You build a regular web app — and on the hosted version, you barely build anything at all. The framework handles the agent integration: routing messages, running actions, syncing state.

### Can I migrate an existing app to agent-native? {#can-i-use-existing-code}

You can, but agent-native works best when built from the ground up. The architecture — shared database, polling sync, actions, application state — needs to be integrated throughout. Starting from a template and customizing it is the recommended path. Think of it like the shift from desktop-first to mobile-first: you _can_ retrofit, but building native is better.

## Templates and what you can build {#templates}

### What templates are available? {#what-templates-are-available}

The framework ships with production-ready templates you can use as daily drivers:

- **[Mail](/templates/mail)** — full-featured email client (like Superhuman)
- **[Calendar](/templates/calendar)** — Google Calendar + Calendly-style booking links
- **[Content](/templates/content)** — Notion-style documents
- **[Slides](/templates/slides)** — presentation builder
- **[Video](/templates/video)** — video composition with Remotion
- **[Analytics](/templates/analytics)** — data platform (like Amplitude/Mixpanel)
- **[Clips](/templates/clips)** — async screen + camera recording (replaces Loom)
- **[Design](/templates/design)** — agent-native HTML prototyping studio
- **[Forms](/templates/forms)** — form builder (like Typeform)
- **[Dispatch](/templates/dispatch)** — workspace control plane: shared secrets, integrations, jobs

Each template is a complete app with UI, agent actions, database schema, and AI instructions. See [Cloneable SaaS](/docs/cloneable-saas) for the full picture, or all [Templates](/templates).

### Can I customize templates? {#can-i-customize-templates}

That's the whole point. Fork a template and customize it by asking the agent. "Add a priority field to forms." "Connect to our Salesforce instance." "Change the color scheme to match our brand." The agent modifies the code, and your app evolves over time.

### Can I build something the templates don't cover? {#build-from-scratch}

Yes. Run `npx @agent-native/core create my-app` without picking a template — you get the framework scaffolding (frontend, backend, agent panel, database) but no domain-specific code. See [Getting Started](/docs/getting-started). For agent-first products with no traditional UI, see [Pure-Agent Apps](/docs/pure-agent-apps).

## Agent capabilities {#agent-capabilities}

### Can the agent really modify the app's own code? {#can-the-agent-modify-code}

Yes, and it's a feature. The agent can safely edit components, routes, styles, and actions. You ask "add a cohort analysis chart" and the agent builds it. You ask "connect to our Stripe account" and the agent writes the integration. Everything is normal Git-tracked code, so bad changes are easy to revert.

### Can users talk to the agent from outside the app? {#external-channels}

Yes. The same agent runs in your web UI, in Slack, in Telegram, over email, and from other agents (via [A2A](/docs/a2a-protocol)). It's the same agent with the same memory and the same actions, just reached through different channels. See [Messaging the agent](/docs/messaging).

### Can agents talk to each other? {#can-agents-talk-to-each-other}

Yes, via the [A2A (Agent-to-Agent) protocol](/docs/a2a-protocol). Every agent-native app automatically gets an A2A endpoint. From the mail app, you can tag the analytics agent to query data. An agent discovers what other agents are available, calls them over the protocol, and shows results in the UI. No configuration needed — the agent card is auto-generated from your template's actions.

### What can the agent see in the app? {#what-can-the-agent-see}

The agent always knows what the user is currently viewing. The UI writes navigation state to the database on every route change — which view is open, which item is selected. The agent reads this before taking action. If an email is open, the agent knows which email. If a slide is selected, the agent knows which slide. See [Context Awareness](/docs/context-awareness).

## Development questions {#development}

### Which AI coding tools work with agent-native? {#which-ai-tools-work}

Any AI coding tool that reads project instructions. The framework uses AGENTS.md as the universal standard and auto-creates symlinks for specific tools:

- **Claude Code** — reads CLAUDE.md (symlinked from AGENTS.md)
- **Cursor** — reads .cursorrules (symlinked from AGENTS.md)
- **Windsurf** — reads .windsurfrules (symlinked from AGENTS.md)
- **Codex, Gemini, and others** — work via the embedded agent panel
- **Builder.io** — cloud-hosted agent with visual editing and collaboration

### Can I use my own database? {#can-i-use-my-own-database}

Yes. Set `DATABASE_URL` and the framework auto-detects it. Supported databases include SQLite, Postgres (Neon, Supabase, plain), Turso (libSQL), and Cloudflare D1. All SQL is dialect-agnostic via Drizzle ORM — the same code works everywhere.

### Where can I deploy? {#where-can-i-deploy}

Anywhere. The server runs on Nitro, which compiles to any deployment target: Node.js, Cloudflare Workers/Pages, Netlify, Vercel, Deno Deploy, AWS Lambda, and Bun. You can also use Builder.io's hosting for managed deployments. See the [Deployment guide](/docs/deployment).

## Architecture {#architecture}

### Why polling instead of WebSockets? {#why-polling-not-websockets}

Polling works in every deployment environment — including serverless, edge, and container platforms where persistent connections aren't available. The framework polls every 2 seconds using a lightweight version counter. When changes are detected, React Query caches are invalidated and components re-render. It's simple, reliable, and universal.

### Why can't the UI call an LLM directly? {#why-no-inline-llm-calls}

AI is non-deterministic — you need conversation flow to give feedback and iterate, not one-shot buttons. The agent has your full codebase, instructions, skills, and conversation history. An inline LLM call has none of that. Plus, routing everything through the agent means the app can be driven from Slack, Telegram, or another agent via [A2A](/docs/a2a-protocol) — not just the UI.

### Why is this a framework and not a library? {#why-framework-not-library}

The shared database, polling sync, actions system, and application state all need to work together as a cohesive architecture. A library could give you pieces, but agent-native requires that the agent and UI are wired together from the ground up. Multiple agents need to be able to communicate, the UI needs to react to agent changes instantly, and the agent needs to understand what the user is looking at. That's an architecture, not a utility.
