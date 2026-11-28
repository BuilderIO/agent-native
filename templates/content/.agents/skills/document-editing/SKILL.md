---
name: document-editing
description: >-
  How to create, read, update, and delete documents. Covers the document scripts,
  markdown content model, parent-child hierarchy, and position ordering.
---

# Document Editing

Documents are stored in the SQL database via Drizzle ORM. Each document has a
title, stable description, markdown content, optional parent (for nesting), and
a position for ordering. The description explains why the page exists and what
belongs there; it is not a changing synopsis of the current body.

When operating Content through a connected MCP server, call these actions
yourself; route work through `ask_app` only when delegating to Content's own
agent is the explicit point of the request. Reaching tools you can call
directly through `ask_app` adds a second interpretation of the request and
hides real errors.

## Scripts

Always use the dedicated scripts for document operations. Never use raw `db-exec` SQL.

In dev, call actions with `pnpm action <name>`; in production, call native
tools. Never use `curl`, raw HTTP requests, or `db-exec` with raw SQL for
document operations. `.env` is loaded automatically — never manually set
`DATABASE_URL` or other env vars.

### list-documents

List document metadata in a tree structure. This intentionally does not return full document bodies; call `get-document` for the one document you need to read. For the most recently edited documents, pass `--sort newest` and read the first page; request the next page only when you need more.

```bash
pnpm action list-documents
pnpm action list-documents --format json
pnpm action list-documents --sort newest --limit 5
```

### search-documents

Search documents by title and content. Results include snippets, not full document bodies; call `get-document` before editing or summarizing a specific result.

```bash
pnpm action search-documents --query "meeting notes"
pnpm action search-documents --query "project plan" --format json
```

### get-document

Get a single document by ID with full content and description. MCP callers read
the complete values from `structuredContent`; the text preview may be shortened.

Agent tool calls (in the app, in automation runs, over MCP, A2A or WebMCP) get
each property's `id`, `databaseId`, `name`, `type`, `description`, `options`
(option `id`, `name` and `description`), `value` and `editable`, but not the
editor's display settings, timestamps or option colors. The page body's own
Blocks field says `valueIsContent: true` instead of repeating `content`. Other
Blocks fields keep their `value`, and their `blocksField` is just
`{ fieldId, revision }`; read their blocks with `list-content-database-blocks`.
Pass `detail: "full"` for the editor's whole read; the CLI always gets it.

```bash
pnpm action get-document --id abc123
pnpm action get-document --id abc123 --format json
```

### create-document

Create a new document.

```bash
pnpm action create-document --title "Meeting Notes" --content "# Meeting Notes\n\nAttendees: ..."
pnpm action create-document --title "Sub Page" --parentId parent123
pnpm action create-document --title "My Page" --icon "📝"
pnpm action create-document --title "Research" --description "Evidence and source notes that support the current project"
pnpm action create-document --title "Placeholder 1" --spaceName "Foobar"
```

If the result has `creativeContextProjectionStatus: "pending"`, the Page is
already committed. Retry the same arguments with the returned `id` to repair
its Creative Context projection; do not create another Page.

When a user asks for a Page in an interactive Content conversation, creation is
not a complete handoff. After `create-document` succeeds, call `navigate` with
the returned document `id`, then call `view-screen` and compare its document ID
with the create result. Navigation is asynchronous: if `view-screen` still
reports the previous Page, repeat `navigate` and `view-screen` up to two more
times. Say the Page is open only after the IDs match. If they never match, say
the Page was created but navigation could not be verified. Do not navigate for
background, batch, or API creation unless the caller explicitly asked to open
the result.

Whether or not you navigate, link every Page you created in your reply, by its
title and the `urlPath` from the result (`[Meeting Notes](/page/<id>)`). Content
sends a reply that leaves one out back to you once with the exact links.

When the user names a workspace ("in my Foobar workspace"), pass `spaceName`
(or a `spaceId` from `list-content-spaces`). A named workspace that does not
resolve is an error, never a silent fall back. With no `parentId`, `spaceId`,
or `spaceName` the page is created in the caller's Personal workspace, so read
the returned `spaceId` before telling the user where the page landed. The
Workspaces catalog is not a create target: its rows only list workspaces, and
`add-database-item` against it is rejected.

### update-document

Update a page's or database's metadata while preserving omitted fields. To
replace its guidance, pass only `id` and `description`; an empty string clears
the description. For a database, use its backing `documentId`, not its collection
`databaseId`. The saved description is returned in MCP `structuredContent`.
Agent responses contain metadata only; `get-document` returns the body.
This does not change the Markdown body; body edits use `edit-document`.

### import-content

Turn Markdown files the user hands over into new pages. Prefer it to
`create-document` whenever the source is a file: it takes the title from
frontmatter or the first heading, keeps the original file, uploads referenced
images, records "Imported from <file>" in History, and names everything that
did not come across.

```bash
pnpm action import-content --dryRun true --parentId abc123 --files '[{"name":"guide.md","text":"# Guide\n..."},{"name":"logo.png"}]'
pnpm action import-content --dryRun false --parentId abc123 --idempotencyKey guide-1 --files '[{"name":"guide.md","text":"..."},{"name":"logo.png","url":"https://..."}]'
```

Run the dry run first and tell the user each page's `status` and `notes`
before applying. Applying fails with `IMPORT_IMAGE_NOT_UPLOADED` until every
image, PDF, or CSV named in `uploads` has a `url`; leave a file nobody can
supply out of `files`, and its references become visible placeholders on the
page. Images embedded as `data:` URLs are stored privately, readable by
whoever can read the page; one whose bytes aren't the image type it names
fails the apply with `IMPORT_IMAGE_INVALID` before any page is created. Other
formats come back in `skipped` as not supported yet.

A Notion export's files keep their paths from the zip (`Page <id>.md`,
`Page/Subpage <id>.md`). The import strips Notion's ids from titles, nests
each subpage under its page (`parentSourceName` in the dry run), keeps
callouts and toggles, and points links between pages at the new pages.
Notion's signed file links are fetched and stored on apply, images privately
like embedded ones; one that can't be fetched stays a link that lapses, noted
as `expiring-link-not-rehosted`. Databases are not imported yet: they come
back in `databases` with their row count, and their CSV is kept only when a
page links to it. A dry-run page with `alreadyImportedAt` was imported from
the same text before and is still out of Trash; applying again makes new
pages, so ask first. The Import dialog reads the `.zip` itself; an agent
passes the files inside it.

Pass an
`idempotencyKey` on every apply, and reuse it only to retry the same files,
with the same image `url`s, into the same place. `IMPORT_INCOMPLETE` means
some pages landed before a failure: its `details` name the `importId` and
created page ids (with `documentIdsComplete: false`, more may exist), and the
same call again finishes the import. `IMPORT_PAGE_TRASHED` means the import
was undone or its pages trashed; restore them, or import with a new key.

`undo-content-import --importId <id>` moves the import's pages to Trash. It
needs only editor access, not the admin access `delete-document` needs,
because it moves only pages the caller imported that nobody has changed since.
It refuses with `IMPORT_PAGE_CHANGED` when a page was edited, moved, or given
child pages since; ask before using `delete-document` instead.
`IMPORT_IN_PROGRESS` means the import is still adding pages; undo it again once
it finishes. While the Import dialog is open,
`view-screen` returns `contentImport` with its status, destination, file
names, and counts, never file contents. `import-content-source` is unrelated:
it syncs a connected local folder.

### edit-document

Surgically edit document content using search-and-replace. **Preferred over `update-document --content` for modifications** — sends only the changed text instead of regenerating the entire document.

```bash
# Single edit
pnpm action edit-document --id abc123 --find "old text" --replace "new text"

# Delete text
pnpm action edit-document --id abc123 --find "delete me" --replace ""

# Batch edits
pnpm action edit-document --id abc123 --edits '[{"find":"old","replace":"new"},{"find":"also old","replace":"also new"}]'
```

External MCP, WebMCP, tool, and A2A callers pass a `baseRevision` and one stable
`idempotencyKey`. The base comes from `get-document` for a page you haven't read,
from `create-document` for a page you just made, or from the previous edit's
`receipt.revisions.after`. A receipt with outcome `applied` and
`readback.verified` already confirms the saved body, so don't read the page again
to check it; read it again after any other outcome or an error. When the returned body is
literally empty, pass non-whitespace `initializeContent` instead of `find` or `edits`.
Initialization rejects whitespace-only and all other nonempty bodies, preserves
the Markdown bytes exactly, and safely replays an identical retry.

Some pages take body writes through their live copy, the copy open tabs edit.
Only pages Content owns outright take it: a page linked to a local file,
Notion, GitHub or Builder, a shared copy of a local file, and a row of a
collection someone made stay on the legacy writer. Every page is also a row of
its space's Files collection, which doesn't count. `edit-document` writes those
bodies, and so does `set-document-property` for a primary Blocks field, which
is the page's body. Other writers, such as `update-document --content`, a
collection block stored in the body, row migrations, and Notion or Builder
syncs, refuse with `LIVE_BODY_WRITER_UNSUPPORTED` (409) and change nothing in
Content. Retrying that writer won't help: make the body change with
`edit-document` where it can, or tell the user which action refused and on which
page. When the refusal's `details` name a Notion page (`remotePageId`) or a local
file (`sourcePath`), that copy already changed; say so. A local-folder sync that
would link such a page to a file, or a folder disconnect or accepted file
deletion that would relink it to another folder's file, refuses with
`LOCAL_FILE_LINK_SWITCHED_PAGE` (409) and changes nothing.
`import-content-source` lists that file in its `errors` and imports the rest.
You can't switch the page back, so tell the user which page and file it was.
`LIVE_BODY_WRITE_PATH_CHANGED` means the page switched while the write was in
flight; read the page again and retry.
Before a version restore, a move to another space, or a `pull-document`, the
open editors of such a page that can save a title alone are asked to save it;
its body is already in the live copy. `OPEN_EDITOR_TITLE_NOT_SAVED` (409,
`retryable: true`) means one of them didn't confirm that save or couldn't make
it. The restore, move or pull didn't go ahead, and titles the editors saved
stay saved: retry, and if it refuses again, tell the user the open
editor of page `details.documentId` didn't save its title. A move to another
space refuses with `PAGE_TITLE_CHANGED` (409, `retryable: true`) when a page's
title changed after its editors saved it; nothing moved, so retry. A page
deleted while its editors saved the title refuses with `DOCUMENT_NOT_FOUND`.
When editors were asked, a restore or move result's `titleFlush`, or a pull
result's `editorFlush.titleFlush`, lists each page's editors. One with
`flush: "unconfirmed"` couldn't be asked, so a title it hadn't saved yet may be
missing; tell the user.

A page in Trash refuses edits with `DOCUMENT_NOT_FOUND`, the same way
`get-document` refuses to read it, including a page moved to Trash while the
edit commits. Restore it before editing. A local-folder sync
(`import-content-source`) leaves a page in Trash unchanged and lists it in
`skipped`.

### edit-table

Change one table on a page without rewriting it: everything the table's row,
column and block menus do, plus setting a cell's text. Read the page first and
pass its `baseRevision` and a fresh `idempotencyKey`, as for `edit-document`.
`table` numbers the page's tables from 1 in page order, counting each
`<table>` block and Markdown pipe table, including those inside toggles,
callouts and columns. Rows and columns also count from 1; row 1 is the header
row when the table has one.

```bash
pnpm action edit-table --id abc123 --baseRevision "$REV" --idempotencyKey add-row-1 --table 1 \
  --operations '[{"op":"insert-row","cells":["Gamma","**Done**"]},{"op":"set-color","row":4,"color":"green_bg"}]'
```

Operations run in order, each on the table the ones before it left:
`insert-row` / `insert-column` (`at` is the new one's number; omit it to add at
the end; `cells` fills it), `delete-row` / `delete-column`, `move-row` /
`move-column` (`to` is its number after the move), `duplicate-row` /
`duplicate-column`, `clear-row` / `clear-column` (empties cells, keeps colours),
`set-cell` (`text` is one line of inline NFM; `<br>` breaks a line),
`set-header-row` / `set-header-column` / `set-fit-page-width` (`value`), and
`set-color` (a `row`, a `column`, or both for one cell; `color` is a colour or
one ending in `_bg`, or `null` to clear). A pipe table comes back as a
`<table>` block with the same content. The result is `edit-document`'s receipt
plus `table`, the table's new size and settings (`null` when nothing was saved). Read the page just before
editing: if it changed since, the edit can refuse with `STALE_BASE_REVISION`
and `details.currentRevision`; read it again and resend. A change the table
already has refuses that way whenever the page has moved on. A table it can't
find exactly on the page, or whose text holds lines a table can't keep, refuses
with `TABLE_NOT_LOCATED`; change that table with `edit-document`.

### update-document

Update an existing document's metadata or browser-owned content. External
callers use the revisioned `edit-document` protocol for every body change. A
script, CLI call or automation that replaces the body passes the `baseRevision`
`get-document` returned (that read's `updatedAt` as `baseUpdatedAt` also
works): with neither, the write refuses with `BASE_REVISION_REQUIRED` (400),
and if the page changed since that read it fails with
`DOCUMENT_REVISION_CONFLICT` (409), carrying the page's
`details.currentRevision`, and writes nothing.

```bash
pnpm action update-document --id abc123 --title "New Title"
pnpm action update-document --id abc123 --baseRevision "<revision from get-document>" --content "# Updated Content\n\nNew text here"
pnpm action update-document --id abc123 --baseRevision "<revision from get-document>" --title "New Title" --content "New content"
pnpm action update-document --id abc123 --description "Stable guidance for what belongs on this page"
```

A page in Trash refuses `update-document` (except a favorite toggle),
`restore-document-version` and a Blocks value set with `set-document-property`,
with `DOCUMENT_NOT_FOUND`, like `edit-document`.

### Suggested edits

When the user asks to **suggest**, **propose**, or **leave changes for review**,
do not call `edit-document` or `update-document`. Read the current Page with
`get-document`, then call `suggest-document-edit` with the Page's `id`, its
`baseRevision`, a fresh `idempotencyKey`, and the exact `find` text plus the
`replace` Markdown (omit `replace` to propose deleting the text). `find` must
match the page's current text exactly once. Content builds the tracked change
and anchor server-side; the page stays unchanged until a reviewer accepts.
The action separates disjoint punctuation and word changes into independent
review edits. Its result gives the first `suggestionId`, all `suggestionIds`,
and a `proposalId`. To add another
find/replace call to that proposal, pass its `proposalId`, the same `summary`,
and a fresh `idempotencyKey`. Retry the same call with its original key.
An unchanged replacement creates no suggestion and reports an error.
Inside tables, callouts, toggles, and columns, suggest text: edit a cell, or
edit or add a paragraph in a callout, toggle, or column. Keep each `find`
within one cell or one frame, and make one call per cell. A `find`/`replace`
that changes text on both sides of a cell or frame edge, adds or removes
table rows or cells or a column, or changes a callout's icon, a toggle's
title, or an image, fails with `suggestion_structure_unsupported`.

When an edit answers a comment, as when the user asks you to address a page's
open comments, pass that comment's `id` from `list-comments` as `commentId`, so
its suggestion card links to the comment. Make a separate call for each comment.
The comment must be open and on the page body: a resolved one fails with
`SUGGESTION_COMMENT_RESOLVED`, one on a Property or in another Blocks field tab
with `SUGGESTION_COMMENT_NOT_ON_BODY`, and an id not on the page with
`SUGGESTION_COMMENT_NOT_FOUND`. If the edit answers such a comment anyway, leave
`commentId` off.

Use `suggest-document-edit` for every suggested body edit. The generic
`create-resource-suggestion` action remains for advanced proposals that build
typed Page-body operations by hand: `resourceType: "document"`, adapter kind
`content.document-markdown`, the Page's `revision` (or exact `updatedAt`) as
`baseRevision`, a fresh `idempotencyKey`, and one operation carrying the
complete current and proposed Markdown in `before.markdown` and
`after.markdown`, the changed segment in `changedText`, and an `anchor` object.

Use `list-resource-suggestions` to inspect pending and historical proposals.
Only accept or reject when the user has asked for that decision and the caller
has editor authority. A suggestion's author may instead withdraw their own
pending suggestion with comment access (`decision: "withdrawn"`); withdrawn
suggestions leave the Page unchanged and drop out of review. Call
`decide-resource-suggestion` with a fresh idempotency key and the suggestion's
`baseRevision` as `observedBase`. An accept that fails with `suggestion_stale`
didn't land because the text around it changed; the Page is unchanged and the
suggestion stays pending, so tell the user which suggestion it was instead of
counting it as accepted. Suggested edits are
unavailable for local-file, source-owned, externally linked, or trashed Pages,
Collection Pages, Pages with inline databases, and collection-item Pages without
an accessible primary Blocks field.

People can also suggest edits in a collection page's other Blocks field tabs.
Those suggestions use adapter kind `content.blocks-field-markdown`: each
operation's `targetId` is the field's ID, and `baseRevision` reads
`blocks-field:<fieldId>:<revision>`. Decide one as above; accepting it writes
only that field. `suggest-document-edit` suggests on the page body only.

```bash
pnpm action suggest-document-edit --id abc123 \
  --baseRevision 'body:0:sha256:…' --idempotencyKey '<uuid>' \
  --find 'Exact current sentence.' --replace 'Proposed replacement sentence.'
```

### delete-document

Move a page and all its sub-pages to Trash. IDs, bodies, hierarchy, and
collection membership remain intact so the subtree can be restored. A Trash
root becomes eligible for automatic deletion after 30 days in Trash, counted
from when automatic deletion started for Pages already in Trash then. A daily
job deletes eligible roots, so deletion can come a little later. A sub-page
trashed on its own keeps its own 30 days, and restoring a page then trashing it
again starts its 30 days over. Agents pass the page's exact `updatedAt` from `<current-screen>` or a fresh read, plus an
idempotency key. A conflict means the page changed: read it again before
deciding to trash it. Collection pages use `delete-content-database` instead.

```bash
pnpm action delete-document --id abc123 \
  --expectedUpdatedAt '<updatedAt>' --idempotencyKey '<uuid>'
```

Before those 30 days pass, restore the receipt's `trashRootId` with its
`trashedAt` (also listed by `list-content-trash`), or permanently delete it
sooner, only after it is in Trash:

```bash
pnpm action restore-document --id abc123 \
  --expectedTrashedAt '<trashedAt>' --idempotencyKey '<uuid>'
pnpm action plan-content-trash-purge --mode selection --documentIds '["abc123"]'
pnpm action permanently-delete-document --id abc123 --planId '<reviewed plan ID>' --scopeToken '<opaque plan token>'
```

Permanent deletion requires the exact `planId` and `scopeToken` returned by
`plan-content-trash-purge`. Inspect the plan's affected and blocked items before
executing it; if Trash changes after review, create and inspect a new plan.

`list-content-trash` and a matching-mode plan (`filters.where`) take the Trash
page's filter chips as `where`: people, workspace, location, type, and a deleted
date range, combined with `and` or `or`. A scope-mode plan ignores filters,
`where` included, and covers the workspace's whole Trash. One plan holds one
workspace's pages, so emptying Trash or deleting a selection that spans
workspaces plans once per workspace. A plan fails with `invalid_scope` in a
workspace where you are only a viewer, even for pages you own there.

The `content-trash` application state stores the chips as `where`. The
`content-trash-purges` state holds one `purgeStarts` record per planned
workspace: plan id, idempotency key, status (`started`, `failed`, or
`unknown`), the plan's input, and operation id once known. `unknown` means the
start request may have been accepted. Executing the same plan with the same key
returns the original operation instead of starting another. Without the scope
token, send `recover: true` with the plan id and key: it returns the operation
that key started, fails with `start_pending` while the plan could still start
(retry later), or with `start_expired` once it never can (plan again).

## Comments

Comments are Notion/Google-Docs-style **inline comments**. Selecting text and commenting leaves the passage **highlighted inline** via a ProseMirror decoration overlay — nothing is written into the markdown body, so the document round-trips unchanged. Each thread stores the quoted text plus surrounding context (`anchorPrefix`/`anchorSuffix`) and an approximate `anchorStartOffset`, so the highlight follows the text as the document is edited, disambiguates repeated text, and degrades gracefully (the thread stays in the sidebar) when its text is deleted.

Pass `quotedText` exactly as the page reads: text from one block, without Markdown syntax such as `**`, backslash escapes, or a link's URL (quote `docs`, not `[docs](https://…)`). `add-comment` refuses a quote the saved page or tab doesn't have (`comment_quote_not_found`), since its thread would have no highlight; drop the Markdown, or quote a shorter run from one block, and retry.

Resolving a thread clears its highlight and moves it to a collapsible **"Resolved (n)"** sidebar section, from which it can be **reopened**. Comments support **@mentions** of org members and agents. Keep the readable `@Name` in `content` and pass `mentions` in text order: `{"kind":"person","email","name"}` or `{"kind":"agent","model","name"}`. One entry covers every `@Name` of one person; when two people share a name, the k-th `@Name` is the k-th entry with that name. `add-comment` and `update-comment` reject a malformed list, or an entry no `@Name` in `content` reaches, with a 400. The app draws each matched name as a pill when it stands alone, followed by a space or punctuation (`@Sam,` matches, `@Samantha` does not); an `@Name` in inline code, a Markdown link, or a URL is not a mention. A name with no entry stays plain text. An AI comment records its model, thinking effort, and agent conversation automatically.

On a collection page, each Blocks field tab has its own comments. Pass `fieldId` to `add-comment` to start a thread in a field's tab; `quotedText` and the anchor fields then come from that field's text. Field IDs are the Blocks-type properties `get-document` returns, and `navigation.fieldId` names the tab the person has open (none means the first tab). Omitting `fieldId`, or passing the primary field's ID, means the page body. Replies stay in their thread's tab, so leave `fieldId` off a reply. `fieldId` and `propertyId` can't be combined. `list-comments` and `list-content-database-comments` return `field_id` and `field_name` (the field's name when the thread started) on each comment; a null `field_id` is the page body. When a field is deleted, its threads stay listed under the saved name and can still be resolved, but have no highlight. Ask AI works on a tab's threads as on the body's: it reads that tab's text, and any change it makes there is a suggestion on that tab, never applied straight.

A thread can sit on a whole video instead of on text. Pass `blockId` with the video's `id` attribute from `get-document`'s content (`<video src="…" id="video-…">`), plus `fieldId` for a video in another tab. The thread quotes no text; people see it beside the video, and `list-comments` returns `block_id` and `block_type` on it. A video saved without an `id` has none to pass: give it a new unique `video-` id with `edit-document`, then comment with that id. `add-comment` refuses the id such a video goes by until then (`comment_block_id_unsaved`), because that id passes to another video when videos with its source are added or reordered. Each video's `id` is its own: when you copy a `<video>` line, give the copy a new unique `video-` id or none. An edit that gives a second video an id the page already uses is refused (`DOCUMENT_VIDEO_ID_SHARED`); a new page isn't checked, since no thread is on it yet. Videos that already share an id show none of its threads, and `add-comment` refuses that id (`comment_block_id_shared`); give the video you mean a new id with `edit-document` first. Never give it a `block_id` from `list-comments`; one no video carries may be a deleted video's, and reusing it moves that thread onto this video. A thread made before videos had ids quotes the word "Video"; on a page with exactly one video it shows on that video, and with more it stays on its quote.

People can also start a thread on a whole image or audio clip from its Comment button. `list-comments` returns it with `block_type` `image` or `audio` and a `block_id` derived from the file and how many copies of that file come before it on the page; nothing writes that id into the content. You can't start one: `add-comment` refuses those ids (`comment_block_id_unsaved`), so quote text beside the image instead. Replacing the file, or adding or removing a copy of the same file above it, moves the id, so the thread then shows on no block or on whichever copy now has the id.

A comment can carry up to five images (PNG, JPEG, GIF or WebP, 10 MB each), such as a screenshot of what a person means. `list-comments` returns them as `attachments` (`{url, name, contentType}`) on each comment. Each `url` is a private `/api/private-media/<id>` path that needs Content's sign-in, so over MCP or the CLI the result also has `privateMediaLinks`: `links` pairs each `src` (an attachment's `url`) with a `url` you can open, and every link stops working at `expiresAt`. Open them to see what the comment points at. An image loads only for people who can read the page and for its uploader, and stops loading for others once its comment is deleted or the page goes to Trash. You can't attach an image: `add-comment` and `update-comment` take only images the writer uploaded to this page from the comment box, and refuse others (`comment_image_not_attachable`). An `update-comment` without `attachments` leaves a comment's images as they are; `attachments: []` removes them.

A Clip block (`<ClipEmbed recordingId="…" />`, behind the `content.clip-embed` flag) keeps its comments in Clips, so `list-comments` never returns them and every page holding that Clip shows the same ones. People see each open thread as its own card beside the Clip, at its moment of the video. `list-clip-comments` returns a Clip's open threads in the order of their moments, with replies; `add-clip-comment` starts a thread at `videoTimestampMs` (milliseconds from the start of the video) or replies with a `threadId` from that list; `resolve-clip-comment` resolves a thread, which Clips lets only the thread's author and the Clip's editors do (`clip_forbidden`). Writing needs comment access to the page. Clip comments take no `mentions` and no Ask AI, and Content sends no email for them. When the Clip's comments are off, every write fails with `clip_comments_disabled`, and so does reading for anyone but the Clip's owner.

```bash
# List threads (returns anchor fields + parsed mentions)
pnpm action list-comments --documentId abc123

# Plain comment on the document
pnpm action add-comment --documentId abc123 --content "Looks good"

# Inline-anchored comment with a mention
pnpm action add-comment --documentId abc123 --content "@Sam check this" \
  --quotedText "the second paragraph" --anchorPrefix "above " --anchorSuffix " here" \
  --anchorStartOffset 120 --mentions '[{"kind":"person","email":"sam@x.com","name":"Sam"}]'

# Comment on text in another Blocks field's tab
pnpm action add-comment --documentId abc123 --fieldId prop456 --content "Tighten this" --quotedText "the opening line"

# Comment on a whole video, by its id attribute in get-document's content
pnpm action add-comment --documentId abc123 --blockId video-a1b2c3d4 --content "Trim the intro"

# Reply to a thread (threadId is the thread's root comment ID)
pnpm action add-comment --documentId abc123 --threadId t123 --parentId c123 --content "Agreed"

# Resolve / reopen the whole thread
pnpm action update-comment --id c123 --resolved true
pnpm action update-comment --id c123 --resolved false

# A Clip's comments: list, start one at 0:42, reply, resolve
pnpm action list-clip-comments --documentId abc123 --recordingId rec456
pnpm action add-clip-comment --documentId abc123 --recordingId rec456 --videoTimestampMs 42000 --content "Cut this pause"
pnpm action add-clip-comment --documentId abc123 --recordingId rec456 --threadId cc789 --content "Done"
pnpm action resolve-clip-comment --documentId abc123 --recordingId rec456 --threadId cc789 --resolved true
```

`--authorName` sets the comment's display name; it defaults to a name derived from the author's email.

A new comment emails the document owner, earlier authors in the thread, and anyone mentioned, unless they turned those emails off. An edit that mentions someone new emails only that person. The current user's own switch is `get-content-notification-prefs` and `update-content-notification-prefs --emailNotifications=false`, the same one Settings shows on Notifications. Share invites always send.

### Webhooks

A webhook sends a signed POST to a public HTTPS URL, with no username or password in it, when something changes on a collection's rows (`--databaseId`) or on one page (`--documentId`). Events are `property.changed` (one per changed property, with old and new value; select options also carry `oldLabel`/`newLabel`), `comment.created`, and `comment.resolved`. `--propertyIds` limits `property.changed` to those properties. Managing webhooks takes admin access to the collection or page, and a person approves each registration, every time.

```bash
pnpm action create-content-webhook --databaseId db123 --url https://example.com/hook \
  --events '["property.changed","comment.created"]' --propertyIds '["prop456"]'
pnpm action list-content-webhooks --databaseId db123   # recent deliveries, never the secret
pnpm action delete-content-webhook --id wh_abc
```

`create-content-webhook` returns the signing secret once. Requests follow Standard Webhooks: `webhook-id` is the event ID, `webhook-timestamp` is Unix seconds, and `webhook-signature` is `v1,` + base64 HMAC-SHA256 of `{id}.{timestamp}.{body}`, keyed with the base64-decoded secret after `whsec_`. The body is `{ id, type, occurredAt, webhookId, sequence, documentId, databaseId, actor: { kind: "human" | "agent", email }, data }`. A comment event's `data.content` is the comment's Markdown and `data.contentText` the same comment as plain text. Any 2xx acknowledges. Text values over 16,000 characters and comments over 2,000, as Markdown or as plain text, are cut short, with `data.truncated: true`; read the page for the rest. Delivery is at least once: a failure is retried for about 28 hours with the same `webhook-id` and body, so receivers dedupe on it; for one property on one page, a larger `sequence` is the later change. Events can arrive out of order, for example when one is retried, so compare `sequence` rather than trusting arrival order. A URL whose host is or resolves to a private, internal, or Tailnet (100.64.0.0/10) address is refused, at registration and again before each send, and events stop if the webhook's creator loses admin access. While the page or collection a webhook watches, or the row an event came from, is in Trash, its events wait, and they go out if it's restored; its webhooks can still be listed and removed meanwhile, but a new one needs it out of Trash. Permanently deleting the page or collection a webhook watches removes the webhook and its secret within about a minute. After a webhook is removed, a request that was already on its way can still arrive. A collection's webhook sends nothing from a row whose page its creator can't open. `property.changed` comes from edits to a value, including clearing it. Changes that remove values without editing them send nothing: deleting a property, a type change that clears its values, and deleting rows or pages. Imports, source syncs, row creation, duplication, row migrations, Blocks fields, Notion comment sync, and reopening a thread don't send events yet either. A receiver that mirrors a collection should re-read it from time to time rather than rely on events alone.

### Property generations

Every property on a page has a generation that goes up each time its value changes, including a change that returns to an earlier value (A → B → A). `get-document` and each `get-content-database` item return `propertyGenerations: { [propertyId]: number }`, empty properties included. Blocks fields, computed fields and the Files view's Parent and Source fields aren't stored values, so they have no generation or change ID. `set-document-property` returns the generation its write produced as `generation`, and `property.changed` events carry it in `data.generation`. Its `properties` are read just after the write, with their own `propertyGenerations` and `propertyChangeIds` from the same read, so a write that landed in between shows there. Row receipts from `update-database-item` and `patch-database-items` carry `readback.propertyGenerations` and `readback.propertyChangeIds` for every property on the row after the write, cleared ones included; a patch receipt's `propertyValues` still lists only the properties it patched. Compare generations for equality only, since they come from one shared counter. Deleting a value outright, for example by a type change that clears a field, moves that property's generation too; the page's other properties keep theirs.

To act on a value only while it is still the one you read, pass it back: `set-document-property --expectedGeneration`, or `expectedPropertyGenerations: { [propertyId]: number }` on `update-database-item` and on each `patch-database-items` row. If any named value has changed since, nothing is written and the call fails with `PROPERTY_GENERATION_CONFLICT` (409), listing `{ propertyId, expected, current }`. Reread and decide again. `expectedRowRevision` can't catch this case, because it hashes values. Blocks fields use their own revision instead. Name only properties listed in `propertyGenerations`: a row write that names any other property, one the collection doesn't have or a field with no generation, writes nothing and fails with `PROPERTY_NOT_GUARDABLE` (400), listing its `propertyIds`.

To act once per change, key on the change ID, not the generation. `get-document` and each `get-content-database` item return `propertyChangeIds: { [propertyId]: number | null }`, read from the same row as each value. `set-document-property` returns its write's `changeId`, row receipts carry `readback.propertyChangeIds`, and `property.changed` events carry `data.changeId`, so a poller and a webhook receiver see the same ID for the same change. It changes only when that property's value is written anew, and it's `null` when the property has no stored value. While a value is stored, its change ID equals its generation; an empty property has no change ID but still has a generation, so guard writes with `propertyGenerations`.

### refresh-list

Trigger the UI to refresh the document list.

```bash
pnpm action refresh-list
```

Always run this after any document modification to update the sidebar.

`create-document`, `update-document`, and `delete-document` already signal a UI
refresh, so in practice only call `refresh-list` directly if you mutate
documents another way and the UI doesn't update.

## Document Schema

| Column        | Type    | Description                            |
| ------------- | ------- | -------------------------------------- |
| `id`          | text    | Primary key (12-char hex string)       |
| `parent_id`   | text    | Parent document ID (null for root)     |
| `title`       | text    | Document title (default: "Untitled")   |
| `description` | text    | Stable semantic guidance for the page  |
| `content`     | text    | Markdown content                       |
| `icon`        | text    | Emoji icon (optional)                  |
| `position`    | integer | Sort order within parent (0-based)     |
| `is_favorite` | integer | Whether document is favorited (0 or 1) |
| `created_at`  | text    | ISO timestamp                          |
| `updated_at`  | text    | ISO timestamp                          |

### Related Tables

Documents live in the SQL `documents` table via Drizzle; the framework injects
the live column schema separately, so this covers only semantics the schema
can't convey:

- `document_shares` holds per-user/per-org grants with a `viewer`, `editor`,
  or `admin` role.
- `document_versions`, `document_comments`, and `document_sync_links` all
  carry `owner_email` so a workspace can upgrade from local mode to a real
  account without losing history, comments, or Notion links.
- A collection is a normal document (`content_databases` +
  `document_property_definitions`) whose rows are also documents, linked
  through `content_database_items`. Row pages are omitted from the ordinary
  sidebar tree — they're reached through the collection view.

Documents are **private by default**; use `share-resource` /
`set-resource-visibility` (`resourceType document`) to change access.

## Content Format

Documents use **markdown** for content. The editor renders markdown in real time.

### Inline code

Text between backticks is literal, as in standard Markdown: `` `<br>` `` is the
text `<br>`, not a line break. To break a line inside inline code, close the
code first, as the editor writes it: `` `first`<br>`second` ``.

### Math

Content renders LaTeX with KaTeX while preserving the source in NFM. Use the
canonical Content delimiters when an agent creates or edits math:

```md
Inline math: The relationship is $`E = mc^2`$ in this example.

Block math:

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$
```

- Inline math uses ``$`...`$``. Do not substitute ordinary `$...$`; dollar
  amounts in prose are intentionally not interpreted as equations.
- Block equations use `$$` on their own lines before and after the LaTeX.
- Keep the raw LaTeX intact when editing around an equation. Invalid or
  unsupported expressions remain visible as source so they can be repaired.
- Markdown exports preserve these delimiters. HTML and PDF-ready exports render
  the equation.

### Code blocks

A code block is a fenced block whose info string is its language, such as
` ```ts `; leave the language off to have the editor guess its colors.

- A block whose long lines wrap says so after its language:
  ` ```ts {wrap="true"} `, or ` ``` {wrap="true"} ` without one. Keep the
  attribute when rewriting the block, and add it only when the user asks for
  wrapped lines.
- Markdown exports keep the attribute, which other Markdown tools ignore.
  Notion has nowhere to keep it, so a Notion-linked page keeps it locally.

### Diagrams

A Mermaid diagram is a fenced code block whose language is `mermaid`. Its
source is the diagram, so it stays the editable copy.

- Write a new diagram as a `mermaid` code block, and change a diagram by
  editing its source.
- Never replace a diagram's source with a picture: no image you render,
  generate or upload (SVG, PNG, screenshot), and no other block type. Don't add
  a title or caption the source doesn't have. Swap the source out only when the
  user asks for an image instead of the diagram.
- The editor draws a Mermaid code block as its diagram and opens the source
  when the user clicks it, so a diagram the user asks to see only needs valid
  source. If the source has a syntax error, the block shows it beside the
  source; fix it there. Public pages show the source as code.

### Interactive HTML

An interactive HTML block is a fenced code block whose language is
`html interactive`. Its source is a whole HTML page that runs where the block
sits, in a frame that can reach nothing but itself:

````md
```html interactive
<title>Tap counter</title>
<button id="tap">0</button>
<script>
  tap.onclick = () => tap.textContent++;
</script>
```
````

- Write one when the user asks for something to click, drag or play with: a
  calculator, an explorable chart, a small game. Keep text, tables, diagrams and
  charts that only need reading in their own blocks. A plain `html` code block
  stays code.
- Give it a `<title>`. It is the block's caption, and the words of its link
  wherever the block can't run.
- Inline `<script>` and `<style>` work. Scripts, stylesheets and fonts load only
  from `https://cdn.jsdelivr.net` (`/npm/<package>@<version>/<file>`; pin the
  version). Images load from `/api/private-media/<id>`, `data:` addresses and
  the deployment's allowed hosts.
- Nothing else works, by design: no `fetch`, storage, cookies, parent page,
  popups, dialogs, nested frames or links to other pages. Keep state in
  variables.
- The block is as tall as its content, up to 1,000px, and scrolls past that; it
  also opens full screen, so make the layout fill what it is given and follow
  `prefers-color-scheme`.
- Change it with small `edit-document` find/replace edits, like any text. The
  page runs the new version as soon as the edit saves.
- A write that adds or changes a block that can't work is refused with
  `INTERACTIVE_HTML_BLOCK_REFUSED`, which says what to change. Nothing is saved,
  so fix the block and send the whole write again.
- "Make this button blue" means the selected block: `view-screen` returns its
  `interactiveBlock` with `title`, `blockId`, and `number`, which counts the
  page's `html interactive` fences from 1.
- `get-document` and `pull-document` list the page's `interactiveBlocks`, each
  with the `url` that opens it full screen. Give people that `url`, and match a
  block link a person gives you to its `blockId` there. They list the page's
  body; a block in another Blocks field runs but has no link.
- A block runs on its own on pages its reader owns. Other readers, public ones
  included, click Run.
- HTML and PDF exports and Builder get the caption linked to the block. That link
  is how a body pulled back from Builder finds its block again. Markdown keeps
  the source. For Notion, see `notion-integration`.

### Analytics charts

An `<AnalyticsChart … />` block is a copy of one Analytics dashboard panel (a
line, area, bar, combo, pie or funnel chart, a metric, or a table) with the
rows Analytics returned for the editor who added or last refreshed it, drawn
with the dashboard's own chart. Readers see only those numbers; Content never queries a data source, and the
block links back to the panel. When people paste a panel's copied link
(Copy link on the panel in Analytics) into a page they can edit, Content does
the same steps below for them.

To add one, call `capture-analytics-chart` with `documentId` and the panel's
`link` (or `dashboardId`, `panelId` and `filters`). It checks you can edit
the page, has Analytics run the panel as you, and returns
`analyticsChartTag`. Put that tag in the page with `edit-document` as its own
block, exactly as returned; never write or change an `AnalyticsChart` tag's
data by hand. To refresh a chart, call it again with `purpose: "refresh"` and
the chart's `id` from `get-document` as `blockId`, then replace the old tag
with the new one.

Saving the page records which dashboards its charts come from, so each
dashboard's Cited in list in Analytics shows the page.
`list-analytics-chart-citations` with a `dashboardId` lists the pages you can
open that hold its charts.

Who can open the page and who can open the dashboard can differ:

- `needs_confirmation` means more people can open the page than the
  dashboard. Tell the person, and call again with
  `acknowledgeWiderAudience: true` only if they agree.
- `analytics_chart_wider_than_dashboard` means the copy can't go in this page:
  the page is public and the dashboard isn't, or the panel is a table (tables
  list named customers and accounts) and the page reaches more people than the
  dashboard. Don't work around it; narrow the page's sharing or ask the person
  to share the dashboard more widely in Analytics.
- Sharing a page more widely asks first when it holds charts from narrower
  dashboards. Sharing it, moving it into a space, or duplicating it is
  refused (`analytics_table_wider_than_dashboard`) when a table would reach
  more people than its dashboard. A share with someone outside the
  organization counts as reaching everyone.
- `analytics_chart_unreadable` means the page holds an `AnalyticsChart` tag
  that no longer reads as a chart, so it can't be shared more widely. Ask the
  person to remove it or add the chart again from Analytics.
- `analytics_chart_too_large` means the copy is too long to hand you as a tag.
  Ask the person to paste the panel's link into the page instead.

Analytics refusals (`analytics_refused`, such as a dashboard the person can't
open) come back with Analytics' own reason; pass it on.

### Link cards

A `<LinkCard app="design" url="…" />` block shows a link to a design, a
Slides deck, or a Clips recording (`app` is `design`, `slides` or `clips`) as
a card. The page stores only the app and the link. Each reader's card asks the
owning app for the item's title as that reader, so someone who can't open the
item sees the app's name and the link, and Markdown, HTML and PDF exports
carry the plain link. When people paste such a link alone on a line of a page
they can edit, Content makes the card for them; a link to one Design screen
becomes a pinned picture instead (see Design screens), and a link that carries
a token or key, such as a Clips agent link, stays a plain link. To add a card,
write the tag with `edit-document` as its own block; never put a title in it.

### Design screens

A `<DesignScreen … />` block is a picture of one Design screen at one width,
as Design rendered it for the editor who pinned or last refreshed it, stamped
with when and by whom, and linked back to the screen. The picture is one of
the page's private images, so it loads only for people who can open the page.
Readers who can open the design also see when the screen changed in Design
since the picture and how many open comments it has. When people paste a
screen's copied link (Copy link on the screen in Design) into a page they can
edit, Content does the same steps below for them.

To add one, call `capture-design-screen` with `documentId` and the screen's
`link` (or `designId` and `screenId`), and a `width` only when the person asks
for one. It checks you can edit the page, has Design render the screen as you,
keeps the picture with the page, and returns `designScreenTag`. Put that tag
in the page with `edit-document` as its own block, exactly as returned; never
write or change a `DesignScreen` tag by hand, and never point its picture at
another image. To refresh a screen, read its tag with `get-document` and call
it again with `purpose: "refresh"`, the tag's `id` as `blockId`, its
`design.id` as `designId`, and its `screen.id` and `screen.width` as
`screenId` and `width`, then replace the old tag with the new one.

- `design_screen_board_link` means the link opens a whole board. Ask for one
  screen's link (Copy link on that screen).
- `needs_confirmation` means more people can open the page than the design.
  Tell the person, and call again with `acknowledgeWiderAudience: true` only
  if they agree.
- `design_screen_wider_than_design` means the page is public and the design
  isn't, so the screen can't be pinned there. Don't work around it; narrow the
  page's sharing or ask the person to share the design more widely in Design.
- Sharing a page more widely asks first when it pins screens from narrower
  designs; it never refuses for them.
- `design_screen_storage_unavailable` means Content has nowhere private to
  keep the picture. Pass the message on: the person connects file storage in
  Settings.

Design refusals (`design_refused`, such as a design the person can't open or
a screen with live effects) come back with Design's own reason; pass it on.

## Parent-Child Hierarchy

Documents form a tree via `parent_id`:

- Root documents have `parent_id = null`
- Child documents reference their parent's `id`
- Deleting a parent recursively deletes all children
- Position determines ordering within the same parent

To reorganize the tree, move each subtree with `move-document` using ids from
a prior action result. When the plan calls for a target page that does not
exist yet — a new section, a grouping page — create it first with
`create-document` and use the returned id as `parentId`.

Descriptions are owned; context is inherited. `get-document` and `view-screen`
return the focused page's own description plus a computed root-to-parent
`contextPath`. Use that path to understand where the page lives, but never copy
ancestor descriptions into the child. Collection, property, and option
descriptions narrow the guidance further when working with structured values.

## Screen Context And IDs

Screen context is auto-included as a `<current-screen>` block on every message —
check it before acting instead of calling `view-screen` by default. Call
`view-screen` explicitly only when that snapshot is truncated or doesn't yet
reflect something that changed earlier in the same turn (for example, right
after `create-document` or `navigate`).

IDs for edits always come from `<current-screen>` or a prior action result —
never guessed.

When a move or edit target does not exist yet, create it first and use the
returned id. A rejection saying `not found` means the id is absent: create the
missing page or list documents to find the right id. Never retry the same id
or invent a similar-looking one — fabricated ids cannot resolve, and repeated
failures stop the run.

| User request              | What to do                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| "What am I looking at?"   | Answer from `<current-screen>` (call `view-screen` only if truncated)                                               |
| "Create a page about X"   | `create-document`, then `navigate --documentId <returned id>` and verify with `view-screen`                         |
| "Fix a typo / small edit" | ID from `<current-screen>`, `edit-document --id ... --find "old" --replace "new"`                                   |
| "Delete this page"        | ID and `updatedAt` from `<current-screen>`, `delete-document --id ... --expectedUpdatedAt ... --idempotencyKey ...` |

## Common Tasks

| User says                    | What to do                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| "Create a page about X"      | `create-document`, then `navigate --documentId <returned id>` and verify with `view-screen`   |
| "Describe what belongs here" | `update-document --id ... --description "..."`                                                |
| "Find my meeting notes"      | `search-documents --query "meeting notes"`                                                    |
| "Fix a typo / edit a line"   | `view-screen` to get ID, then `edit-document --id ... --find "old" --replace "new"`           |
| "Rewrite this document"      | `view-screen` to get ID, then `update-document --id ... --content ...`                        |
| "Delete this page"           | `view-screen` for ID and `updatedAt`, then `delete-document` with both and an idempotency key |
| "Add a sub-page"             | `create-document --title "Sub" --parentId <parentId>`                                         |
| "Import this Markdown file"  | `import-content --dryRun true`, report losses, then `--dryRun false`                          |
| "Import my Notion export"    | Pass the zip's files with their paths; dry run, report losses and `databases`, then apply     |
| "Add this Analytics chart"   | `capture-analytics-chart --documentId ... --link ...`, then `edit-document` with the tag       |
| "Pin this Design screen"     | `capture-design-screen --documentId ... --link ...`, then `edit-document` with the tag         |
| "What links to this page?"   | `list-backlinks --documentId ...` lists the pages you can open that link to or mention it     |
| "Show me the document tree"  | `list-documents`                                                                              |

Always run `refresh-list` after any create, update, or delete operation.

## Reference Files

- **`references/document-behavior.md`** — self-documenting descriptions,
  `pull-document`'s collab-flush handshake vs `get-document`, versions, image
  blocks, and the sharing/visibility model (`/page/<id>` vs `/p/<id>`,
  discoverability, the read-only public chat). Read it before touching
  descriptions, external ingest, or a document's visibility.
- **`references/databases.md`** — full behavioral reference for Content
  collections: property types, Blocks fields (what people call tabs, page
  tabs, document tabs, or sections on a row's page), and every view type
  (table, list, gallery, board, calendar, timeline, form). Read it before
  building or modifying collection views, properties, or forms, or when someone
  asks about a page's tabs.

Also read on demand, outside this skill:

- `references/local-file-mode.md` in the `content` skill — local folder
  sources, Builder Symbol/source-component preservation, local MDX components.
- The `notion-integration` skill — connecting, sync, conflicts, the read-only
  database-source pilot, and the raw Notion provider API path.
- The **Comments** section above — inline anchor-tracked threads, @mentions,
  resolve/reopen.
