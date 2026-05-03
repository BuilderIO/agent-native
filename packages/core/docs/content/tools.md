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

|                       | App code                                | Tools                                              |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| **Created by**        | Developer or agent editing source files | Agent or user, instantly from chat                 |
| **Stored in**         | Git repository                          | Database                                           |
| **Requires a build**  | Yes                                     | No                                                 |
| **Requires a deploy** | Yes                                     | No                                                 |
| **Scope**             | Part of the app for all users           | Private by default, shareable                      |
| **Best for**          | Core app features                       | Personal dashboards, utilities, quick integrations |

Use app code for features that are core to the product. Use tools for everything else — one-off utilities, personal dashboards, quick integrations, monitors, and things you want to spin up in seconds.

## When to build a tool vs. a template feature {#when-to-build}

A quick decision rubric:

**Build a tool when:**

- It's for one user or one team, not the whole product.
- It's a quick utility, dashboard, or widget you want now, not next sprint.
- No new database schema is needed (or per-tool key-value storage is enough).
- You want to ship it inside a single chat turn, no deploy.

**Add a template feature when:**

- Every user of the template should get it.
- It needs new SQL tables, migrations, or shared schema changes.
- The UI is complex enough to warrant React components, routes, and proper testing.
- It's part of the product surface — something you'd advertise on a landing page.

When in doubt, start as a tool. Promoting a tool to a template feature later is straightforward; rolling back a half-shipped product feature is not.

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

## Layout defaults {#layout}

Tools render with modest canvas padding by default so simple widgets and dashboards do not hug the iframe edge. For full-bleed experiences such as maps, canvases, or custom editors, set `data-tool-layout="full-bleed"` or `data-tool-padding="none"` on the outermost element.

## Persistent storage {#persistent-storage}

Every tool has access to a built-in key-value store via the `toolData` helper. Data is automatically scoped per tool and per user — your data stays yours.

When you ask the agent to "add persistence" or "remember state" in a tool, it uses this built-in storage. No database tables to create, no migrations to run.

### Scopes

All `toolData` methods accept an optional `{ scope }` option:

- `'user'` (default) — private to the current user.
- `'org'` — shared across the user's organization.
- `'all'` — list/get only; returns both user-scoped and org-scoped items.

```html
<script>
  // Private to me
  await toolData.set('notes', 'note-1', { title: 'My Note' });

  // Shared with my org
  await toolData.set('notes', 'team-note', { title: 'Team Note' }, { scope: 'org' });

  // List my notes (default)
  const mine = await toolData.list('notes');

  // List both mine and the org's
  const everything = await toolData.list('notes', { scope: 'all' });
</script>
```

## API keys and secrets {#secrets}

When a tool needs an API key (for GitHub, OpenAI, a weather service, etc.), the agent will tell you what's needed and where to get it. You add the key through the Settings UI in the agent sidebar.

Keys are encrypted and stored securely. Each key is restricted to specific domains — a GitHub token can only be sent to `api.github.com`, never anywhere else.

### Secrets in tools {#secrets-in-tools}

Tools reference secrets in `toolFetch()` calls using the `${keys.NAME}` template pattern. The proxy substitutes the encrypted value server-side; the actual key never reaches the browser.

```html
<script>
  const res = await toolFetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ${keys.GITHUB_TOKEN}',
    },
  });
</script>
```

When a tool needs a one-off key, the agent can register an ad-hoc secret via `POST /_agent-native/secrets/adhoc` with a `urlAllowlist` that pins which domains the secret may be sent to. A request to any other host is rejected before the proxy fires. Combined with SSRF and private-network protections, this means a leaked tool can't exfiltrate secrets to an attacker-controlled URL.

## Sharing {#sharing}

Tools are **private by default** — only you can see and use a tool you create.

You can share tools with your team:

- **Org-visible** — everyone in your organization can use it.
- **Per-user sharing** — grant access to specific people as viewers, editors, or admins.

Shared tools have their own URLs, so you can link to them directly.

Under the hood, tools use the same ownable-resource model as the rest of the framework — `ownableColumns()` on the `tools` table and a standard `createSharesTable()` for grants. That means tools plug into the same share dialog, access checks, and audit surfaces as documents, decks, dashboards, and any other shareable resource. See [Security](/docs/security) for the full access model.

## Security {#security}

Tools run in a secure sandbox:

- **Isolated** — tools can't access your app's cookies, session, or page content.
- **API keys stay server-side** — secrets are injected by the server, never exposed to the browser.
- **Domain-restricted secrets** — each API key can only be sent to its approved domains.
- **Private network protection** — tools can't reach internal/private network addresses.
- **Authentication required** — only logged-in users can use tools.

## Tool API reference {#api-reference}

Every tool runs inside a sandboxed iframe with the following helpers injected on `window`. They are the complete surface area — anything else a tool needs has to go through one of these.

| Helper                                      | Purpose                | Example                                       |
| ------------------------------------------- | ---------------------- | --------------------------------------------- |
| `toolData.set(collection, id, data, opts?)` | Persist data per-tool  | `toolData.set('notes', id, { text: '...' })`  |
| `toolData.list(collection, opts?)`          | List persisted items   | `toolData.list('notes', { scope: 'all' })`    |
| `toolData.get(collection, id, opts?)`       | Get a single item      | `toolData.get('notes', 'note-1')`             |
| `toolData.remove(collection, id, opts?)`    | Delete persisted item  | `toolData.remove('notes', 'note-1')`          |
| `appAction(name, params)`                   | Call any app action    | `appAction('list-emails', { view: 'inbox' })` |
| `dbQuery(sql, args)`                        | Read from SQL          | `dbQuery('SELECT * FROM tools')`              |
| `dbExec(sql, args)`                         | Write to SQL           | `dbExec('INSERT INTO ...')`                   |
| `appFetch(path, options)`                   | Call any app endpoint  | `appFetch('/api/settings')`                   |
| `toolFetch(url, options)`                   | External API via proxy | `toolFetch('https://api.github.com/...')`     |

`appAction` is the preferred way to trigger app behavior — it routes through the same actions the agent and the frontend use, so authorization and access scoping happen automatically. Drop down to `dbQuery`/`dbExec` only when there's no action that fits.

### Routes {#routes}

The framework mounts the following endpoints under `/_agent-native/tools/`. Tools themselves rarely call these directly — they're useful when integrating tools with external scripts or custom UI.

| Method | Path                              | Purpose                                      |
| ------ | --------------------------------- | -------------------------------------------- |
| GET    | `/_agent-native/tools`            | List tools (filtered by ownership + sharing) |
| POST   | `/_agent-native/tools`            | Create a tool                                |
| GET    | `/_agent-native/tools/:id`        | Get a single tool                            |
| PUT    | `/_agent-native/tools/:id`        | Update (supports `patches` for diffing)      |
| DELETE | `/_agent-native/tools/:id`        | Delete a tool                                |
| GET    | `/_agent-native/tools/:id/render` | Render the iframe HTML                       |
| POST   | `/_agent-native/tools/proxy`      | Authenticated proxy with secret injection    |

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
