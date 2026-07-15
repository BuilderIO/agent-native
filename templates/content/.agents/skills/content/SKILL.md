---
name: content
description: >-
  Use Content for repo-backed Markdown/MDX docs, blogs, resources, rich
  document editing, Notion-style databases and boards, structured intake
  forms, local components, shareable copies, and Content local-file workspaces.
  Prefer Content actions over raw filesystem writes when available.
metadata:
  visibility: exported
---

# Content

Use the Content app when a workflow is about authoring, editing, reviewing, or
publishing Markdown/MDX documents: docs sites, blogs, resource libraries,
marketing pages, internal notes, and local MDX components. Also use Content for
Notion-style databases, tables, boards, structured request intake, and forms
whose submissions become database row pages. Content gives the agent a document
tree, a rich editor, structured database properties and views, normal document
actions, and an optional local-file source of truth.

## Choose The Path

- Use Content actions when the Content MCP/action tools are available:
  `list-documents`, `search-documents`, `get-document`, `pull-document`,
  `create-document`, `edit-document`, `update-document`, `delete-document`,
  `share-local-file-document`, `list-local-component-files`, and
  `write-local-component-file`.
- Use `pull-document` or `get-document` before editing a page. Use
  `edit-document` for precise find/replace changes and `update-document` for
  full rewrites or new content.
- Use `list-documents` or `search-documents` to find an existing database by
  its exact title, then inspect it with `get-content-database` before creating
  or submitting anything. Do not create a second database when the canonical
  one already exists.
- In Local File Mode, Content actions read and write the repo files declared in
  `agent-native.json`; SQL remains cache/history/search glue, not the source of
  truth for those pages.
- If Content tools are not visible and no local Content app or Desktop bridge is
  running, treat this skill as repo-editing guidance. Edit configured
  `.md`/`.mdx` files directly, preserve frontmatter and MDX imports, and tell
  the user the Content action surface was not available.

## Action Examples

Prefer JSON input for action calls:

```bash
pnpm action list-documents
pnpm action get-document '{"id":"local-file:..."}'
pnpm action edit-document '{"id":"local-file:...","find":"old copy","replace":"new copy"}'
pnpm action update-document '{"id":"local-file:...","content":"# Updated\n\nBody"}'
pnpm action share-local-file-document '{"id":"local-file:..."}'
```

Run `refresh-list` after create/update/delete operations when you need the open
Content UI sidebar to repaint immediately.

## Database And Intake Workflows

Content databases are one available capability for structured team queues,
tables, boards, and intake forms. Select Content when workspace instructions or
app-capability discovery identify it as the owner of the workflow. Do not route
from a department or subject word alone, and do not embed an organization's
queue name, destination ID, schema, required fields, or owner in this reusable
skill. If workspace instructions assign the workflow to another app, follow
those instructions.

For a named intake workflow:

1. Read the loaded workspace instruction/resource first. It may identify the
   owning app, canonical database ID or title, form view, and intake policy.
   Treat that live instruction as authoritative instead of applying defaults
   from this skill.
2. Once Content is selected, find the canonical database by the instructed ID
   or exact title with `list-documents` or `search-documents`; inspect it with
   `get-content-database` and, when available,
   `get-content-database-form`. Preserve its database and document IDs. Never
   guess IDs or create a duplicate queue.
3. Read the current property/form schema and required fields before asking the
   user anything. Ask only for required values that are actually missing.
4. You may infer low-risk values from the request, sender identity, and source
   context, but state proposed values and confirm any uncertain or consequential
   inference. Never invent a value for a field marked required.
5. Preserve a provided `Source Slack thread` URL verbatim in the matching URL
   or source field. It is request provenance; never replace it with an invented
   Slack URL.
6. Submit exactly once with `submit-content-database-form` when that action is
   available. Prefer it over piecemeal writes because it validates required
   fields and verifies the saved row. Fall back to `add-database-item` only
   when the database has no form contract and all required values have already
   been confirmed.
7. Treat submission as complete only when the successful result includes a
   `createdDocumentId` and verification. Return the exact `url` or `urlPath`
   from the result. The canonical Content row route is `/page/<createdDocumentId>`;
   never invent a different path, slug, ID, or host.

When the user supplies a complete description in one message, do not force a
questionnaire: extract the matching fields, show only genuinely uncertain
inferences for confirmation, then submit once. When required information is
missing, keep the clarification in the originating thread and retain earlier
answers as context.

### Slack Follow-ups And Corrections

A follow-up in an existing Slack thread is not automatically a new intake. Read
the thread context and inspect the prior Content artifact identity first,
including any returned document ID or `/page/<id>` path and the canonical
database row when available. Then choose the operation that matches the user's
intent:

- **Update** the same document for corrections, refinements, status changes, or
  renames that still describe the same request. A rename changes the title, not
  the artifact identity: preserve the stable Content document ID and page path.
- **Add** new details to the same document when the follow-up extends the
  original request without replacing it.
- **Supersede** only when the user intends a replacement artifact or distinct
  successor and the workspace's schema or instructions define how that
  relationship is recorded. Preserve a concrete link to the prior artifact.
- **Create** only when the follow-up is genuinely a separate request or the user
  explicitly asks for a new artifact. Do not blindly submit another row merely
  because a new Slack message arrived.

Apply people fields from verified identity and intent, not from convenient
guesswork:

- When the database has a `Requester` field, default it to the verified Slack
  sender unless the user explicitly identifies a different requester.
- A named doer such as "for Apoorva" maps to `Assignee` when that field exists.
  Naming an assignee never changes or replaces `Requester`.
- Resolve named people to the database's accepted person identity before
  writing. If a named person cannot be resolved unambiguously, clarify in the
  originating Slack thread; never omit, downgrade, or silently drop the person.

## Local File Mode

Install into an existing repo with:

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

The installer copies this skill and writes or updates `agent-native.json` with
Content roots for `docs/`, `blog/`, `content/`, and `resources/`, plus a
`components/` folder for local MDX components. A typical manifest looks like:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Blog",
          "path": "blog",
          "kind": "blog",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Content",
          "path": "content",
          "kind": "content",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Resources",
          "path": "resources",
          "kind": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

Local File Mode does not make the host language model local, and the hosted
Content app cannot read private repo files by itself. File access requires a
local Content app, Agent Native Desktop, or another trusted local bridge.

## MDX And Components

- Preserve frontmatter keys you do not understand. Preserve MDX imports,
  exports, JSX, and expression props unless the user explicitly asks to change
  them.
- Use local components from the configured `components` folder. Components
  should be PascalCase exports from `.tsx` files; simple editable input metadata
  can live next to them as `ComponentNameInputs`.
- Use `list-local-component-files` and `write-local-component-file` for
  component source changes when Content tools are available. Otherwise edit the
  component files directly like normal repo source.

## Boundaries

- Moving, renaming, and reordering local-file pages are not first-class Content
  UI operations yet. Use normal file operations when the user asks for those,
  then let Content rediscover the file tree.
- Do not push/pull Notion, Builder.io, or other provider-backed content unless
  the user explicitly asks for provider sync.
- Do not paste secrets, private provider data, or credential-looking values into
  docs, generated pages, frontmatter, examples, or local components.
