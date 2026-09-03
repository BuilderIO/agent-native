# Document Behavior Reference

Non-obvious semantics for reading, describing, versioning, illustrating, and
sharing documents. Read this before doing focused work in one of these areas.

## Self-documenting descriptions

Descriptions are stable semantic guidance, not generated summaries of current
content. Preserve this distinction when reading or writing them:

- A page description explains why the page exists and what belongs there.
- A database description explains the collection's purpose and inclusion
  boundary. Inline and full-page views of one database share the same
  description.
- A property description explains what the field means and what value
  belongs there.
- A select, status, or multi-select option description explains when to
  choose that option.

Descriptions are owned; context is inherited. Never copy an ancestor's prose
into a child description. Focused reads expose a root-to-parent `contextPath`
so the agent can use ancestor guidance without creating stale duplicates.
Read the returned descriptions before placing content or setting property
values. Update a description only when the object's meaning changes, not
whenever its current content changes.

## `pull-document` vs `get-document`

**`pull-document` is the collab-aware "ingest the final" read** — prefer it
over `get-document` for external ingest (another app, an external coding
agent over MCP/A2A, an A2A peer). `get-document` returns whatever is in the
`documents.content` SQL column, which can lag behind a live editing session:
the open editor holds the authoritative Y.Doc in memory and only debounces it
back to SQL. `pull-document` closes that gap with a flush handshake — if a
live Yjs collab session exists for the document it writes a one-shot
`flush-request-<id>` application-state key (scoped to the browser session,
just like `navigate`); the open editor sees that key, serializes its current
document to markdown through its own existing serializer, calls
`update-document`, and writes an explicit request-id-matched success/error
acknowledgement. `pull-document` waits for that acknowledgement and fails
closed if the open editor cannot save; when no active human editor is
present, the SQL column is authoritative and the handshake is skipped. It is
GET + read-only + public-agent exposed (`requiresAuth: true`), returns
`{ id, title, content, format, deepLink }`, and surfaces an "Open document"
deep link for external agents. Use `--format text` for a plain-text strip of
the markdown.

## Versions

`list-document-versions` / `restore-document-version` operate on saved
document versions. There is no diff view — restoring replaces the current
content with the selected version's content wholesale.

## Image blocks

Documents support image blocks as markdown images: `![alt text](https://...)`.
The UI uploads local image files through the framework
`/_agent-native/file-upload` endpoint, with Builder.io as the recommended
storage path. If image upload fails because storage is not configured, tell
the user to connect Builder.io in Settings -> File uploads. Agents can add
images that already have a hosted URL by using `edit-document` or
`update-document` to insert markdown image syntax. Do not embed base64 image
data in document content.

## Sharing and visibility

Documents are **private by default** — only the creator can see them. To
grant access to others, change the visibility or add explicit share grants
using the framework-wide `share-resource` / `unshare-resource` /
`list-resource-shares` / `set-resource-visibility` actions (`resourceType`
`document`). See the `sharing` skill for the general access model.

Read (`get-document`, `list-documents`, `search-documents`) admits rows the
current user owns, has been shared on, or that match the resource's
visibility. Write (`update-document`, `edit-document`) requires `editor` role
or above; `delete-document` requires `admin` (owners always satisfy).

For Notion-style "workspace access but don't list it everywhere," set
`visibility` to `org` and then run `set-document-discoverability --id <id>
--hideFromSearch true`. Organization members can still open the document
with the link, but it is omitted from their Organization sidebar and
document search unless they own it or have an explicit share grant. Use
`--includeChildren true` (default) when hiding a page with sub-pages so
descendants do not leak into the org list.

Public documents are reachable at `/p/<id>` once visibility is `public`.
Anyone with the link can read the page. The public page mounts a read-only
agent chat with the document injected as context; public viewers must not
create, edit, comment on, delete, or share documents through that chat.
Private app documents (any visibility other than a deliberately public link)
are reached at `/page/<id>`.
