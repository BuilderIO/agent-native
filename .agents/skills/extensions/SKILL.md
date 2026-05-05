---
name: extensions
description: >-
  Creating, editing, and managing extensions — sandboxed Alpine.js mini-apps
  that run inside iframes. Use when a user asks for a dashboard, widget,
  calculator, or any interactive mini-app that calls external APIs. Distinct
  from LLM "tools" (function calls) — see note below.
---

# Extensions

> **Terminology note.** This skill is about **extensions** — the framework's
> user-authored mini-app primitive (sandboxed Alpine.js HTML rendered in an
> iframe). It is NOT the same thing as **LLM "tools"**, which are the
> function-calling primitives the AI agent uses (actions, MCP tools, etc.).
> Other skills still talk about "the agent calls actions as tools" — that's
> the LLM concept and stays as-is. When this doc says "tool" without
> qualification, it means LLM tool. When it says "extension", it means the
> sandboxed mini-app.
>
> Historical naming: extensions were previously called "tools". The physical
> SQL table names (`tools`, `tool_data`, `tool_shares`) and a few legacy
> in-iframe globals (`toolFetch`, `toolData`) are kept for back-compat — see
> the relevant sections below.

## CRITICAL: What Extensions Are (and Are Not)

An Extension is a **self-contained Alpine.js HTML snippet** stored in the
SQL `tools` table (table name kept for back-compat; the Drizzle export is
`extensions`). It runs inside a sandboxed iframe with its own Tailwind CSS
and Alpine.js runtime.

**Extensions are NOT:**

- React components
- New source code files
- Database schema changes
- Action files in `actions/`
- Routes

**When a user asks to "make an extension", "create an extension", or "build
a ... extension" (or the older phrasings "make a tool" / "create a tool"):**

1. Write the Alpine.js HTML
2. Call `create-extension` with the HTML as `content`
3. That's it — no files to create, no schema changes, no actions

Extensions have full access to app data via helpers injected into the iframe:

- `appAction(name, params)` — call any app action
- `appFetch(path, options)` — call any app endpoint
- `dbQuery(sql, args)` — read from SQL
- `dbExec(sql, args)` — write to SQL
- `extensionFetch(url, options)` — call external APIs via proxy. Legacy
  alias: `toolFetch` — kept for back-compat with extension bodies authored
  before the rename; both names refer to the same helper.
- `extensionData.set/list/get/remove(collection, ...)` — persist custom data
  per-extension (supports `{ scope: 'user' | 'org' | 'all' }` option). Legacy
  alias: `toolData` — kept for back-compat; both names refer to the same
  store.

## Data Persistence is Built In

**Every extension has `extensionData` — a per-extension key-value store. NO
source code changes, NO Builder, NO new tables needed.**

When a user asks to "add persistence", "save data", "remember state", or
"store settings" in an extension, use `extensionData`. It handles table
creation, scoping, and upserts automatically. Data is organized into
collections per-extension:

```javascript
// Save a private item (default — only the current user can see it)
await extensionData.set('notes', 'note-1', { title: 'My Note', body: 'Hello' });

// Save an org-shared item (visible to everyone in the org)
await extensionData.set('notes', 'note-1', { title: 'Team Note', body: 'Hello' }, { scope: 'org' });

// List items by scope
const myNotes = await extensionData.list('notes');                        // user-scoped (default)
const orgNotes = await extensionData.list('notes', { scope: 'org' });    // org-scoped only
const allNotes = await extensionData.list('notes', { scope: 'all' });    // both user + org

// Get one item
const note = await extensionData.get('notes', 'note-1');                         // user-scoped
const orgNote = await extensionData.get('notes', 'note-1', { scope: 'org' });   // org-scoped

// Delete an item
await extensionData.remove('notes', 'note-1');                                   // user-scoped
await extensionData.remove('notes', 'note-1', { scope: 'org' });                // org-scoped
```

> The legacy global `toolData` is still injected and points at the same
> store — older extension bodies that reference `toolData.set(...)` continue
> to work without changes. Prefer `extensionData` in new code.

**Prefer `extensionData` over raw `dbExec` for extension-specific
persistence** — it handles everything automatically. Only use
`dbQuery`/`dbExec` when querying the app's existing tables.

## What extensions are

Extensions are mini Alpine.js apps that run inside sandboxed iframes. They
can call external APIs via `extensionFetch()`, which routes through a
server-side proxy that injects secret values. Extensions share the main
app's Tailwind v4 theme automatically.

## Creating an extension

Call the `create-extension` action:

```bash
pnpm action create-extension \
  --name "GitHub PR Dashboard" \
  --description "Shows open PRs for the repo" \
  --content '<div x-data="{ prs: [], loading: true }" x-init="extensionFetch('"'"'https://api.github.com/repos/OWNER/REPO/pulls'"'"', { headers: { '"'"'Authorization'"'"': '"'"'Bearer ${keys.GITHUB_TOKEN}'"'"' }}).then(r => r.json()).then(d => { prs = d; loading = false })"><template x-if="loading"><p>Loading...</p></template><div class="space-y-2"><template x-for="pr in prs" :key="pr.id"><a :href="pr.html_url" target="_blank" class="block rounded-lg border p-3 hover:bg-accent"><p class="font-medium" x-text="pr.title"></p><p class="text-sm text-muted-foreground" x-text="'"'"'#'"'"' + pr.number + '"'"' by '"'"' + pr.user.login"></p></a></template></div></div>'
```

Or via the HTTP API:

```
POST /_agent-native/extensions
{ "name": "GitHub PR Dashboard", "description": "Shows open PRs", "content": "<div ...>...</div>" }
```

The action accepts:

| Field         | Type     | Required | Purpose                       |
| ------------- | -------- | -------- | ----------------------------- |
| `name`        | `string` | yes      | Display name of the extension |
| `description` | `string` | no       | Short summary                 |
| `content`     | `string` | yes      | Alpine.js HTML body           |

## Editing an extension

Use the `update-extension` action. Prefer `patches` for surgical edits
instead of regenerating the full HTML:

```
PUT /_agent-native/extensions/:id
{
  "patches": [
    { "find": "old HTML fragment", "replace": "new HTML fragment" }
  ]
}
```

Each patch does a string find-and-replace on the current content. Use this
to change a single element, fix a URL, or update a class without rewriting
everything.

To replace the full content instead:

```
PUT /_agent-native/extensions/:id
{ "content": "full new HTML" }
```

## Alpine.js patterns

Extension HTML uses Alpine.js directives for reactivity. No build step, no
imports.

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

Extensions can call the host app's actions and API endpoints directly. The
iframe shares the session cookie, so authentication is automatic.

### `appAction(name, params)` — Call app actions

Call any action defined in the app's `actions/` directory. Actions are
auto-mounted at `/_agent-native/actions/:name`.

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

General-purpose fetch to any app endpoint (e.g. `/api/emails`,
`/_agent-native/application-state/navigation`). Automatically adds
credentials and JSON content type.

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

Run a read-only SELECT query against the app's SQL database. Results are
auto-scoped to the current user/org.

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

> The physical SQL table is still named `tools` (and `tool_data`,
> `tool_shares`) for back-compat. The Drizzle exports are `extensions`,
> `extensionData`, and `extensionShares` — use those when you query via the
> ORM. When writing raw SQL inside an extension (as above), use the
> physical names.

### `dbExec(sql)` — Write to the app's database

Run an INSERT, UPDATE, or DELETE statement. Writes are auto-scoped to the
current user/org, and `owner_email` / `org_id` are auto-injected on INSERT.

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
| `extensionFetch(url, options)` | Call external APIs via proxy (alias `toolFetch`) | `extensionFetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ${keys.GITHUB_TOKEN}' } })` |
| `extensionData.set(collection, id, data, opts?)` | Save an item to extension storage (alias `toolData.set`) | `extensionData.set('todos', 'todo-1', { title: 'Buy milk' })` |
| `extensionData.list(collection, opts?)` | List items in a collection | `extensionData.list('todos', { scope: 'all' })` |
| `extensionData.get(collection, id, opts?)` | Get a single item by id | `extensionData.get('todos', 'todo-1')` |
| `extensionData.remove(collection, id, opts?)` | Delete an item | `extensionData.remove('todos', 'todo-1')` |

## Persisting Custom Data

Extensions have a built-in key-value store via `extensionData` (legacy alias:
`toolData`). Each extension gets its own isolated storage, organized into
collections. Every method accepts an optional `{ scope }` option:

- `'user'` (default) — private to the current user
- `'org'` — visible to everyone in the user's org
- `'all'` (list/get only) — returns both user and org items

```javascript
// Save a private item (default scope: 'user')
await extensionData.set('todos', 'todo-1', { title: 'Buy milk', done: false });

// Save an org-shared item
await extensionData.set('todos', 'team-todo-1', { title: 'Ship v2', done: false }, { scope: 'org' });

// List user items (default)
const myTodos = await extensionData.list('todos');

// List org items
const orgTodos = await extensionData.list('todos', { scope: 'org' });

// List both user + org items
const allTodos = await extensionData.list('todos', { scope: 'all' });
// Returns: [{ id, toolId, collection, data (JSON string), ownerEmail, scope, orgId, createdAt, updatedAt }]
// (the row column is still named `toolId` for back-compat — it's the extension id)

// Parse the JSON data
const parsed = allTodos.map(t => ({ ...JSON.parse(t.data), id: t.id, scope: t.scope }));

// Get/delete with scope
const item = await extensionData.get('todos', 'team-todo-1', { scope: 'org' });
await extensionData.remove('todos', 'team-todo-1', { scope: 'org' });
```

Data is scoped per-extension. User-scoped items are private per-user;
org-scoped items are shared across the org. Any org member can read,
update, or delete org-scoped items. **Prefer `extensionData` over raw
`dbExec` for extension-specific persistence** — it handles table creation,
scoping, and upserts automatically.

## Using `extensionFetch()` for API calls

`extensionFetch()` (legacy alias `toolFetch()`) is a drop-in replacement for
`fetch()` that proxies requests through the server. The server injects
secret values before the request leaves.

```javascript
// Basic GET
const res = await extensionFetch('https://api.example.com/data');
const data = await res.json();

// With secret injection
const res = await extensionFetch('https://api.openai.com/v1/models', {
  headers: {
    'Authorization': 'Bearer ${keys.OPENAI_API_KEY}'
  }
});

// POST with body
const res = await extensionFetch('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'New Item' })
});
```

**Important:** Use single quotes around strings containing `${keys.NAME}`
to prevent JavaScript template literal evaluation. The substitution
happens server-side, not in the browser.

## Tailwind classes

Extensions inherit the main app's Tailwind v4 theme. Use the same utility
classes:

- **Colors:** `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`, `bg-destructive`
- **Layout:** `flex`, `grid`, `space-y-2`, `gap-4`, `p-4`, `m-2`
- **Typography:** `text-sm`, `text-lg`, `font-medium`, `font-bold`
- **Borders:** `border`, `rounded-lg`, `rounded-md`, `rounded-sm`
- **Dark mode:** automatic via `.dark` class on the html element

## Managing secrets

Extensions reference secrets via `${keys.NAME}` inside `extensionFetch()`
calls. Create secrets via:

```
POST /_agent-native/secrets/adhoc
{ "name": "GITHUB_TOKEN", "value": "ghp_xxxx", "description": "GitHub PAT", "urlAllowlist": ["https://api.github.com"] }
```

Or the user can add them in the settings UI. If an extension needs an API
key that isn't configured yet, tell the user what key is needed and where
to get it.

See the `secrets` skill for the full secrets API.

## Sharing

Use the framework sharing actions:

```bash
# Make an extension visible to the org
pnpm action set-resource-visibility --resourceType=tool --resourceId=EXTENSION_ID --visibility=org

# Share with a specific user
pnpm action share-resource --resourceType=tool --resourceId=EXTENSION_ID --principalType=user --principalId=user@example.com --role=editor

# List current shares
pnpm action list-resource-shares --resourceType=tool --resourceId=EXTENSION_ID
```

> The `resourceType` value is still `tool` for back-compat with the
> `tool_shares` table. The variable name `EXTENSION_ID` is the canonical
> name for the value going into the call.

See the `sharing` skill for visibility levels and roles.

## Navigation

```bash
# Navigate to the extensions list
pnpm action navigate --view=extensions

# Navigate to a specific extension
pnpm action navigate --view=extensions --extensionId=EXTENSION_ID

# Or directly:
set-url-path({ "pathname": "/extensions/EXTENSION_ID" })
```

## Example extensions

### API Status Dashboard

Checks the health of multiple endpoints and shows green/red status:

```html
<div class="p-6" x-data="{
  endpoints: [
    { name: 'API', url: 'https://api.example.com/health' },
    { name: 'Auth', url: 'https://auth.example.com/health' },
    { name: 'CDN', url: 'https://cdn.example.com/health' }
  ],
  results: [],
  loading: true
}" x-init="
  Promise.all(endpoints.map(ep =>
    extensionFetch(ep.url).then(r => ({ ...ep, ok: r.ok })).catch(() => ({ ...ep, ok: false }))
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
<div class="p-6" x-data="{ city: 'San Francisco', weather: null, loading: false }" x-init="
  loading = true;
  extensionFetch('https://api.weatherapi.com/v1/current.json?q=' + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}')
    .then(r => r.json()).then(d => { weather = d; loading = false })
">
  <div class="space-y-4">
    <div class="flex gap-2">
      <input type="text" x-model="city" class="flex-1 rounded-md border bg-background px-3 py-2 text-sm" placeholder="City name" />
      <button x-on:click="loading = true; extensionFetch('https://api.weatherapi.com/v1/current.json?q=' + encodeURIComponent(city) + '&key=${keys.WEATHER_API_KEY}').then(r => r.json()).then(d => { weather = d; loading = false })" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">Search</button>
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

### Todo List (using extensionData)

Full CRUD app using the built-in `extensionData` store — no SQL, no schema
files, no actions. Data is automatically scoped per-extension and per-user:

```html
<div class="p-6" x-data="{
  todos: [],
  newTodo: '',
  loading: true,
  async init() {
    const items = await extensionData.list('todos');
    this.todos = items.map(i => ({ id: i.id, ...JSON.parse(i.data) }));
    this.loading = false;
  },
  async addTodo() {
    if (!this.newTodo.trim()) return;
    const id = crypto.randomUUID();
    const data = { title: this.newTodo.trim(), completed: false };
    await extensionData.set('todos', id, data);
    this.todos.unshift({ id, ...data });
    this.newTodo = '';
  },
  async toggle(todo) {
    todo.completed = !todo.completed;
    await extensionData.set('todos', todo.id, { title: todo.title, completed: todo.completed });
  },
  async remove(id) {
    await extensionData.remove('todos', id);
    this.todos = this.todos.filter(t => t.id !== id);
  }
}">
  <h2 class="text-lg font-semibold mb-4">Todo List</h2>
  <div class="flex gap-2 mb-4">
    <input x-model="newTodo" type="text" placeholder="What needs to be done?"
      class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
      @keydown.enter="addTodo()">
    <button @click="addTodo()"
      class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer hover:bg-primary/90">
      Add
    </button>
  </div>
  <div x-show="loading" class="text-sm text-muted-foreground">Loading...</div>
  <div class="space-y-2">
    <template x-for="todo in todos" :key="todo.id">
      <div class="flex items-center gap-3 rounded-md border p-3">
        <button @click="toggle(todo)" class="cursor-pointer"
          :class="todo.completed ? 'text-green-500' : 'text-muted-foreground'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <template x-if="todo.completed"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3"/></template>
            <template x-if="!todo.completed"><circle cx="12" cy="12" r="10"/></template>
          </svg>
        </button>
        <span class="flex-1 text-sm" :class="todo.completed && 'line-through text-muted-foreground'" x-text="todo.title"></span>
        <button @click="remove(todo.id)" class="text-muted-foreground hover:text-destructive cursor-pointer text-xs">Remove</button>
      </div>
    </template>
  </div>
  <p x-show="!loading && todos.length === 0" class="text-sm text-muted-foreground text-center py-8">No todos yet. Add one above!</p>
</div>
```

### Quick Notes

Persistent notes using localStorage -- no API key needed:

```html
<div class="p-6" x-data="{
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

- **Rely on the default canvas padding.** The iframe shell adds modest body padding so simple extensions do not hug the edge. Do not add outer `p-4` / `p-6` unless the design needs extra breathing room. For full-bleed extensions such as maps, canvases, or custom editors, put `data-tool-layout="full-bleed"` or `data-tool-padding="none"` on the outermost element. (The `data-tool-*` attribute names are kept for back-compat with the iframe runtime.)
- **Use semantic Tailwind colors for native theming.** Always use `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, `bg-muted`, `text-muted-foreground`, etc. The extension inherits the parent app's exact theme variables, so it will look fully native in both light and dark modes.
- **Keep extensions focused.** One extension, one job. A "GitHub PR Dashboard" should show PRs, not also manage issues.
- **Handle loading and error states.** Always show a loading indicator during fetch and handle failures gracefully.
- **All functions referenced in Alpine expressions must be defined in `x-data`.** If you use `@click="add()"`, there must be an `add()` method in the component's `x-data` object. Undefined references cause runtime errors.
- **Use the right fetch helper.** `appAction()` for app actions, `appFetch()` for app endpoints, `extensionFetch()` for external APIs. Never use raw `fetch()` -- secrets won't be injected and CORS will block external APIs.
- **Single quotes around `${keys.*}`** to prevent browser-side template literal evaluation.
- **Prefer patches over full rewrites** when editing existing extensions. Smaller diffs are less error-prone.

## Routes

| Method | Path                                   | Purpose                                       |
| ------ | -------------------------------------- | --------------------------------------------- |
| GET    | `/_agent-native/extensions`            | List extensions (filtered by ownership/share) |
| POST   | `/_agent-native/extensions`            | Create an extension                           |
| GET    | `/_agent-native/extensions/:id`        | Get an extension                              |
| PUT    | `/_agent-native/extensions/:id`        | Update (supports `patches` for diffing)       |
| DELETE | `/_agent-native/extensions/:id`        | Delete an extension                           |
| GET    | `/_agent-native/extensions/:id/render` | Render HTML for iframe                        |
| POST   | `/_agent-native/extensions/proxy`      | Authenticated proxy with secret injection     |

## Database & API names — back-compat reference

The rename from "tools" to "extensions" is mostly user-facing. Several
under-the-hood names are kept to avoid breaking existing data and code:

| Surface                              | Stays as              | Rationale                                              |
| ------------------------------------ | --------------------- | ------------------------------------------------------ |
| SQL table for extensions             | `tools`               | Renaming a table = drop+create; data must not move     |
| SQL table for per-ext data           | `tool_data`           | Same                                                   |
| SQL table for ext shares             | `tool_shares`         | Same                                                   |
| Drizzle schema export                | `extensions`          | Code-side rename — no data migration needed            |
| Drizzle schema export                | `extensionData`       | Same                                                   |
| Drizzle schema export                | `extensionShares`     | Same                                                   |
| Iframe global (legacy alias)         | `toolFetch`           | Kept so older extension bodies keep working            |
| Iframe global (legacy alias)         | `toolData`            | Same                                                   |
| Iframe global (canonical)            | `extensionFetch`      | Use this in new extensions                             |
| Iframe global (canonical)            | `extensionData`       | Same                                                   |
| `data-tool-layout` HTML attribute    | unchanged             | Runtime contract; not worth churning                   |
| `resourceType` for sharing           | `tool`                | Matches `tool_shares` table                            |
| Slot-system table                    | `tool_slots`          | Drizzle export is `extensionSlots` (see `extension-points`) |
| Slot-installs table                  | `tool_slot_installs`  | Drizzle export is `extensionSlotInstalls`              |

## Related skills

- `extension-points` -- how an extension renders as a widget inside another app via named UI slots.
- `secrets` -- creating and managing API keys for `${keys.NAME}` substitution.
- `sharing` -- visibility and access control for extensions.
- `actions` -- the `create-extension` and `update-extension` actions that back extension CRUD.
- `frontend-design` -- design guidance when styling extension HTML.
