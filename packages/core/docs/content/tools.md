---
title: "Tools"
description: "Mini sandboxed Alpine.js apps that run inside iframes with a backend proxy for API calls — build dashboards, widgets, calculators, and interactive utilities without touching your app's codebase."
---

# Tools

Tools are mini interactive apps that run inside sandboxed iframes. They use [Alpine.js](https://alpinejs.dev/) for reactivity and `toolFetch()` to call external APIs through a server-side proxy that injects encrypted secrets. Tools inherit the main app's Tailwind v4 theme, so they look native.

Think of them as lightweight dashboards, widgets, or utilities that the agent (or the user) can spin up without modifying the app's source code. A GitHub PR dashboard, a weather widget, a Stripe payment lookup, an API status monitor — anything that fetches data from an API and displays it.

## Why tools? {#why-tools}

Agent-native apps already have actions and UI components. Tools fill a different niche:

| Actions                        | Components                | Tools                                 |
| ------------------------------ | ------------------------- | ------------------------------------- |
| Server-side, no UI             | Full React, needs a build | Alpine.js in an iframe, no build step |
| Agent calls them as functions  | Part of the app codebase  | Created at runtime, stored in the DB  |
| Return data                    | Render data               | Fetch + render data, self-contained   |
| Require code changes to create | Require code changes      | Agent creates them in chat            |

Tools are the fastest path from "I need a widget that shows X" to a working, styled, interactive panel — especially when the agent creates it for you.

## Creating a tool {#creating}

### From the sidebar

Click the **+** button in the Tools section of the sidebar. Give it a name and the agent will generate the HTML for you.

### From chat

Ask the agent: "Create a tool that shows my open GitHub PRs." The agent calls the `create-tool` action and wires up the HTML, `toolFetch()` calls, and any secrets it needs.

### Via the API

```
POST /_agent-native/tools
Content-Type: application/json

{
  "name": "GitHub PR Dashboard",
  "description": "Shows open pull requests for the repo",
  "content": "<div x-data=\"{ prs: [] }\" x-init=\"toolFetch('https://api.github.com/repos/OWNER/REPO/pulls', { headers: { 'Authorization': 'Bearer ${keys.GITHUB_TOKEN}' }}).then(r => r.json()).then(d => prs = d)\">...</div>"
}
```

The `create-tool` action accepts:

| Field         | Type     | Required | Description              |
| ------------- | -------- | -------- | ------------------------ |
| `name`        | `string` | yes      | Display name of the tool |
| `description` | `string` | no       | Short summary            |
| `content`     | `string` | yes      | Alpine.js HTML body      |

## Editing a tool {#editing}

Use the `update-tool` action. **Prefer patches for surgical edits** instead of regenerating the full HTML:

```
PUT /_agent-native/tools/:id
Content-Type: application/json

{
  "patches": [
    { "find": "old HTML fragment", "replace": "new HTML fragment" }
  ]
}
```

Each patch does a string find-and-replace on the current content. Use this to change a single element, fix a URL, or update a class without rewriting everything.

To replace the full content instead:

```
PUT /_agent-native/tools/:id
Content-Type: application/json

{ "content": "full new HTML" }
```

## How `toolFetch()` works {#toolfetch}

`toolFetch()` is a drop-in replacement for `fetch()` inside tool HTML. Instead of calling the external API directly (which would be blocked by the iframe's CSP), it sends the request through `POST /_agent-native/tools/proxy` on the server. The server:

1. Resolves `${keys.NAME}` placeholders in headers and body with the actual secret values from the database.
2. Validates the target URL against SSRF protections (blocks private IPs, metadata endpoints).
3. Checks the URL against each secret's `urlAllowlist` — a key configured for `api.github.com` cannot be used to call `api.stripe.com`.
4. Forwards the request and returns the response to the iframe.

```javascript
// Basic GET
const res = await toolFetch("https://api.example.com/data");
const data = await res.json();

// With secret injection — note the single quotes around ${keys.*}
const res = await toolFetch("https://api.openai.com/v1/models", {
  headers: {
    Authorization: "Bearer ${keys.OPENAI_API_KEY}",
  },
});

// POST with body
const res = await toolFetch("https://api.example.com/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "New Item" }),
});
```

**Use single quotes** around strings containing `${keys.NAME}` to prevent JavaScript template literal evaluation in the browser. The substitution happens server-side, not client-side.

## Managing secrets {#secrets}

Tools reference secrets via the `${keys.NAME}` pattern inside `toolFetch()` calls. Secrets are ad-hoc encrypted key-value pairs stored in the database.

### Creating a secret

```
POST /_agent-native/secrets/adhoc
Content-Type: application/json

{
  "name": "GITHUB_TOKEN",
  "value": "ghp_xxxx",
  "description": "GitHub personal access token",
  "urlAllowlist": ["https://api.github.com"]
}
```

Or the user can add secrets through the Settings UI in the agent sidebar.

### URL allowlists

Each secret can specify a `urlAllowlist` — an array of URL prefixes that the secret is allowed to be sent to. The proxy checks this before injecting the secret. A `GITHUB_TOKEN` with `urlAllowlist: ["https://api.github.com"]` cannot leak to any other domain.

If a tool needs an API key that is not configured yet, the agent tells the user what key is needed and where to get it (and can register an onboarding step via the `secrets` skill).

## Security model {#security}

Tools run in a defense-in-depth sandbox:

### Iframe sandbox

Tools render via `GET /_agent-native/tools/:id/render`, which returns a full HTML document loaded in an iframe with restrictive sandbox attributes. The iframe cannot access the parent page's DOM, cookies, or JavaScript context.

### Content Security Policy

The rendered HTML includes a strict CSP:

- `connect-src 'self'` — all network requests must go through the same origin (i.e., `toolFetch()` → the proxy). Direct external fetches are blocked.
- `script-src` allows only Alpine.js (loaded from CDN) and inline scripts for the tool's own logic.

### SSRF protection on the proxy

The `POST /_agent-native/tools/proxy` endpoint blocks requests to:

- Private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, ::1)
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
- Non-HTTP(S) protocols

### Session authentication

The proxy requires a valid session cookie. Unauthenticated requests are rejected — tools cannot be used to exfiltrate data without a logged-in user.

## Tailwind theme integration {#tailwind}

Tools automatically inherit the main app's Tailwind v4 theme variables. Use the same utility classes you use in the app:

| Category   | Classes                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| Colors     | `bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground` |
| Layout     | `flex`, `grid`, `space-y-2`, `gap-4`, `p-4`                               |
| Typography | `text-sm`, `text-lg`, `font-medium`, `font-bold`                          |
| Borders    | `border`, `rounded-lg`, `rounded-md`                                      |
| Dark mode  | Automatic via `.dark` class on the html element                           |

## Sharing {#sharing}

Tools use the framework's standard [sharing](/docs/security) model — the same system used for dashboards, forms, and other ownable resources.

- **Private by default** — only the creator can see and edit a new tool.
- **Org-visible** — set visibility to `org` so everyone in the organization can use it.
- **Per-user sharing** — grant `viewer`, `editor`, or `admin` roles to specific users.

```bash
# Make a tool visible to the org
pnpm action set-resource-visibility --resourceType=tool --resourceId=TOOL_ID --visibility=org

# Share with a specific user
pnpm action share-resource --resourceType=tool --resourceId=TOOL_ID --principalType=user --principalId=user@example.com --role=editor
```

## API routes {#api-routes}

All tools routes are auto-mounted by the framework under `/_agent-native/tools/`:

| Method | Path                              | Description                                        |
| ------ | --------------------------------- | -------------------------------------------------- |
| GET    | `/_agent-native/tools`            | List tools (filtered by ownership + sharing)       |
| POST   | `/_agent-native/tools`            | Create a new tool                                  |
| GET    | `/_agent-native/tools/:id`        | Get a single tool                                  |
| PUT    | `/_agent-native/tools/:id`        | Update a tool (supports `patches` array)           |
| DELETE | `/_agent-native/tools/:id`        | Delete a tool                                      |
| GET    | `/_agent-native/tools/:id/render` | Render the tool HTML for iframe embedding          |
| POST   | `/_agent-native/tools/proxy`      | Authenticated proxy with `${keys.NAME}` resolution |

## Database schema {#schema}

Tools are stored in the `tools` table:

| Column        | Type      | Description                  |
| ------------- | --------- | ---------------------------- |
| `id`          | string    | Primary key (nanoid)         |
| `name`        | string    | Display name                 |
| `description` | string    | Optional short description   |
| `content`     | text      | The Alpine.js HTML body      |
| `icon`        | string    | Optional icon identifier     |
| `owner_email` | string    | Creator's email (ownable)    |
| `org_id`      | string    | Organization scope (ownable) |
| `visibility`  | string    | `private` / `org` / `public` |
| `created_at`  | timestamp | Creation time                |
| `updated_at`  | timestamp | Last modification time       |

The table uses `ownableColumns()` and has an associated `tool_shares` table created via `createSharesTable()` for per-user/per-org grants.

## Client components {#client-components}

The framework provides React components for rendering tools in the UI. All are exported from `@agent-native/core/client/tools`:

| Component             | Description                                    |
| --------------------- | ---------------------------------------------- |
| `ToolsSidebarSection` | Sidebar section listing tools with a + button  |
| `ToolViewer`          | Renders a tool in a sandboxed iframe           |
| `ToolEditor`          | Code editor for tool HTML                      |
| `ToolsListPage`       | Full-page list of all accessible tools         |
| `ToolViewerPage`      | Full-page tool viewer with edit/share controls |

## Alpine.js patterns {#alpine}

Tool HTML uses Alpine.js directives for reactivity. No build step, no imports — Alpine is loaded automatically in the sandboxed iframe.

| Directive    | Purpose                   | Example                                          |
| ------------ | ------------------------- | ------------------------------------------------ |
| `x-data`     | Reactive state object     | `x-data="{ count: 0, items: [] }"`               |
| `x-init`     | Run on mount (fetch data) | `x-init="fetchData()"`                           |
| `x-show`     | Toggle visibility         | `x-show="isOpen"`                                |
| `x-if`       | Conditional render        | `<template x-if="loaded">...</template>`         |
| `x-for`      | Loop                      | `<template x-for="item in items">...</template>` |
| `x-text`     | Set text content          | `x-text="item.name"`                             |
| `x-on:click` | Event handler             | `x-on:click="count++"`                           |
| `x-model`    | Two-way binding           | `x-model="searchQuery"`                          |

Always wrap `x-if` and `x-for` in a `<template>` tag.

## Example: API status dashboard {#example-status}

```html
<div
  x-data="{
  endpoints: [
    { name: 'API', url: 'https://api.example.com/health' },
    { name: 'Auth', url: 'https://auth.example.com/health' }
  ],
  results: [],
  loading: true
}"
  x-init="
  Promise.all(endpoints.map(ep =>
    toolFetch(ep.url)
      .then(r => ({ ...ep, ok: r.ok }))
      .catch(() => ({ ...ep, ok: false }))
  )).then(r => { results = r; loading = false })
"
>
  <h2 class="text-lg font-bold mb-4">Service Status</h2>
  <template x-if="loading">
    <p class="text-muted-foreground">Checking...</p>
  </template>
  <div class="space-y-2">
    <template x-for="r in results" :key="r.name">
      <div class="flex items-center justify-between rounded-lg border p-3">
        <span class="font-medium" x-text="r.name"></span>
        <span
          x-bind:class="r.ok ? 'text-green-600' : 'text-red-600'"
          x-text="r.ok ? 'Healthy' : 'Down'"
        ></span>
      </div>
    </template>
  </div>
</div>
```

## Example: weather widget {#example-weather}

```html
<div
  x-data="{ city: 'San Francisco', weather: null, loading: false }"
  x-init="
  loading = true;
  toolFetch('https://api.weatherapi.com/v1/current.json?q='
    + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}')
    .then(r => r.json())
    .then(d => { weather = d; loading = false })
"
>
  <div class="space-y-4">
    <div class="flex gap-2">
      <input
        type="text"
        x-model="city"
        class="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="City name"
      />
      <button
        x-on:click="
        loading = true;
        toolFetch('https://api.weatherapi.com/v1/current.json?q='
          + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}')
          .then(r => r.json())
          .then(d => { weather = d; loading = false })"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium
          text-primary-foreground cursor-pointer"
      >
        Search
      </button>
    </div>
    <template x-if="weather && !loading">
      <div class="rounded-lg border p-4">
        <p
          class="text-2xl font-bold"
          x-text="weather.current.temp_f + '°F'"
        ></p>
        <p
          class="text-muted-foreground"
          x-text="weather.current.condition.text"
        ></p>
        <p
          class="text-sm text-muted-foreground"
          x-text="weather.location.name + ', ' + weather.location.region"
        ></p>
      </div>
    </template>
  </div>
</div>
```

## Best practices {#best-practices}

- **Keep tools focused.** One tool, one job. A "GitHub PR Dashboard" shows PRs, not issues.
- **Handle loading and error states.** Always show a loading indicator during fetch and handle failures gracefully.
- **Use `toolFetch()` for all HTTP requests.** Never use raw `fetch()` — secrets will not be injected and CSP will block most external APIs.
- **Single quotes around `${keys.*}`** to prevent browser-side template literal evaluation.
- **Prefer patches over full rewrites** when editing existing tools — smaller diffs are less error-prone.

## What's next

- [**Actions**](/docs/actions) — how `create-tool` and `update-tool` are defined
- [**Workspace**](/docs/workspace) — the broader workspace system tools live alongside
- [**Security**](/docs/security) — the framework's data scoping and input validation rules
