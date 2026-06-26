---
title: "Extensions"
description: "Mini-apps your users build inside your template — a custom KPI tile in Analytics, a meeting-prep checklist in Calendar, a contact CRM widget in Mail. No deploys, no code edits, no schema changes."
---

# Extensions

Extensions are **mini-apps your users build inside your template**.

When the agent needs a one-time interactive answer inside the chat itself, use
[Generative UI](/docs/generative-ui) instead. Generative UI uses the same
sandbox and bridge helpers, but `render-inline-extension` keeps the result
transient, while `create-extension` saves a reusable extension that also appears
in the Extensions view.

If you've used QuickBooks Online, you've seen the model: QBO ships a core accounting product, and users layer on small custom widgets — a custom report, a payroll calculator, a tax-rule checker — that live inside the same app and use the same data. Extensions are the agent-native version of that idea, except your users don't write any code. They describe what they want, and the agent builds it.

The framing matters: an extension isn't a generic "do whatever you want" sandbox. It's a **mini-app that extends a specific template** — Mail, Analytics, Calendar, Clips, Design — and uses that template's actions and data. A Mail extension reads emails. An Analytics extension reads a dashboard's metrics. A Calendar extension acts on the open event. They feel like part of the host product because they _are_ part of the host product.

Three things make extensions work:

- **No code, no deploy.** The agent writes them and they're live in seconds. Stored in the database, not the repo.
- **Full access to the template's data.** Extensions can call the same actions the agent calls — `list-emails` in Mail, `list-decks` in Slides, `list-recordings` in Clips — so they have everything the host app has.
- **Built-in storage.** Each extension has its own per-user / per-org key-value store, so it can save state without you adding a new SQL table.

If a template should not expose user-authored extensions, set
`extensionTools: false` on `createAgentChatPlugin()`. That removes the
agent-facing extension actions and prompt guidance while leaving the rest of the
app agent intact.

```an-diagram title="The sandbox bridge" summary="Extension HTML runs in an isolated iframe and reaches the host only through a fixed set of bridge helpers — every call is scoped and access-checked."
{
  "html": "<div class=\"ext-bridge\"><div class=\"diagram-card sandbox\" data-rough><span class=\"diagram-pill warn\">Sandboxed iframe</span><small class=\"diagram-muted\">Alpine.js HTML &middot; no host cookies, session, or DOM</small><div class=\"ext-helpers\"><span class=\"diagram-pill\">appAction</span><span class=\"diagram-pill\">appFetch</span><span class=\"diagram-pill\">dbQuery / dbExec</span><span class=\"diagram-pill\">extensionData</span><span class=\"diagram-pill\">extensionFetch</span></div></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&harr;</div><div class=\"diagram-col\"><div class=\"diagram-box\">Host template<br><small class=\"diagram-muted\">actions, auto-scoped SQL</small></div><div class=\"diagram-box\">Secret proxy<br><small class=\"diagram-muted\"><code>${keys.NAME}</code>, domain-locked</small></div><div class=\"diagram-box\">External APIs<br><small class=\"diagram-muted\">via extensionFetch only</small></div></div></div>",
  "css": ".ext-bridge{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.ext-bridge .sandbox{display:flex;flex-direction:column;gap:8px;padding:16px 18px;flex:1;min-width:240px}.ext-bridge .ext-helpers{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.ext-bridge .diagram-col{display:flex;flex-direction:column;gap:8px}.ext-bridge .diagram-arrow{font-size:24px}"
}
```

Extensions can also be **repo-backed in Local File Mode**. In that workflow,
`agent-native.json` declares an `extensions` folder, each extension has an
`extension.json` manifest plus an HTML entry file, and the app renders those
files through the same sandbox. File-backed extensions are edited by changing
the repo files; database-backed extensions keep the runtime create/edit/share
experience described below.

## A quick gallery {#gallery}

Real extensions people would actually build, grouped by the template they live in. Each one is one focused thing — not a Swiss-army knife.

### Mail

A user is reading an email from `priya@acme.com`. What kind of widget would help right there?

- **Contact notes** — a sticky-note pad pinned to whoever the user is emailing. Loads notes for that contact, lets the user jot more.
- **Recent threads with this person** — a small list of the last five threads with the open contact, separate from the inbox view.
- **CRM enrichment** — pulls the contact's company size, last meeting date, or open deals from your CRM.
- **Meeting scheduler shortcut** — turns "find a time next week" into a one-click "send these slots" widget.

Sketch — Contact notes (saves a note tied to whoever you're emailing):

```html
<div
  class="p-4"
  x-data="{
    contactEmail: window.slotContext?.contactEmail,
    note: '',
    async init() {
      if (!this.contactEmail) return;
      const saved = await extensionData.get('notes', this.contactEmail);
      if (saved) this.note = JSON.parse(saved.data).text;
    },
    async save() {
      await extensionData.set('notes', this.contactEmail, { text: this.note });
    }
  }"
>
  <p class="text-xs text-muted-foreground mb-2" x-text="contactEmail"></p>
  <textarea
    x-model="note"
    @blur="save()"
    class="w-full rounded-md border bg-background p-2 text-sm"
    rows="4"
    placeholder="Notes about this contact..."
  ></textarea>
</div>
```

### Analytics

A user is staring at a dashboard. What's the missing tile?

- **Custom KPI box** — a single big number for a metric that isn't a built-in panel. "Trials started this week," "MRR delta vs last month."
- **Goal tracker** — pulls a metric the user picks and shows progress against a target the user typed in.
- **Top customers leaderboard** — joins a metric with a customer table, ranks the top 10.

Sketch — Custom KPI box (calls one of the analytics template's `appAction` queries):

```html
<div
  class="p-4"
  x-data="{
  value: null,
  async init() {
    const result = await appAction('query-agent-native-analytics', {
      metric: 'trials_started',
      range: '7d'
    });
    this.value = result?.total ?? 0;
  }
}"
>
  <p class="text-xs uppercase tracking-wider text-muted-foreground">
    Trials this week
  </p>
  <p class="text-3xl font-bold mt-1" x-text="value ?? '—'"></p>
</div>
```

### Calendar

The user has an event open. What would help in that moment?

- **Meeting prep checklist** — auto-loads agenda items, attendees, and prior thread summaries for the open event.
- **Travel time** — "you have 35 minutes until your next meeting at the Mission location."
- **Timezone helper** — shows the meeting time in every attendee's local time at a glance.

### Clips

A user is reviewing a screen recording. What enhances that view?

- **Action item extractor** — reads the clip transcript (the agent fetches it via `appAction`), lists the to-dos.
- **Auto-share** — one-click "post this clip's link to my #recordings Slack channel."
- **Highlight reel** — pulls the chapters the agent generated and turns them into a quick navigation menu.

### Design

A user has a draft Alpine/Tailwind page open. What would smooth the prototyping loop?

- **Brand color swatch** — palette pulled from the user's brand config, click to copy a color into the editor.
- **Asset picker** — lists images the user has uploaded, drops the URL on click.
- **Spacing inspector** — shows the gap/padding/margin tokens the active page uses, so the user can stay consistent.

Pattern across all of these: extensions are about **the moment** the user is in inside the host template. The agent already knows which contact, which dashboard, which event, which clip — the extension uses that context.

## How a user builds one {#building}

The simple path:

1. **Click "New Extension"** in the sidebar (or just ask in chat).
2. **Describe what you want in one sentence.** "A sticky-note pad for the contact I'm emailing." "A KPI box for trials started this week."
3. **The agent writes it and it appears in your Extensions list, ready to use.**

No file to edit, no deploy. The agent picks the right helpers (`appAction`, `extensionData`, `extensionFetch`) and writes the Alpine.js HTML.

If the extension needs an API key — a CRM token, a weather API — the agent tells you what to add and where to add it. Keys are stored encrypted and locked to specific domains.

If you want to change something later, just say so: "Add a search box to my contact notes." The agent edits the HTML in place — no regeneration of the whole thing.

Every change is versioned. Open the extension viewer's History control to see
saved versions, inspect the diff from the previous version, and restore an
older name/description/icon/content snapshot without changing ownership or
sharing.

## What an extension can do {#capabilities}

Inside the iframe sandbox, every extension has these helpers on `window`:

| Helper                                           | Purpose                                                   | Example                                                   |
| ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- |
| `appAction(name, params)`                        | Call any of the host template's actions                   | `appAction('list-emails', { view: 'inbox' })`             |
| `appFetch(path, options)`                        | Call allowed framework endpoints under `/_agent-native/*` | `appFetch('/_agent-native/application-state/navigation')` |
| `dbQuery(sql, args)`                             | Read from SQL (auto-scoped to the user)                   | `dbQuery('SELECT id, name FROM tools')`                   |
| `dbExec(sql, args)`                              | Write to SQL                                              | `dbExec('INSERT INTO ...')`                               |
| `extensionFetch(url, options)`                   | Hit external APIs through a secure proxy with secrets     | `extensionFetch('https://api.github.com/user')`           |
| `extensionData.set(collection, id, data, opts?)` | Persist data per-extension (user / org scoping)           | `extensionData.set('notes', id, { text: '...' })`         |
| `extensionData.list(collection, opts?)`          | List persisted items                                      | `extensionData.list('notes', { scope: 'all' })`           |
| `extensionData.get(collection, id, opts?)`       | Get a single item                                         | `extensionData.get('notes', 'note-1')`                    |
| `extensionData.remove(collection, id, opts?)`    | Delete a persisted item                                   | `extensionData.remove('notes', 'note-1')`                 |
| `window.slotContext`                             | Read the page/chat context passed into this slot          | `window.slotContext?.contactEmail`                        |
| `agentNative.ui.output(value, opts?)`            | Record passive inline UI output in application state      | `agentNative.ui.output({ threshold })`                    |
| `agentNative.chat.send(message, opts?)`          | Send a prompt or selected value back to the agent chat    | `agentNative.chat.send('Use Q2', { context: { q: 2 } })`  |

Three rules of thumb:

- **Prefer `appAction` over `dbQuery`.** Actions are the template's official surface — they handle access control, scoping, and validation for you. Reach for raw SQL only when no action fits.
- **Use `appAction` for template data.** Extension `appFetch` is limited to framework `/_agent-native/*` endpoints; template `/api/*` routes are blocked by the iframe bridge.
- **Prefer `extensionData` over making new tables.** Each extension gets its own isolated key-value store. No schema, no migration. Set `{ scope: 'org' }` to share with the user's org, `'user'` (default) for private.
- **Use `agentNative.ui.output` for inline control values the agent should read later.** It writes `inline-ui:<extensionId>:output` to application state; `agentNative.chat.send` is for visible submit/apply messages.

```html
<script>
  // Private to me
  await extensionData.set('notes', 'note-1', { title: 'My note' });

  // Shared with my org
  await extensionData.set('notes', 'team-note', { title: 'Team note' }, { scope: 'org' });

  // List everything visible to me (mine + org)
  const all = await extensionData.list('notes', { scope: 'all' });
</script>
```

### Authenticated Extension Data API {#authenticated-extension-data-api}

The same store is also available through authenticated framework routes when
another logged-in client needs to read or update the data an extension uses.
These endpoints use the caller's normal app session and the extension's sharing
roles; they are not a public or server-to-server API key surface. If you need
third-party ingestion, define a template action or route with its own scoped key
model, like Analytics does for `/track`.

```an-api title="List extension data" method="GET" path="/_agent-native/extensions/data/:extensionId/:collection"
{
  "method": "GET",
  "path": "/_agent-native/extensions/data/:extensionId/:collection",
  "summary": "List rows in one extensionData collection",
  "description": "`scope=user` reads only the caller's private rows. `scope=org` reads organization-shared rows. `scope=all` reads both the caller's private rows and org rows visible in the current org context. Results are capped by `limit` with a default of 100 and a max of 1000.",
  "auth": "Authenticated session; requires viewer role on the extension.",
  "params": [
    { "name": "extensionId", "in": "path", "type": "string", "required": true, "description": "Extension id." },
    { "name": "collection", "in": "path", "type": "string", "required": true, "description": "Collection name passed to `extensionData.list()`." },
    { "name": "scope", "in": "query", "type": "\"user\" | \"org\" | \"all\"", "required": false, "description": "Read user-private rows, org-shared rows, or both. Defaults to `user`." },
    { "name": "limit", "in": "query", "type": "number", "required": false, "description": "Maximum rows to return. Defaults to 100 and clamps to 1-1000." }
  ],
  "responses": [
    { "status": "200", "description": "Array of rows with id, tool_id, collection, data, owner_email, scope, org_id, created_at, and updated_at.", "example": "[{\"id\":\"note-1\",\"tool_id\":\"ext_123\",\"collection\":\"notes\",\"data\":\"{\\\"title\\\":\\\"Team note\\\"}\",\"owner_email\":\"ada@example.com\",\"scope\":\"org\",\"org_id\":\"org_123\",\"created_at\":\"2026-06-25T12:00:00.000Z\",\"updated_at\":\"2026-06-25T12:00:00.000Z\"}]" },
    { "status": "400", "description": "`scope=org` was requested without an org context." },
    { "status": "404", "description": "Extension not found, or the caller has no access to it." }
  ]
}
```

```an-api title="Upsert extension data" method="POST" path="/_agent-native/extensions/data/:extensionId/:collection"
{
  "method": "POST",
  "path": "/_agent-native/extensions/data/:extensionId/:collection",
  "summary": "Create or update one extensionData item",
  "description": "Writes one item to the extension's isolated key-value store. The uniqueness key is extension id, collection, scope, and item id. Objects are stored as JSON strings so the extension bridge can read them back consistently.",
  "auth": "Authenticated session; requires editor, admin, or owner role on the extension.",
  "params": [
    { "name": "extensionId", "in": "path", "type": "string", "required": true, "description": "Extension id." },
    { "name": "collection", "in": "path", "type": "string", "required": true, "description": "Collection name passed to `extensionData.set()`." },
    { "name": "id", "in": "body", "type": "string", "required": false, "description": "Stable item id. If omitted, the server generates a UUID." },
    { "name": "scope", "in": "body", "type": "\"user\" | \"org\"", "required": false, "description": "Write a user-private item or an org-shared item. Defaults to `user`." },
    { "name": "data", "in": "body", "type": "object | string", "required": true, "description": "Value to persist. Objects are JSON-stringified before storage." }
  ],
  "request": {
    "contentType": "application/json",
    "example": "{\n  \"id\": \"note-1\",\n  \"scope\": \"org\",\n  \"data\": { \"title\": \"Team note\" }\n}"
  },
  "responses": [
    { "status": "200", "description": "The written item summary.", "example": "{\"id\":\"note-1\",\"extensionId\":\"ext_123\",\"collection\":\"notes\",\"data\":\"{\\\"title\\\":\\\"Team note\\\"}\",\"ownerEmail\":\"ada@example.com\",\"scope\":\"org\",\"orgId\":\"org_123\",\"createdAt\":\"2026-06-25T12:00:00.000Z\",\"updatedAt\":\"2026-06-25T12:00:00.000Z\"}" },
    { "status": "400", "description": "`data` is missing, or `scope=org` was requested without an org context." },
    { "status": "403", "description": "Caller can view the extension but does not have editor-level access." },
    { "status": "404", "description": "Extension not found, or the caller has no access to it." }
  ]
}
```

```an-api title="Delete extension data" method="DELETE" path="/_agent-native/extensions/data/:extensionId/:collection/:itemId"
{
  "method": "DELETE",
  "path": "/_agent-native/extensions/data/:extensionId/:collection/:itemId",
  "summary": "Delete one extensionData item",
  "description": "Deletes the matching item from the selected scope. The default scope is `user`, which deletes only the caller's private item. Use `scope=org` to delete an org-shared item in the current org context.",
  "auth": "Authenticated session; requires editor, admin, or owner role on the extension.",
  "params": [
    { "name": "extensionId", "in": "path", "type": "string", "required": true, "description": "Extension id." },
    { "name": "collection", "in": "path", "type": "string", "required": true, "description": "Collection name passed to `extensionData.remove()`." },
    { "name": "itemId", "in": "path", "type": "string", "required": true, "description": "Item id to delete." },
    { "name": "scope", "in": "query", "type": "\"user\" | \"org\"", "required": false, "description": "Delete from user-private or org-shared storage. Defaults to `user`." }
  ],
  "responses": [
    { "status": "200", "description": "Delete completed.", "example": "{\"ok\":true}" },
    { "status": "400", "description": "`scope=org` was requested without an org context." },
    { "status": "403", "description": "Caller can view the extension but does not have editor-level access." },
    { "status": "404", "description": "Extension not found, or the caller has no access to it." }
  ]
}
```

External APIs go through `extensionFetch`, which proxies the call server-side and substitutes secrets via the `${keys.NAME}` template:

```html
<script>
  const res = await extensionFetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ${keys.GITHUB_TOKEN}' },
  });
</script>
```

The actual key never reaches the browser. Each key is locked to an allowlist of domains, so a leaked extension can't exfiltrate it elsewhere.

## Slots — putting an extension inside the host UI {#slots}

The gallery above describes _what_ an extension does. Slots describe _where_ it appears.

By default, an extension lives on its own page in the Extensions list — open it like a small app. That's fine for dashboards, calculators, and standalone widgets.

But the most QBO-shaped use case is different: the user wants their widget pinned _inside_ the template's UI — under the contact info in Mail's sidebar, in the corner of an Analytics dashboard, on the right side of a Calendar event. That's what **slots** are for.

A slot is a named widget area a template ships:

| Template      | Example slot                   | Where it shows up                            |
| ------------- | ------------------------------ | -------------------------------------------- |
| **Mail**      | `mail.contact-sidebar.bottom`  | Below the contact info on every email thread |
| **Analytics** | `analytics.dashboard.tiles`    | Alongside the dashboard's built-in panels    |
| **Calendar**  | `calendar.event-detail.bottom` | Below the open event                         |
| **Clips**     | `clips.right-panel.tabs`       | A new tab in the clip review panel           |

When an extension is **installed into a slot**, the host pushes the relevant context — the contact's email, the dashboard id, the event id — into the iframe. The extension reads `window.slotContext` to know what the user is looking at.

```an-diagram title="Slots push context into the widget" summary="The host template owns named slots; installing an extension into one feeds it window.slotContext for whatever the user is currently viewing."
{
"html": "<div class=\"slot\"><div class=\"diagram-card\"><span class=\"diagram-pill\">Mail thread</span><small class=\"diagram-muted\">slot <code>mail.contact-sidebar.bottom</code></small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box accent\"><code>window.slotContext</code><br><small class=\"diagram-muted\">{ contactEmail }</small></div><div class=\"diagram-arrow diagram-accent\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\"><span class=\"diagram-pill\">Contact notes</span><small class=\"diagram-muted\">loads notes for that contact &mdash; same widget, different context</small></div></div>",
"css": ".slot{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.slot .diagram-card{display:flex;flex-direction:column;gap:4px;padding:14px 16px;min-width:180px}.slot .diagram-arrow{font-size:22px}"
}

```

### A concrete example

Imagine the contact-notes extension from the gallery. On its own, it's a standalone widget. To make it appear inside the Mail contact sidebar:

1. Build the extension once. Use `window.slotContext.contactEmail` so it knows which contact the user is on.
2. Tell it the slot it can fill: `add-extension-slot-target { extensionId, slotId: "mail.contact-sidebar.bottom" }`.
3. Install it: `install-extension { extensionId, slotId: "mail.contact-sidebar.bottom" }`.

The next time you open an email thread, your sticky-note pad is right under the contact info — populated with notes for the person you're emailing. Switch to a different thread, the notes for _that_ contact load. Same extension, different context, no rewrites.

In practice you don't run those three commands by hand. Just say "pin this widget to my contact sidebar" and the agent handles target + install for you.

> **Slots are an _added_ capability, not a prerequisite.** Plenty of useful extensions never get installed into a slot — they live happily on their own page. Reach for slots when the widget needs to be _next to_ what the user is looking at in the host template.

For deeper detail on slots — how to declare them in your template, how the context contract works, how installs are scoped — see the `extension-points` skill. Skills ship inside every scaffolded template under `.agents/skills/`; see [Skills Guide](/docs/skills-guide) for how they work.

## Local File Extensions {#local-file-extensions}

Local File Mode lets a workspace keep extensions in the repo:

```text
extensions/
  doc-status/
    extension.json
    index.html
```

```json
{
  "id": "doc-status",
  "name": "Doc Status",
  "description": "Shows metadata for the selected Content file.",
  "entry": "index.html",
  "slots": ["content.sidebar.bottom"],
  "permissions": {
    "appActions": ["list-documents"],
    "extensionData": true
  }
}
```

Add the folder to the relevant app in `agent-native.json`:

```json
{
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [{ "name": "Docs", "path": "docs", "extensions": [".mdx"] }],
      "components": "components",
      "extensions": "extensions"
    }
  }
}
```

The app lists file-backed extensions alongside database-backed ones and renders
them through the normal sandbox iframe. Slot declarations in `extension.json`
auto-mount the extension into matching `ExtensionSlot`s; there is no per-user
SQL install row for local extensions.

Local extensions have a tighter v1 permission model:

- `extensionData` is available for small runtime state unless disabled.
- `appAction` calls must be explicitly listed in `permissions.appActions`.
- `dbQuery`, `dbExec`, and `extensionFetch` are blocked for now.
- SQL-backed update, delete, share, and history actions return a message that
  points back to the local entry file.

Use database-backed extensions when users should create/share/edit widgets at
runtime. Use local file extensions when the extension is part of a repo-first
workspace and should be reviewable, patchable, and versioned with the rest of
the files.

## Sharing {#sharing}

Extensions are private to the user who created them by default. To share:

- **Org-visible** — everyone in the org can see and use it.
- **Per-user grants** — invite specific people as viewer / editor / admin.

Shared extensions have their own URLs and plug into the same share dialog as documents, decks, and dashboards. Slot installs are always personal — sharing an extension means others _can_ install it; it doesn't auto-pin it to their UI.

## Extensions vs. editing the app code {#vs-app-code}

The framework lets the agent edit the app's source code directly — components, routes, styles. So when should you reach for an extension instead?

|                       | Extension                                         | App code edit                        |
| --------------------- | ------------------------------------------------- | ------------------------------------ |
| **Created by**        | Agent (or user) at runtime                        | Agent editing source files           |
| **Stored in**         | The database                                      | The git repository                   |
| **Requires a build**  | No                                                | Yes                                  |
| **Requires a deploy** | No                                                | Yes                                  |
| **Scope**             | One user (or shared with org)                     | The entire product, every user       |
| **Best for**          | Personal widgets, custom KPIs, per-team utilities | Core features that ship to all users |

Rule of thumb: **if it's for one user or one team, it's an extension.** If every user of the template should get it, ship it as a real feature.

## Security {#security}

```an-callout
{ "tone": "success", "body": "**The raw secret never reaches the browser.** `extensionFetch` substitutes `${keys.NAME}` server-side and each key is locked to a URL allowlist, so even a leaked extension can't exfiltrate it elsewhere." }
```

Extensions run in a sandboxed iframe:

- **Isolated** from the parent app's cookies, session, and DOM.
- **Server-side secret injection** via the `${keys.NAME}` template — the actual key value never reaches the browser.
- **Domain-locked secrets** — each key is bound to a URL allowlist; the proxy refuses requests to other hosts.
- **Private-network protection** — extensions can't reach internal addresses.
- **Auth required** — extensions only run for logged-in users, and `dbQuery` / `dbExec` calls are auto-scoped.

## A few things to know about naming {#naming-back-compat}

If you're poking around the SQL or the source, you'll see a mix of "extension" and "tool" names. Quick decoder:

- The user-facing primitive used to be called "Tools." It's now **Extensions**.
- The physical SQL tables (`tools`, `tool_data`, `tool_shares`, `tool_slots`, `tool_slot_installs`) keep their original names — renaming a table is a destructive migration, and the framework doesn't ship destructive migrations.
- The Drizzle / TypeScript exports use the new names: `extensions`, `extensionData`, `extensionShares`, `extensionSlots`, `extensionSlotInstalls`.
- Inside an extension's iframe, the canonical helpers are `extensionFetch` and `extensionData`. The legacy names `toolFetch` and `toolData` still resolve, so older extension HTML keeps working.

You also won't see this in normal use, but the agent has a third related concept called "LLM tools" — the function-call surface area on a model turn (defined via `defineAction`, MCP, etc.). Those are the function-calling primitive, not the user-facing widgets. When this page says "extension," it means the user-facing widget; when other docs say "tool" alongside `defineAction`, that's the LLM concept.

## What's next

- [**Templates**](/docs/cloneable-saas) — the host apps extensions extend
- [**Actions**](/docs/actions) — the operations an extension calls via `appAction`
- [**Sharing & Privacy**](/docs/sharing) — how extension visibility, org sharing, and per-user grants work
- [**Onboarding & API Keys**](/docs/onboarding) — how secrets surface in the settings UI
- [**Security**](/docs/security) — the framework's data scoping and access model
