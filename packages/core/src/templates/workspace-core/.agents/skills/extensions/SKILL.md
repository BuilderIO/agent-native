---
name: extensions
description: >-
  Creating, editing, and managing extensions — sandboxed Alpine.js mini-apps
  that run inside iframes. Use when a user asks for a dashboard, widget,
  calculator, or any interactive mini-app that calls external APIs. Distinct
  from LLM "tools" (function calls) — see note below.
metadata:
  internal: true
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
> the back-compat table in `references/api.md`.

## References

- **`references/api.md`** — the exhaustive helper/global tables (`appAction`,
  `appFetch`, `dbQuery`, `dbExec`, `extensionFetch`, `extensionData`), secrets,
  Tailwind classes, sharing, navigation, routes, and the full back-compat
  naming table. Read this when you need the precise signature, scope option, or
  route for any helper.
- **`references/examples.md`** — five worked HTML extensions (API status
  dashboard, weather widget, todo list with `extensionData`, quick notes).
  Read this when you want a complete copy-pasteable starting point.

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

Extensions have full access to app data via helpers injected into the iframe
(full signatures in `references/api.md`):

- `appAction(name, params)` — call any app action
- `appFetch(path, options)` — call allowed framework endpoints under
  `/_agent-native/*`
- `dbQuery(sql, args)` — read from SQL
- `dbExec(sql, args)` — write to SQL
- `extensionFetch(url, options)` — call external APIs via proxy. Legacy
  alias: `toolFetch` — kept for back-compat with extension bodies authored
  before the rename; both names refer to the same helper.
- `extensionData.set/list/get/remove(collection, ...)` — persist custom data
  per-extension (supports `{ scope: 'user' | 'org' | 'all' }` option). Legacy
  alias: `toolData` — kept for back-compat; both names refer to the same
  store.
- `agentNative.ui.output(value, opts?)` — when an extension is rendered inline
  in chat, record passive control/selection output at
  `inline-ui:<extensionId>:output` in application state so the agent can read it
  later with `readAppState`.
- `agentNative.chat.send(message, opts?)` — send a visible prompt or selected
  value back into the current agent chat.

For transient inline generative UI, `extensionData` is host-browser
`localStorage`: the agent cannot read it, it does not sync across devices, it
does not migrate when the UI is saved later, and the server does not garbage
collect it. Use it only for throwaway local UI state. Use application state,
`agentNative.ui.output`, `appAction`, or `agentNative.chat.send` for anything
the agent or app must observe.

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
```

> The legacy global `toolData` is still injected and points at the same
> store — older extension bodies that reference `toolData.set(...)` continue
> to work without changes. Prefer `extensionData` in new code.

**Prefer `extensionData` over raw `dbExec` for extension-specific
persistence** — it handles everything automatically. Only use
`dbQuery`/`dbExec` when querying the app's existing tables. See
`references/api.md` for the full `get`/`remove`/scope reference.

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
  --content '<div x-data="...">...</div>'
```

Or via the HTTP API:

```
POST /_agent-native/extensions
{ "name": "GitHub PR Dashboard", "description": "Shows open PRs", "content": "<div ...>...</div>" }
```

The action accepts:

| Field                  | Type     | Required | Purpose                                            |
| ---------------------- | -------- | -------- | -------------------------------------------------- |
| `name`                 | `string` | yes      | Display name of the extension                      |
| `description`          | `string` | no       | Short summary                                      |
| `content`              | `string` | yes\*    | Alpine.js HTML body (\*unless `contentFromAttachment`) |
| `contentFromAttachment`| `string` | no       | Host a pasted/attached file verbatim, by reference |
| `icon`                 | `string` | no       | Icon name or short label                           |

See `references/examples.md` for full, runnable `content` bodies.

### Hosting a pasted file (by reference)

When the user **pastes a large file** (e.g. a finished HTML/Alpine app) and asks
you to host it as an extension, do NOT copy that file into the `content`
argument. A big paste shows up in your context as a
`<attachment name="pasted-text-…">` block; re-typing it as a tool argument burns
thousands of output tokens and frequently gets cut off mid-stream, stalling the
turn.

Instead, leave `content` empty and pass `contentFromAttachment` set to that
attachment's `name` — or the literal string `"latest"` for the most recent
pasted block. The server reads the attachment verbatim and stores it as the
extension content:

```json
{ "name": "My Dashboard", "contentFromAttachment": "latest" }
```

`update-extension` accepts the same `contentFromAttachment` for full-body
replacement. Inline `content` still works for everything you author yourself —
use `contentFromAttachment` only to avoid regurgitating something the user
already pasted.

## Editing an extension

Use the `update-extension` action. Prefer granular `edits` for surgical
changes instead of regenerating the full HTML. For medium/large extensions,
add stable section comments around major blocks so future agents can target
them without touching unrelated indentation:

```html
<!-- agent-native:section npm-daily-chart -->
<section>...</section>
<!-- /agent-native:section npm-daily-chart -->
```

Then update just that section:

```json
{
  "id": "EXTENSION_ID",
  "edits": "[{\"op\":\"replace-section\",\"section\":\"npm-daily-chart\",\"content\":\"<section>...</section>\"}]",
  "format": true
}
```

Supported `edits` operations:

| Operation         | Use for                                      |
| ----------------- | -------------------------------------------- |
| `replace`         | Literal find/replace; defaults to one match  |
| `insert-before`   | Insert content before an exact marker        |
| `insert-after`    | Insert content after an exact marker         |
| `replace-between` | Replace content between two exact markers    |
| `replace-section` | Replace a named comment section              |
| `wrap-section`    | Add a wrapper around a named section         |
| `remove-section`  | Remove a named section                       |
| `regex-replace`   | Carefully scoped regex replacement           |

Use `expectedMatches` when ambiguity would be dangerous. Missing required
targets fail instead of silently doing nothing. Pass `format: true` to run
Prettier on the final HTML after the patch. Full `content` replacement is
still available for broad rewrites.

Legacy `patches` still work for simple literal replacements:

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

## History and rollback

Extensions keep a snapshot history in SQL. A version is recorded when an
extension is created, when metadata or HTML content changes, and when a prior
version is restored. Existing extensions that predate history get their current
state saved as a baseline the first time they are edited.

Use these actions when the user asks what changed, wants a changelog/diff, or
wants to go back in time:

| Action                              | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `list-extension-history`            | List saved versions for one extension                         |
| `get-extension-history-version`     | Read one version with a previous-version diff                 |
| `restore-extension-history-version` | Restore name, description, icon, and HTML content from a version |

Restoring a version does **not** restore sharing/ownership; access stays as it
is now. In the UI, use the History button in the extension viewer to inspect
versions, see diffs, and restore older content.

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

## Component shape: inline `x-data` vs. `Alpine.data()`

For trivial components (a couple of state fields, no methods, no string
templating) inline `x-data="{ count: 0, items: [] }"` is fine. **For anything
beyond that — multiple methods, string formatting, classification logic,
async fetches with branching — put the component in a `<script>` block and
register it with `Alpine.data()`.** The inline form is a string inside an
HTML attribute; the longer it gets the more fragile it becomes (one stray
quote, one closing-tag-shaped substring, one template literal and the
attribute terminates early — Alpine then evaluates a half-parsed expression
and throws `ReferenceError: <var> is not defined`).

**Use this pattern for any non-trivial extension:**

```html
<div x-data="customerAnalyzer" class="p-4">
  <button @click="analyze()" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">
    Analyze
  </button>
  <template x-if="error"><p class="text-red-500" x-text="error"></p></template>
  <template x-if="results">
    <div class="space-y-2">
      <div class="rounded-lg border p-3">
        <p class="font-medium">Action — Builder Side</p>
        <p class="text-sm text-muted-foreground" x-text="results.builderActions.length + ' items'"></p>
      </div>
      <!-- ...other buckets... -->
    </div>
  </template>
</div>

<script>
  document.addEventListener('alpine:init', () => {
    Alpine.data('customerAnalyzer', () => ({
      loading: false,
      error: '',
      results: null,
      async analyze() {
        this.loading = true;
        this.error = '';
        try {
          const { emails } = await appAction('list-emails', { view: 'inbox', limit: 50 });
          // ...categorize into 3 buckets...
          this.results = {
            builderActions: emails.filter((e) => /* ... */),
            waitingOnCustomer: emails.filter((e) => /* ... */),
            fyi: emails.filter((e) => /* ... */),
          };
        } catch (e) {
          this.error = e?.message || 'Analysis failed';
        } finally {
          this.loading = false;
        }
      },
    }));
  });
</script>
```

**Hard rules for `x-data` / `x-*` attributes:**

- Never put template literals (backticks) inside an HTML attribute. Use
  string concatenation or pre-format in the script block. Backticks can
  trip the HTML parser and the resulting string isn't a JS template literal
  anyway — the attribute is read as plain text.
- Never put a multi-method object literal inline. Move methods into
  `Alpine.data()`.
- In the `<script>` block, write normal JS — template literals, async/await,
  optional chaining all work.
- One source of truth for state: define every variable referenced from any
  `x-text`, `x-show`, `x-if`, `x-for`, `:class`, etc. on the `Alpine.data()`
  object's initial state. If `x-text="results.foo"` references `results`,
  `results` must be a property of the data object — null is a fine initial
  value as long as you guard with `<template x-if="results">`.
- When showing an error, render `error.message`-style text, never a raw
  boolean. `x-text="error"` is correct only when `error` is a string;
  if it's `true` the user sees the literal word "true".

## AI / LLM features in extensions

Extensions can do AI work two ways. Pick deliberately — silent fallbacks
end up rendering nonsense like the literal text `true`.

1. **Delegate to the agent chat.** If the user says "analyze my emails",
   "summarize this", "categorize these tickets" and there is no API key
   already configured for the relevant provider, prefer doing the work in
   the agent chat instead of inside the extension. The extension can have
   a button that calls `parent.postMessage({ type: 'agent-native-send-to-chat', message: '...' })`,
   or you can just answer in chat and skip the extension. Don't ship an
   extension with a stubbed AI step that returns a placeholder — that's
   how you end up rendering `true` in red.
2. **Call an LLM directly via `extensionFetch`.** Requires a real key the
   user has set up. Reference it via `${keys.OPENAI_API_KEY}` /
   `${keys.ANTHROPIC_API_KEY}` and surface a clear error if the proxy
   reports the key isn't configured. Tell the user where to add the key:
   Dispatch Vault for workspace apps, or app Settings → API Keys & Connections
   for standalone apps.

If you're not sure a key is configured, ask the user before generating an
extension whose primary value is the AI step.

## Secrets and sensitive data in extensions

Never put a real API key, token, webhook URL, signing secret, private
Builder/internal data, customer data, or credential-looking literal into
extension HTML, inline scripts, docs, examples, or extension seed content.
Extensions are stored in SQL and rendered in the browser; anything written into
the extension body should be treated as visible.

For external API calls, use `extensionFetch()` with `${keys.NAME}` placeholders
inside single-quoted strings, for example
`Authorization: 'Bearer ${keys.GITHUB_TOKEN}'`. The proxy resolves the value
server-side. If the user has not configured the key, surface a setup error
instead of substituting a copied key or demo value.

## Guidelines

- **Rely on the default canvas padding.** The iframe shell adds modest body padding so simple extensions do not hug the edge. Do not add outer `p-4` / `p-6` unless the design needs extra breathing room. For full-bleed extensions such as maps, canvases, or custom editors, put `data-tool-layout="full-bleed"` or `data-tool-padding="none"` on the outermost element. (The `data-tool-*` attribute names are kept for back-compat with the iframe runtime.)
- **Use semantic Tailwind colors for native theming.** Always use `bg-background`, `text-foreground`, `bg-primary`, `text-primary-foreground`, `border-border`, `bg-muted`, `text-muted-foreground`, etc. The extension inherits the parent app's exact theme variables, so it will look fully native in both light and dark modes.
- **Keep extensions focused.** One extension, one job. A "GitHub PR Dashboard" should show PRs, not also manage issues.
- **Handle loading and error states.** Always show a loading indicator during fetch and handle failures gracefully.
- **All functions referenced in Alpine expressions must be defined in `x-data`.** If you use `@click="add()"`, there must be an `add()` method in the component's `x-data` object. Undefined references cause runtime errors.
- **For non-trivial components, use a `<script>` + `Alpine.data('name', () => ({...}))` block and reference it with `x-data="name"`.** Inline `x-data="{ ...big object... }"` is brittle: stuffing many methods, branching logic, or any backtick template literal into an HTML attribute leads to half-parsed expressions and `ReferenceError` failures. See the "Component shape" section above.
- **Don't ship a stubbed AI step.** If the extension's value is "AI analysis" and no LLM key is configured, either route the work to the agent chat or tell the user which key to add — never render a placeholder/boolean as the result.
- **Never hardcode secrets or private data.** Use `${keys.NAME}` placeholders
  for external credentials and synthetic example data for demos.
- **Use the right fetch helper.** `appAction()` for app actions and app data, `appFetch()` for allowed framework `/_agent-native/*` endpoints, and `extensionFetch()` for external APIs. Never call template `/api/*` routes from an extension and never use raw `fetch()` -- secrets won't be injected and CORS will block external APIs.
- **Single quotes around `${keys.*}`** to prevent browser-side template literal evaluation.
- **Prefer patches over full rewrites** when editing existing extensions. Smaller diffs are less error-prone.

## Related skills

- `extension-points` -- how an extension renders as a widget inside another app via named UI slots.
- `secrets` -- creating and managing API keys for `${keys.NAME}` substitution.
- `sharing` -- visibility and access control for extensions.
- `actions` -- the `create-extension`, `update-extension`, and extension history actions that back extension CRUD and rollback.
- `frontend-design` -- design guidance when styling extension HTML.
