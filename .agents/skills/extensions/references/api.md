# Extension API Reference

This is the exhaustive reference for the helpers and globals injected into
every extension iframe, plus the back-compat naming table. For the model +
when-to-use overview, see `../SKILL.md`. For worked HTML examples, see
`examples.md`.

## Accessing app data

Extensions can call the host app's actions and API endpoints directly. The
iframe shares the session cookie, so authentication is automatic.

### `appAction(name, params)` — Call app actions

Call any action defined in the app's `actions/` directory. Actions are
auto-mounted at `/_agent-native/actions/:name`.

```html
<div
  x-data="{ emails: [], loading: true }"
  x-init="
  appAction('list-emails', { view: 'inbox', limit: 10 })
    .then(d => { emails = d.emails || d; loading = false })
    .catch(e => { console.error(e); loading = false })
"
>
  <h2 class="text-lg font-semibold mb-4">My Inbox</h2>
  <template x-for="email in emails" :key="email.id">
    <div class="rounded-lg border p-3 mb-2">
      <p class="font-medium text-sm" x-text="email.subject"></p>
      <p
        class="text-xs text-muted-foreground"
        x-text="email.from?.name || email.from?.email"
      ></p>
    </div>
  </template>
</div>
```

### `appFetch(path, options)` — Call allowed framework endpoints

General-purpose fetch to allowed framework endpoints (for example,
`/_agent-native/application-state/navigation`). Automatically adds credentials
and JSON content type. Template `/api/*` routes are intentionally blocked by
the extension bridge; use `appAction(name, params)` for app data instead.

```javascript
// Read application state
const nav = await appFetch("/_agent-native/application-state/navigation");

// Call a framework route
const nav = await appFetch("/_agent-native/application-state/navigation");
```

### `dbQuery(sql)` — Read from the app's database

Run a read-only SELECT query against the app's SQL database. Results are
auto-scoped to the current user/org.

```html
<div
  x-data="{ rows: [] }"
  x-init="
  dbQuery('SELECT id, name FROM tools ORDER BY created_at DESC LIMIT 10')
    .then(d => rows = d.rows || d)
"
>
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
await dbExec(
  "INSERT INTO notes (id, title, body) VALUES ('abc', 'My Note', 'Hello world')",
);

// Update an existing record
await dbExec("UPDATE notes SET title = 'Updated Title' WHERE id = 'abc'");
```

### All helpers summary

| Helper                                           | Use for                                                  | Example                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `appAction(name, params)`                        | Call app actions (CRUD, queries)                         | `appAction('list-emails', { view: 'inbox' })`                                                                    |
| `appFetch(path, options)`                        | Call allowed framework endpoints                         | `appFetch('/_agent-native/application-state/navigation')`                                                        |
| `dbQuery(sql)`                                   | Read from the app's SQL database                         | `dbQuery('SELECT * FROM notes LIMIT 10')`                                                                        |
| `dbExec(sql)`                                    | Write to the app's SQL database                          | `dbExec("INSERT INTO notes ...")`                                                                                |
| `extensionFetch(url, options)`                   | Call external APIs via proxy (alias `toolFetch`)         | `extensionFetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ${keys.GITHUB_TOKEN}' } })` |
| `extensionData.set(collection, id, data, opts?)` | Save an item to extension storage (alias `toolData.set`) | `extensionData.set('todos', 'todo-1', { title: 'Buy milk' })`                                                    |
| `extensionData.list(collection, opts?)`          | List items in a collection                               | `extensionData.list('todos', { scope: 'all' })`                                                                  |
| `extensionData.get(collection, id, opts?)`       | Get a single item by id                                  | `extensionData.get('todos', 'todo-1')`                                                                           |
| `extensionData.remove(collection, id, opts?)`    | Delete an item                                           | `extensionData.remove('todos', 'todo-1')`                                                                        |

## Persisting Custom Data

Extensions have a built-in key-value store via `extensionData` (legacy alias:
`toolData`). Each extension gets its own isolated storage, organized into
collections. Every method accepts an optional `{ scope }` option:

- `'user'` (default) — private to the current user
- `'org'` — visible to everyone in the user's org
- `'all'` (list/get only) — returns both user and org items

```javascript
// Save a private item (default scope: 'user')
await extensionData.set("todos", "todo-1", { title: "Buy milk", done: false });

// Save an org-shared item
await extensionData.set(
  "todos",
  "team-todo-1",
  { title: "Ship v2", done: false },
  { scope: "org" },
);

// List user items (default)
const myTodos = await extensionData.list("todos");

// List org items
const orgTodos = await extensionData.list("todos", { scope: "org" });

// List both user + org items
const allTodos = await extensionData.list("todos", { scope: "all" });
// Returns: [{ id, toolId, collection, data (JSON string), ownerEmail, scope, orgId, createdAt, updatedAt }]
// (the row column is still named `toolId` for back-compat — it's the extension id)

// Parse the JSON data
const parsed = allTodos.map((t) => ({
  ...JSON.parse(t.data),
  id: t.id,
  scope: t.scope,
}));

// Get/delete with scope
const item = await extensionData.get("todos", "team-todo-1", { scope: "org" });
await extensionData.remove("todos", "team-todo-1", { scope: "org" });
```

Data is scoped per-extension. User-scoped items are private per-user;
org-scoped items are shared across the org. Any org member can read,
update, or delete org-scoped items when the caller has editor/admin/owner
access to the extension. Viewer access is read-only. **Prefer
`extensionData` over raw `dbExec` for extension-specific persistence** — it
handles table creation, scoping, and upserts automatically.

### Authenticated extension data routes

`extensionData` uses the same authenticated HTTP routes that external
logged-in clients may call directly:

| Method | Path                                                              | Access             |
| ------ | ----------------------------------------------------------------- | ------------------ |
| GET    | `/_agent-native/extensions/data/:extensionId/:collection`         | viewer or above    |
| POST   | `/_agent-native/extensions/data/:extensionId/:collection`         | editor/admin/owner |
| DELETE | `/_agent-native/extensions/data/:extensionId/:collection/:itemId` | editor/admin/owner |

Reads accept `?scope=user`, `?scope=org`, `?scope=all`, and `?limit=100`.
Writes accept `{ id, data, scope }` where `scope` is `user` or `org`. These
routes use the caller's app session and extension sharing role; they are not a
public API-key or anonymous ingestion surface. If a template needs
server-to-server access, add a template-specific action or route with explicit
scoped keys and rate limits.

## Using `extensionFetch()` for API calls

`extensionFetch()` (legacy alias `toolFetch()`) is a drop-in replacement for
`fetch()` that proxies requests through the server. The server injects
secret values before the request leaves.

```javascript
// Basic GET
const res = await extensionFetch("https://api.example.com/data");
const data = await res.json();

// With secret injection
const res = await extensionFetch("https://api.openai.com/v1/models", {
  headers: {
    Authorization: "Bearer ${keys.OPENAI_API_KEY}",
  },
});

// POST with body
const res = await extensionFetch("https://api.example.com/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "New Item" }),
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
{ "name": "GITHUB_TOKEN", "value": "<TOKEN_VALUE_FROM_USER_SETTINGS>", "description": "GitHub PAT", "urlAllowlist": ["https://api.github.com"] }
```

Or the user can add them in the settings UI. If an extension needs an API
key that isn't configured yet, tell the user what key is needed and where
to get it. Never invent PAT-shaped values or store keys in extension HTML,
`extensionData`, or examples.

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

## Routes

| Method | Path                                                     | Purpose                                       |
| ------ | -------------------------------------------------------- | --------------------------------------------- |
| GET    | `/_agent-native/extensions`                              | List extensions (filtered by ownership/share) |
| POST   | `/_agent-native/extensions`                              | Create an extension                           |
| GET    | `/_agent-native/extensions/:id`                          | Get an extension                              |
| PUT    | `/_agent-native/extensions/:id`                          | Update (supports `patches` for diffing)       |
| DELETE | `/_agent-native/extensions/:id`                          | Delete an extension                           |
| GET    | `/_agent-native/extensions/:id/render`                   | Render HTML for iframe                        |
| POST   | `/_agent-native/extensions/proxy`                        | Authenticated proxy with secret injection     |
| GET    | `/_agent-native/extensions/data/:id/:collection`         | List authenticated extension data             |
| POST   | `/_agent-native/extensions/data/:id/:collection`         | Upsert authenticated extension data           |
| DELETE | `/_agent-native/extensions/data/:id/:collection/:itemId` | Delete authenticated extension data           |

## Database & API names — back-compat reference

The rename from "tools" to "extensions" is mostly user-facing. Several
under-the-hood names are kept to avoid breaking existing data and code:

| Surface                           | Stays as             | Rationale                                                   |
| --------------------------------- | -------------------- | ----------------------------------------------------------- |
| SQL table for extensions          | `tools`              | Renaming a table = drop+create; data must not move          |
| SQL table for per-ext data        | `tool_data`          | Same                                                        |
| SQL table for ext shares          | `tool_shares`        | Same                                                        |
| SQL table for ext history         | `tool_history`       | Same DB naming family                                       |
| Drizzle schema export             | `extensions`         | Code-side rename — no data migration needed                 |
| Drizzle schema export             | `extensionData`      | Same                                                        |
| Drizzle schema export             | `extensionShares`    | Same                                                        |
| Iframe global (legacy alias)      | `toolFetch`          | Kept so older extension bodies keep working                 |
| Iframe global (legacy alias)      | `toolData`           | Same                                                        |
| Iframe global (canonical)         | `extensionFetch`     | Use this in new extensions                                  |
| Iframe global (canonical)         | `extensionData`      | Same                                                        |
| `data-tool-layout` HTML attribute | unchanged            | Runtime contract; not worth churning                        |
| `resourceType` for sharing        | `tool`               | Matches `tool_shares` table                                 |
| Slot-system table                 | `tool_slots`         | Drizzle export is `extensionSlots` (see `extension-points`) |
| Slot-installs table               | `tool_slot_installs` | Drizzle export is `extensionSlotInstalls`                   |
