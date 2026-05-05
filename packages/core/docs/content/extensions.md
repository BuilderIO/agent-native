---
title: "Extensions"
description: "Lightweight interactive apps — dashboards, widgets, calculators, monitors — that the agent creates for you instantly, without changing your app's code."
---

# Extensions

Extensions are lightweight interactive apps that live inside your agent-native app. Think dashboards, widgets, calculators, API monitors, data lookups — anything you'd otherwise build by hand.

The key difference from the rest of your app: **extensions don't require code changes.** The agent creates and updates them at runtime, they're stored in the database, and they're ready to use immediately. No deploys, no builds, no pull requests.

## Extensions vs. LLM tools {#extensions-vs-llm-tools}

The word "tools" gets used in two different ways in this codebase, so we use distinct names to keep them clear:

- **Extensions** (this primitive) — sandboxed Alpine.js mini-apps, rendered inside an iframe. They have a UI the user can interact with, persistent storage, and the ability to call your app's actions and external APIs. The rest of this page is about extensions.
- **LLM tools / agent tools** — the function calls the agent makes during a turn (the things you define with `defineAction`, MCP tools, or that show up in `tools/list` / `tools/call`). These are not user-facing apps; they're the function-call surface area the model sees. When you read `tool: { description, parameters }` on an `ActionEntry`, "agent's tools", or "tool calls" elsewhere in these docs, that's the LLM-tools sense.

Both senses can show up on the same page (extensions can _call_ agent actions, which the agent also sees as tools), so when in doubt: if it has a UI inside an iframe, it's an extension; if it's a function-call name on a model turn, it's an LLM tool.

## Extensions vs. editing the app {#extensions-vs-code}

Your agent-native app has a full codebase — React components, routes, actions, styles. When the agent edits that code, it's changing the app itself. That's powerful, but it requires a build step and a deploy.

Extensions are different:

|                       | App code                                | Extensions                                         |
| --------------------- | --------------------------------------- | -------------------------------------------------- |
| **Created by**        | Developer or agent editing source files | Agent or user, instantly from chat                 |
| **Stored in**         | Git repository                          | Database                                           |
| **Requires a build**  | Yes                                     | No                                                 |
| **Requires a deploy** | Yes                                     | No                                                 |
| **Scope**             | Part of the app for all users           | Private by default, shareable                      |
| **Best for**          | Core app features                       | Personal dashboards, utilities, quick integrations |

Use app code for features that are core to the product. Use extensions for everything else — one-off utilities, personal dashboards, quick integrations, monitors, and things you want to spin up in seconds.

## When to build an extension vs. a template feature {#when-to-build}

A quick decision rubric:

**Build an extension when:**

- It's for one user or one team, not the whole product.
- It's a quick utility, dashboard, or widget you want now, not next sprint.
- No new database schema is needed (or per-extension key-value storage is enough).
- You want to ship it inside a single chat turn, no deploy.

**Add a template feature when:**

- Every user of the template should get it.
- It needs new SQL tables, migrations, or shared schema changes.
- The UI is complex enough to warrant React components, routes, and proper testing.
- It's part of the product surface — something you'd advertise on a landing page.

When in doubt, start as an extension. Promoting an extension to a template feature later is straightforward; rolling back a half-shipped product feature is not.

## Creating an extension {#creating}

### From the sidebar

Click the **+** button in the Extensions section of the sidebar. Describe what you want in plain language — "a dashboard that shows my open GitHub PRs" — and the agent builds it for you.

### From chat

Just ask: "Create an extension that monitors our API health" or "Make me a calculator for shipping costs." The agent handles the rest.

### Updating an extension

Ask the agent: "Update my PR dashboard to also show draft PRs" or "Add a dark mode toggle to the weather widget." The agent makes surgical edits without regenerating the whole thing.

## What extensions can do {#capabilities}

Extensions are fully capable despite being lightweight. They can:

- **Call external APIs** — GitHub, Stripe, weather services, any REST API. Requests go through a secure server-side proxy that keeps your API keys safe.
- **Call your app's actions** — anything your agent can do, an extension can trigger.
- **Query your app's database** — read and write data directly.
- **Store their own data** — each extension has built-in persistent storage, no setup required. Save notes, preferences, cached results — whatever the extension needs.
- **Call any endpoint in your app** — hit custom API routes, webhooks, or internal services.

All of this works out of the box. No configuration, no new files, no schema changes.

## Layout defaults {#layout}

Extensions render with modest canvas padding by default so simple widgets and dashboards do not hug the iframe edge. For full-bleed experiences such as maps, canvases, or custom editors, set `data-tool-layout="full-bleed"` or `data-tool-padding="none"` on the outermost element. (The `data-tool-*` attribute names are kept for backward compatibility — `data-extension-layout` / `data-extension-padding` aliases are also accepted.)

## Persistent storage {#persistent-storage}

Every extension has access to a built-in key-value store via the `extensionData` helper (also exposed as `toolData` for backward compatibility). Data is automatically scoped per extension and per user — your data stays yours.

When you ask the agent to "add persistence" or "remember state" in an extension, it uses this built-in storage. No database tables to create, no migrations to run.

### Scopes

All `extensionData` methods accept an optional `{ scope }` option:

- `'user'` (default) — private to the current user.
- `'org'` — shared across the user's organization.
- `'all'` — list/get only; returns both user-scoped and org-scoped items.

```html
<script>
  // Private to me
  await extensionData.set('notes', 'note-1', { title: 'My Note' });

  // Shared with my org
  await extensionData.set('notes', 'team-note', { title: 'Team Note' }, { scope: 'org' });

  // List my notes (default)
  const mine = await extensionData.list('notes');

  // List both mine and the org's
  const everything = await extensionData.list('notes', { scope: 'all' });
</script>
```

> **Legacy alias.** The original helper was named `toolData`; both `toolData` and `extensionData` resolve to the same store and accept identical arguments. New extensions should use `extensionData`; existing code using `toolData` keeps working.

## API keys and secrets {#secrets}

When an extension needs an API key (for GitHub, OpenAI, a weather service, etc.), the agent will tell you what's needed and where to get it. You add the key through the Settings UI in the agent sidebar.

Keys are encrypted and stored securely. Each key is restricted to specific domains — a GitHub token can only be sent to `api.github.com`, never anywhere else.

### Secrets in extensions {#secrets-in-extensions}

Extensions reference secrets in `extensionFetch()` calls (legacy alias: `toolFetch()`) using the `${keys.NAME}` template pattern. The proxy substitutes the encrypted value server-side; the actual key never reaches the browser.

```html
<script>
  const res = await extensionFetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ${keys.GITHUB_TOKEN}',
    },
  });
</script>
```

When an extension needs a one-off key, the agent can register an ad-hoc secret via `POST /_agent-native/secrets/adhoc` with a `urlAllowlist` that pins which domains the secret may be sent to. A request to any other host is rejected before the proxy fires. Combined with SSRF and private-network protections, this means a leaked extension can't exfiltrate secrets to an attacker-controlled URL.

## Sharing {#sharing}

Extensions are **private by default** — only you can see and use an extension you create.

You can share extensions with your team:

- **Org-visible** — everyone in your organization can use it.
- **Per-user sharing** — grant access to specific people as viewers, editors, or admins.

Shared extensions have their own URLs, so you can link to them directly.

Under the hood, extensions use the same ownable-resource model as the rest of the framework — `ownableColumns()` on the `extensions` Drizzle export (physical SQL table: `tools`) and a standard `createSharesTable()` for grants (physical table: `tool_shares`, exported as `extensionShares`). That means extensions plug into the same share dialog, access checks, and audit surfaces as documents, decks, dashboards, and any other shareable resource. See [Security](/docs/security) for the full access model.

## Security {#security}

Extensions run in a secure sandbox:

- **Isolated** — extensions can't access your app's cookies, session, or page content.
- **API keys stay server-side** — secrets are injected by the server, never exposed to the browser.
- **Domain-restricted secrets** — each API key can only be sent to its approved domains.
- **Private network protection** — extensions can't reach internal/private network addresses.
- **Authentication required** — only logged-in users can use extensions.

## Extension API reference {#api-reference}

Every extension runs inside a sandboxed iframe with the following helpers injected on `window`. They are the complete surface area — anything else an extension needs has to go through one of these.

| Helper                                           | Purpose                    | Example                                           |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------- |
| `extensionData.set(collection, id, data, opts?)` | Persist data per-extension | `extensionData.set('notes', id, { text: '...' })` |
| `extensionData.list(collection, opts?)`          | List persisted items       | `extensionData.list('notes', { scope: 'all' })`   |
| `extensionData.get(collection, id, opts?)`       | Get a single item          | `extensionData.get('notes', 'note-1')`            |
| `extensionData.remove(collection, id, opts?)`    | Delete persisted item      | `extensionData.remove('notes', 'note-1')`         |
| `appAction(name, params)`                        | Call any app action        | `appAction('list-emails', { view: 'inbox' })`     |
| `dbQuery(sql, args)`                             | Read from SQL              | `dbQuery('SELECT * FROM tools')`                  |
| `dbExec(sql, args)`                              | Write to SQL               | `dbExec('INSERT INTO ...')`                       |
| `appFetch(path, options)`                        | Call any app endpoint      | `appFetch('/api/settings')`                       |
| `extensionFetch(url, options)`                   | External API via proxy     | `extensionFetch('https://api.github.com/...')`    |

`appAction` is the preferred way to trigger app behavior — it routes through the same actions the agent and the frontend use, so authorization and access scoping happen automatically. Drop down to `dbQuery`/`dbExec` only when there's no action that fits.

> **Legacy aliases and physical names.** `toolData` and `toolFetch` are kept as aliases for `extensionData` and `extensionFetch`. The physical SQL tables (`tools`, `tool_data`, `tool_shares`) and the `tool_id` foreign-key column also keep their original names — only the public Drizzle/TypeScript exports (`extensions`, `extensionData`, `extensionShares`) and the iframe globals were renamed.

### Routes {#routes}

The framework mounts the following endpoints under `/_agent-native/extensions/`. Extensions themselves rarely call these directly — they're useful when integrating extensions with external scripts or custom UI. The legacy `/_agent-native/tools/*` paths still resolve and are kept for backward compatibility.

| Method | Path                                   | Purpose                                           |
| ------ | -------------------------------------- | ------------------------------------------------- |
| GET    | `/_agent-native/extensions`            | List extensions (filtered by ownership + sharing) |
| POST   | `/_agent-native/extensions`            | Create an extension                               |
| GET    | `/_agent-native/extensions/:id`        | Get a single extension                            |
| PUT    | `/_agent-native/extensions/:id`        | Update (supports `patches` for diffing)           |
| DELETE | `/_agent-native/extensions/:id`        | Delete an extension                               |
| GET    | `/_agent-native/extensions/:id/render` | Render the iframe HTML                            |
| POST   | `/_agent-native/extensions/proxy`      | Authenticated proxy with secret injection         |

### Agent actions {#agent-actions}

The agent uses three actions to manage extensions on your behalf:

| Action             | What it does                                                              |
| ------------------ | ------------------------------------------------------------------------- |
| `create-extension` | Create a new extension (name, description, Alpine.js HTML content)        |
| `update-extension` | Update an extension — use `patches` array for find/replace diffs          |
| `navigate`         | Navigate to `--view=extensions` or `--view=extensions --extensionId=<id>` |

> **Legacy action names.** `create-tool` and `update-tool` continue to work as aliases for `create-extension` and `update-extension`. New code should use the `*-extension` names.

## Examples {#examples}

Here are some things people build as extensions:

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

- [**Actions**](/docs/actions) — the operations that extensions (and the agent) can call
- [**Workspace**](/docs/workspace) — the broader workspace system extensions live alongside
- [**Security**](/docs/security) — the framework's data scoping and access control
