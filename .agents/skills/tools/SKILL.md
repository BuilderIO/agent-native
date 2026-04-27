---
name: tools
description: >-
  Creating, editing, and managing mini-app tools that run as sandboxed Alpine.js
  iframes. Use when a user asks for a dashboard, widget, calculator, or any
  interactive mini-app that calls external APIs.
---

# Tools

## What tools are

Tools are mini Alpine.js apps that run inside sandboxed iframes. They can call external APIs via `toolFetch()`, which routes through a server-side proxy that injects secret values. Tools share the main app's Tailwind v4 theme automatically.

## Creating a tool

Call the `create-tool` action:

```bash
pnpm action create-tool \
  --name "GitHub PR Dashboard" \
  --description "Shows open PRs for the repo" \
  --content '<div x-data="{ prs: [], loading: true }" x-init="toolFetch('"'"'https://api.github.com/repos/OWNER/REPO/pulls'"'"', { headers: { '"'"'Authorization'"'"': '"'"'Bearer ${keys.GITHUB_TOKEN}'"'"' }}).then(r => r.json()).then(d => { prs = d; loading = false })"><template x-if="loading"><p>Loading...</p></template><div class="space-y-2"><template x-for="pr in prs" :key="pr.id"><a :href="pr.html_url" target="_blank" class="block rounded-lg border p-3 hover:bg-accent"><p class="font-medium" x-text="pr.title"></p><p class="text-sm text-muted-foreground" x-text="'"'"'#'"'"' + pr.number + '"'"' by '"'"' + pr.user.login"></p></a></template></div></div>'
```

Or via the HTTP API:

```
POST /_agent-native/tools
{ "name": "GitHub PR Dashboard", "description": "Shows open PRs", "content": "<div ...>...</div>" }
```

The action accepts:

| Field         | Type     | Required | Purpose                  |
| ------------- | -------- | -------- | ------------------------ |
| `name`        | `string` | yes      | Display name of the tool |
| `description` | `string` | no       | Short summary            |
| `content`     | `string` | yes      | Alpine.js HTML body      |

## Editing a tool

Use the `update-tool` action. Prefer `patches` for surgical edits instead of regenerating the full HTML:

```
PUT /_agent-native/tools/:id
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
{ "content": "full new HTML" }
```

## Alpine.js patterns

Tool HTML uses Alpine.js directives for reactivity. No build step, no imports.

| Directive       | Purpose                       | Example                                    |
| --------------- | ----------------------------- | ------------------------------------------ |
| `x-data`        | Reactive state object         | `x-data="{ count: 0, items: [] }"`        |
| `x-init`        | Run on mount (fetch data)     | `x-init="fetchData()"`                     |
| `x-show`        | Toggle visibility             | `x-show="isOpen"`                          |
| `x-if`          | Conditional render (template) | `<template x-if="loaded">...</template>`   |
| `x-for`         | Loop                          | `<template x-for="item in items">...</template>` |
| `x-text`        | Set text content              | `x-text="item.name"`                       |
| `x-html`        | Set inner HTML                | `x-html="item.richContent"`                |
| `x-on:click`    | Event handler                 | `x-on:click="count++"`                     |
| `x-model`       | Two-way binding               | `x-model="searchQuery"`                    |
| `x-bind:class`  | Dynamic classes               | `x-bind:class="{ 'font-bold': active }"`   |

Always wrap `x-if` and `x-for` in a `<template>` tag.

## Accessing app data

Tools can call the host app's actions and API endpoints directly. The iframe shares the session cookie, so authentication is automatic.

### `appAction(name, params)` — Call app actions

Call any action defined in the app's `actions/` directory. Actions are auto-mounted at `/_agent-native/actions/:name`.

```html
<div x-data="{ emails: [], loading: true }" x-init="
  appAction('list-emails', { view: 'inbox', limit: 10 })
    .then(d => { emails = d.emails || d; loading = false })
    .catch(e => { console.error(e); loading = false })
">
  <h2 class='text-lg font-semibold mb-4'>My Inbox</h2>
  <template x-for='email in emails' :key='email.id'>
    <div class='rounded-lg border p-3 mb-2'>
      <p class='font-medium text-sm' x-text='email.subject'></p>
      <p class='text-xs text-muted-foreground' x-text='email.from?.name || email.from?.email'></p>
    </div>
  </template>
</div>
```

### `appFetch(path, options)` — Call any app endpoint

General-purpose fetch to any app endpoint (e.g. `/api/emails`, `/_agent-native/application-state/navigation`). Automatically adds credentials and JSON content type.

```javascript
// Read application state
const nav = await appFetch('/_agent-native/application-state/navigation');

// Call a custom API route
const data = await appFetch('/api/custom-endpoint', {
  method: 'POST',
  body: JSON.stringify({ key: 'value' }),
});
```

### `dbQuery(sql)` — Read from the app's database

Run a read-only SELECT query against the app's SQL database. Results are auto-scoped to the current user/org.

```html
<div x-data="{ rows: [] }" x-init="
  dbQuery('SELECT id, name FROM tools ORDER BY created_at DESC LIMIT 10')
    .then(d => rows = d.rows || d)
">
  <template x-for="row in rows" :key="row.id">
    <div class="border-b p-2 text-sm" x-text="row.name"></div>
  </template>
</div>
```

### `dbExec(sql)` — Write to the app's database

Run an INSERT, UPDATE, or DELETE statement. Writes are auto-scoped to the current user/org, and `owner_email` / `org_id` are auto-injected on INSERT.

```javascript
// Insert a new record
await dbExec("INSERT INTO notes (id, title, body) VALUES ('abc', 'My Note', 'Hello world')");

// Update an existing record
await dbExec("UPDATE notes SET title = 'Updated Title' WHERE id = 'abc'");
```

### All helpers summary

| Helper | Use for | Example |
|--------|---------|---------|
| `appAction(name, params)` | Call app actions (CRUD, queries) | `appAction('list-emails', { view: 'inbox' })` |
| `appFetch(path, options)` | Call any app endpoint | `appFetch('/api/settings')` |
| `dbQuery(sql)` | Read from the app's SQL database | `dbQuery('SELECT * FROM notes LIMIT 10')` |
| `dbExec(sql)` | Write to the app's SQL database | `dbExec("INSERT INTO notes ...")` |
| `toolFetch(url, options)` | Call external APIs via proxy | `toolFetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ${keys.GITHUB_TOKEN}' } })` |

## Using `toolFetch()` for API calls

`toolFetch()` is a drop-in replacement for `fetch()` that proxies requests through the server. The server injects secret values before the request leaves.

```javascript
// Basic GET
const res = await toolFetch('https://api.example.com/data');
const data = await res.json();

// With secret injection
const res = await toolFetch('https://api.openai.com/v1/models', {
  headers: {
    'Authorization': 'Bearer ${keys.OPENAI_API_KEY}'
  }
});

// POST with body
const res = await toolFetch('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'New Item' })
});
```

**Important:** Use single quotes around strings containing `${keys.NAME}` to prevent JavaScript template literal evaluation. The substitution happens server-side, not in the browser.

## Tailwind classes

Tools inherit the main app's Tailwind v4 theme. Use the same utility classes:

- **Colors:** `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`, `bg-destructive`
- **Layout:** `flex`, `grid`, `space-y-2`, `gap-4`, `p-4`, `m-2`
- **Typography:** `text-sm`, `text-lg`, `font-medium`, `font-bold`
- **Borders:** `border`, `rounded-lg`, `rounded-md`, `rounded-sm`
- **Dark mode:** automatic via `.dark` class on the html element

## Managing secrets

Tools reference secrets via `${keys.NAME}` inside `toolFetch()` calls. Create secrets via:

```
POST /_agent-native/secrets/adhoc
{ "name": "GITHUB_TOKEN", "value": "ghp_xxxx", "description": "GitHub PAT", "urlAllowlist": ["https://api.github.com"] }
```

Or the user can add them in the settings UI. If a tool needs an API key that isn't configured yet, tell the user what key is needed and where to get it.

See the `secrets` skill for the full secrets API.

## Sharing

Use the framework sharing actions:

```bash
# Make a tool visible to the org
pnpm action set-resource-visibility --resourceType=tool --resourceId=TOOL_ID --visibility=org

# Share with a specific user
pnpm action share-resource --resourceType=tool --resourceId=TOOL_ID --principalType=user --principalId=user@example.com --role=editor

# List current shares
pnpm action list-resource-shares --resourceType=tool --resourceId=TOOL_ID
```

See the `sharing` skill for visibility levels and roles.

## Navigation

```bash
# Navigate to the tools list
pnpm action navigate --view=tools

# Navigate to a specific tool
pnpm action navigate --view=tools --toolId=TOOL_ID
```

## Example tools

### API Status Dashboard

Checks the health of multiple endpoints and shows green/red status:

```html
<div x-data="{
  endpoints: [
    { name: 'API', url: 'https://api.example.com/health' },
    { name: 'Auth', url: 'https://auth.example.com/health' },
    { name: 'CDN', url: 'https://cdn.example.com/health' }
  ],
  results: [],
  loading: true
}" x-init="
  Promise.all(endpoints.map(ep =>
    toolFetch(ep.url).then(r => ({ ...ep, ok: r.ok })).catch(() => ({ ...ep, ok: false }))
  )).then(r => { results = r; loading = false })
">
  <h2 class="text-lg font-bold mb-4">Service Status</h2>
  <template x-if="loading"><p class="text-muted-foreground">Checking...</p></template>
  <div class="space-y-2">
    <template x-for="r in results" :key="r.name">
      <div class="flex items-center justify-between rounded-lg border p-3">
        <span class="font-medium" x-text="r.name"></span>
        <span x-bind:class="r.ok ? 'text-green-600' : 'text-red-600'" x-text="r.ok ? 'Healthy' : 'Down'"></span>
      </div>
    </template>
  </div>
</div>
```

### Weather Widget

Fetches current weather for a city:

```html
<div x-data="{ city: 'San Francisco', weather: null, loading: false }" x-init="
  loading = true;
  toolFetch('https://api.weatherapi.com/v1/current.json?q=' + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}')
    .then(r => r.json()).then(d => { weather = d; loading = false })
">
  <div class="space-y-4">
    <div class="flex gap-2">
      <input type="text" x-model="city" class="flex-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="City name" />
      <button x-on:click="loading = true; toolFetch('https://api.weatherapi.com/v1/current.json?q=' + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}').then(r => r.json()).then(d => { weather = d; loading = false })" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">Search</button>
    </div>
    <template x-if="loading"><p class="text-muted-foreground">Loading...</p></template>
    <template x-if="weather && !loading">
      <div class="rounded-lg border p-4">
        <p class="text-2xl font-bold" x-text="weather.current.temp_f + '°F'"></p>
        <p class="text-muted-foreground" x-text="weather.current.condition.text"></p>
        <p class="text-sm text-muted-foreground" x-text="weather.location.name + ', ' + weather.location.region"></p>
      </div>
    </template>
  </div>
</div>
```

### Quick Notes

Persistent notes using localStorage -- no API key needed:

```html
<div x-data="{
  notes: JSON.parse(localStorage.getItem('quick-notes') || '[]'),
  draft: '',
  save() {
    if (!this.draft.trim()) return;
    this.notes.unshift({ id: Date.now(), text: this.draft, date: new Date().toLocaleDateString() });
    this.draft = '';
    localStorage.setItem('quick-notes', JSON.stringify(this.notes));
  },
  remove(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    localStorage.setItem('quick-notes', JSON.stringify(this.notes));
  }
}">
  <div class="space-y-4">
    <div class="flex gap-2">
      <input type="text" x-model="draft" x-on:keydown.enter="save()" class="flex-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="Add a note..." />
      <button x-on:click="save()" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">Add</button>
    </div>
    <div class="space-y-2">
      <template x-for="note in notes" :key="note.id">
        <div class="flex items-start justify-between rounded-lg border p-3">
          <div>
            <p class="text-sm" x-text="note.text"></p>
            <p class="text-xs text-muted-foreground" x-text="note.date"></p>
          </div>
          <button x-on:click="remove(note.id)" class="text-muted-foreground hover:text-destructive text-sm cursor-pointer">Remove</button>
        </div>
      </template>
      <template x-if="notes.length === 0">
        <p class="text-sm text-muted-foreground">No notes yet.</p>
      </template>
    </div>
  </div>
</div>
```

## Guidelines

- **Keep tools focused.** One tool, one job. A "GitHub PR Dashboard" should show PRs, not also manage issues.
- **Handle loading and error states.** Always show a loading indicator during fetch and handle failures gracefully.
- **Use the right fetch helper.** `appAction()` for app actions, `appFetch()` for app endpoints, `toolFetch()` for external APIs. Never use raw `fetch()` -- secrets won't be injected and CORS will block external APIs.
- **Single quotes around `${keys.*}`** to prevent browser-side template literal evaluation.
- **Prefer patches over full rewrites** when editing existing tools. Smaller diffs are less error-prone.

## Related skills

- `secrets` -- creating and managing API keys for `${keys.NAME}` substitution.
- `sharing` -- visibility and access control for tools.
- `actions` -- the `create-tool` and `update-tool` actions that back tool CRUD.
- `frontend-design` -- design guidance when styling tool HTML.
