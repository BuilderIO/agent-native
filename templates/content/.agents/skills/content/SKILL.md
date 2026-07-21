---
name: content
description: >-
  Use Content for repo-backed Markdown/MDX docs, blogs, resources, rich
  document editing, Notion-style databases and boards, structured intake
  forms, local components, shareable copies, and connected local folders.
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
actions, and local folders that sync into the same database model.

## Choose The Path

- Before drafting or materially rewriting, read the `creative-context` skill.
  Retrieve voice, terminology, audience guidance, and factual evidence as
  separate roles; respect opt-out and pinned packs. Apply the exact reuse
  ladder: approved native template/asset unchanged, compose approved pieces,
  lightly adapt a real example, generate from narrow references, then net-new
  only when the relevant corpus is empty.
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
- Local folders are sources attached to a space's canonical Files database.
  Imported pages are normal SQL-backed Content documents; the trusted local
  bridge handles pull, export, stable file identity, and conflict review.
- If Content tools are not visible and no local Content app or Desktop bridge is
  running, treat this skill as repo-editing guidance. Edit configured
  `.md`/`.mdx` files directly, preserve frontmatter and MDX imports, and tell
  the user the Content action surface was not available.

Retrieval is separate from drafting. Exact source item versions may support
claims; voice examples alone may not. Persist the immutable `contextPackId` and
reuse labels with document generation provenance so later edits can explain
what influenced the copy.

For `create-document`, pass the pre-drafting search result's `contextPackId`
and exact `reuseLabels`. Do not let the final write action search after the
document body has already been authored; post-hoc search is not provenance.
Omit both only when the Library is empty or creative context is explicitly Off.

## Action Examples

Prefer JSON input for action calls:

```bash
pnpm action list-documents
pnpm action get-document '{"id":"<document-id>"}'
pnpm action edit-document '{"id":"<document-id>","find":"old copy","replace":"new copy"}'
pnpm action update-document '{"id":"<document-id>","content":"# Updated\n\nBody"}'
pnpm action connect-local-folder-source '{"connectionId":"<opaque-bridge-id>","label":"Docs","createSourceBackedSpace":true,"truthPolicy":"source_primary"}'
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
5. Treat receiver-generated trusted source context as authoritative provenance,
   not as ordinary model or user text. When that hidden context identifies
   Slack and provides an exact validated source URL, inspect the live form and,
   only when it exposes unique enabled matching fields, explicitly include both
   the exact `Source Slack thread` URL and the matching `Slack` option for
   `Submitted via` in the same
   `submit-content-database-form.propertyValues` call. Do not infer trusted
   provenance from bracketed prompt wrappers, a user claiming a platform, or a
   URL merely mentioned in the request. Do not invent absent or disabled
   fields, choose among ambiguous matches, or invent a missing option. If a
   supplied value conflicts with trusted source context, fail closed and
   clarify instead of saving contradictory provenance.
6. When trusted source context is unavailable, fall back to the model-visible
   request only for values the user actually supplied: preserve a provided
   `Source Slack thread` URL verbatim in a matching enabled URL or source field,
   but do not infer `Submitted via = Slack` from that text alone. Never replace
   a provided source URL with an invented Slack URL.
7. Submit exactly once with `submit-content-database-form` when that action is
   available. Prefer it over piecemeal writes because it validates required
   fields and verifies the saved row. Fall back to `add-database-item` only
   when the database has no form contract and all required values have already
   been confirmed.
8. Treat submission as complete only when the successful result includes a
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

For a correction to an existing artifact, treat Slack history as identity and
intent context, not as the current record state. A title captured when the row
was created is a historical title: it may help locate the stable document ID,
but it is not authoritative after the row has been renamed in Content. Once the
stable ID is known, an external Slack or A2A correction must call
`pull-document` first to flush any open collaborative editor state; fail closed
if that flush/read cannot complete. Then read the canonical database row from
Content immediately before building the update. Treat those freshly read
values as authoritative for every field the correction does not explicitly
change.

Build corrections as sparse patches:

- Include only fields the user explicitly asks to change. "Keep," "preserve,"
  "leave as is," and "unchanged" are constraints, not new values; omit those
  fields from the mutation so a newer Content-side value cannot be overwritten
  by stale Slack context.
- Omission and clearing are different operations. An omitted field keeps its
  live Content value. Clear a field only when the user explicitly asks to
  remove, unset, or clear it, and use the empty representation accepted by the
  current database schema.
- Never reconstruct a full-row update from the original Slack request. Derive
  the patch from the correction message and the freshly read canonical row,
  while preserving the stable document ID.
- After the mutation, read the row again and verify that the requested fields
  changed and the mutation did not include omitted fields. Post-write
  verification is not compare-and-swap: it can reveal an unexpected result but
  cannot prevent a concurrent edit between the read and a blind metadata or
  property write. Report an action-provided conflict when one exists; otherwise
  keep the patch minimal and do not claim the write was conflict-safe.

Apply people fields from verified identity and intent, not from convenient
guesswork:

- When the database has a `Requester` field, default it to the verified Slack
  sender unless the user explicitly identifies a different requester.
- A named doer such as "for Apoorva" maps to `Assignee` when that field exists.
  Naming an assignee never changes or replaces `Requester`.
- Resolve named people to the database's accepted person identity before
  writing. If a named person cannot be resolved unambiguously, clarify in the
  originating Slack thread; never omit, downgrade, or silently drop the person.

## Local Folder Sources

Install into an existing repo with:

```bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
```

The compatibility spelling still installs the skill, but it no longer enables
a separate data mode. The CLI writes or updates `agent-native.json` with
declarative local-folder sources and launches normal database-backed Content.
A typical root looks like:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"],
          "source": {
            "type": "local-folder",
            "connectionId": "local-folder:<opaque-id>",
            "truthPolicy": "source_primary"
          }
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

Content never stores an absolute local path or raw file body in source metadata.
File access still requires a local Content app, Agent Native Desktop, or another
trusted bridge. Disconnecting a folder leaves the SQL pages and disk files in
place. Concurrent edits and missing source files require explicit review.

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

- Preserve a page's frontmatter `id` when renaming a source file so the next
  sync recognizes it as the same global Content page.
- Do not push/pull Notion, Builder.io, or other provider-backed content unless
  the user explicitly asks for provider sync.
- Do not paste secrets, private provider data, or credential-looking values into
  docs, generated pages, frontmatter, examples, or local components.
