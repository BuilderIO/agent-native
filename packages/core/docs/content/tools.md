---
title: "Tools"
description: "Lightweight interactive apps — dashboards, widgets, calculators, monitors — that the agent creates for you instantly, without changing your app's code."
---

# Tools

Tools are lightweight interactive apps that live inside your agent-native app. Think dashboards, widgets, calculators, API monitors, data lookups — anything you'd otherwise build by hand.

The key difference from the rest of your app: **tools don't require code changes.** The agent creates and updates them at runtime, they're stored in the database, and they're ready to use immediately. No deploys, no builds, no pull requests.

## Tools vs. editing the app {#tools-vs-code}

Your agent-native app has a full codebase — React components, routes, actions, styles. When the agent edits that code, it's changing the app itself. That's powerful, but it requires a build step and a deploy.

Tools are different:

| | App code | Tools |
| --- | --- | --- |
| **Created by** | Developer or agent editing source files | Agent or user, instantly from chat |
| **Stored in** | Git repository | Database |
| **Requires a build** | Yes | No |
| **Requires a deploy** | Yes | No |
| **Scope** | Part of the app for all users | Private by default, shareable |
| **Best for** | Core app features | Personal dashboards, utilities, quick integrations |

Use app code for features that are core to the product. Use tools for everything else — one-off utilities, personal dashboards, quick integrations, monitors, and things you want to spin up in seconds.

## Creating a tool {#creating}

### From the sidebar

Click the **+** button in the Tools section of the sidebar. Describe what you want in plain language — "a dashboard that shows my open GitHub PRs" — and the agent builds it for you.

### From chat

Just ask: "Create a tool that monitors our API health" or "Make me a calculator for shipping costs." The agent handles the rest.

### Updating a tool

Ask the agent: "Update my PR dashboard to also show draft PRs" or "Add a dark mode toggle to the weather widget." The agent makes surgical edits without regenerating the whole thing.

## What tools can do {#capabilities}

Tools are fully capable despite being lightweight. They can:

- **Call external APIs** — GitHub, Stripe, weather services, any REST API. Requests go through a secure server-side proxy that keeps your API keys safe.
- **Call your app's actions** — anything your agent can do, a tool can trigger.
- **Query your app's database** — read and write data directly.
- **Store their own data** — each tool has built-in persistent storage, no setup required. Save notes, preferences, cached results — whatever the tool needs.
- **Call any endpoint in your app** — hit custom API routes, webhooks, or internal services.

All of this works out of the box. No configuration, no new files, no schema changes.

## Persistent storage {#persistent-storage}

Every tool has access to a built-in key-value store. Data is automatically scoped per tool and per user — your data stays yours.

When you ask the agent to "add persistence" or "remember state" in a tool, it uses this built-in storage. No database tables to create, no migrations to run.

## API keys and secrets {#secrets}

When a tool needs an API key (for GitHub, OpenAI, a weather service, etc.), the agent will tell you what's needed and where to get it. You add the key through the Settings UI in the agent sidebar.

Keys are encrypted and stored securely. Each key is restricted to specific domains — a GitHub token can only be sent to `api.github.com`, never anywhere else.

## Sharing {#sharing}

Tools are **private by default** — only you can see and use a tool you create.

You can share tools with your team:

- **Org-visible** — everyone in your organization can use it.
- **Per-user sharing** — grant access to specific people as viewers, editors, or admins.

Shared tools have their own URLs, so you can link to them directly.

## Security {#security}

Tools run in a secure sandbox:

- **Isolated** — tools can't access your app's cookies, session, or page content.
- **API keys stay server-side** — secrets are injected by the server, never exposed to the browser.
- **Domain-restricted secrets** — each API key can only be sent to its approved domains.
- **Private network protection** — tools can't reach internal/private network addresses.
- **Authentication required** — only logged-in users can use tools.

## Examples {#examples}

Here are some things people build as tools:

- **GitHub PR dashboard** — see open PRs, review status, and CI checks at a glance
- **API health monitor** — check if your services are up with a single click
- **Weather widget** — quick weather lookup for any city
- **Stripe payment lookup** — search recent payments and refunds
- **Database explorer** — browse and query your app's data
- **Shipping cost calculator** — compute rates based on weight and destination
- **Meeting notes summarizer** — paste notes, get action items
- **Social media scheduler** — draft and schedule posts across platforms

To create any of these, just describe what you want in the agent chat.

## What's next

- [**Actions**](/docs/actions) — the operations that tools (and the agent) can call
- [**Workspace**](/docs/workspace) — the broader workspace system tools live alongside
- [**Security**](/docs/security) — the framework's data scoping and access control
