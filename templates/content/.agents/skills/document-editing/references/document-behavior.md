# Document Behavior Reference

Non-obvious semantics for reading, describing, versioning, illustrating, and
sharing documents. Read this before doing focused work in one of these areas.

## Self-documenting descriptions

Descriptions are stable semantic guidance, not generated summaries of current
content. Preserve this distinction when reading or writing them:

- A page description explains why the page exists and what belongs there.
- A collection description explains the collection's purpose and inclusion
  boundary. Inline and full-page views of one collection share the same
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
live Yjs collab session exists for the document it writes a request to each
editing browser session's `flush-request-<id>` application-state key
(scoped to the session, just like `navigate`), naming the editors it asks.
In the prepare phase each editor saves its document through
`update-document` and answers under its own request-matched key with
`prepared` and a claim of what it saved, or `changed` or `error`. Once
SQL holds every claim, a verify phase with a fresh token confirms each editor
answers `verified`, unchanged across that read. After each answer the editor
reads its mailbox every half second until the next phase arrives, rather
than waiting for a sync poll that can be seconds away. `pull-document` waits up
to 20 seconds and fails closed if an open editor cannot save; when no active
human editor is present, the SQL column is authoritative and the handshake
is skipped. On a page that takes body writes through its live copy, the tabs
already wrote the body, so the request carries `scope: "title"` and goes
only to editors that advertise `canFlushTitle`. Each marks its prepare
answer `taken`, saves its title alone, then replaces the mark with
`prepared` and the title it saved; the server prepares again until SQL holds
that title, then verifies. With no such editor open, the handshake is
skipped. A missing or failed answer fails with
`OPEN_EDITOR_TITLE_NOT_SAVED`. `pull-document` is
GET + read-only + public-agent exposed (`requiresAuth: true`), returns
`{ id, title, content, format, deepLink }`, plus `editorFlush.titleFlush` when
such editors were asked, and surfaces an "Open document"
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

## Video uploads become Clips

While the `content.clip-embed` flag is on, a video a person uploads, drops, or
pastes into a page becomes a private Clip bound to that page instead of a file
in Content's storage. The page holds `<ClipEmbed … origin="upload" />`, and
the Clip is visible to exactly the people who can see the page. The browser
sends the file straight to Clips, and only the page's editors can upload.

An outside agent holding a video file uploads it the same way with
`create-video-upload`, an MCP-only action (the app's own agent has no files to
send). The agent picks a new random `uploadKey` for the file, such as a UUID.
The action checks you can edit the page and returns `chunkUrl`, `headers`,
`chunkSizeBytes`, `totalChunks`, `clipEmbedTag`, and a `next` line with the
steps: POST the file's chunks to Clips in order with `headers`, the last with
`isFinal=1`, sending a chunk again on a network failure, a 429 or a 5xx, and
the last one again while it answers `upload_finishing`; then put
`clipEmbedTag` in the page with `edit-document`. Clips refuses a chunk typed as
form data or text, which is what curl's `--data-binary` sends unless given a
`Content-Type`. To start the same file again after a failed call or a
lost answer, send the same `uploadKey`, so Clips makes one Clip. When it
answers `storage_required` or `too_large`, nothing was uploaded; tell the
user.

- Clips takes MP4, WebM, and MOV. Another video type is refused with a
  message naming those, and an empty file as a video that didn't upload;
  neither leaves a block.
- When Clips can't take the file yet (free clips used up, no storage, or no
  Clips account), the file waits in the video block with setup links that open
  Clips in a new tab. Point the user at those links; the upload carries on by
  itself when they come back. Nothing is in the page until it starts.
- `view-screen` returns `clipUploads.uploads` while this tab is sending a file
  or Clips is making the Clip. Each upload has `recordingId`, `documentId`,
  `fileName`, `phase` (`uploading`, `making`, or `failed`), and `percent`.
  An upload whose block has been gone from the page for a few seconds drops
  out of `clipUploads`, whatever its phase, and once the page is closed in
  that tab, only an upload it is still sending stays, until its sending ends.
- Keep a Clip block in place while its file sends, or while Clips waits for
  storage before making the Clip: once the block has been
  gone for those few seconds, the uploading tab cancels the upload in Clips
  and says so, even when the page closed in that time, and the person picks
  the file again. It does the same when the
  editor loses edit access before the block is in place. If Clips already had
  the whole file, the Clip stays, and the tab says it was saved, with Open in
  Clips.
- An upload whose file stopped sending is cancelled in Clips and shows "This
  upload didn't finish", which its editors can remove. When Clips doesn't
  confirm a cancel, the tab says so. Clips fails such an upload about an hour
  later, as it does one whose tab closed mid-upload.
- With the flag off, video uploads use Content's file storage as before.

## Sharing and visibility

Documents are **private by default** — only the creator can see them. To
grant access to others, change the visibility or add explicit share grants
using the framework-wide `share-resource` / `unshare-resource` /
`list-resource-shares` / `set-resource-visibility` actions (`resourceType`
`document`). See the `sharing` skill for the general access model.

A page's sub-pages go public with it and leave public with it, as in Notion.
When `set-resource-visibility` makes a page public, every sub-page under it
(at any depth, with the same owner, not in the trash) becomes public too, in
the same all-or-nothing change; when it makes the page private or org-visible
again, the sub-pages still public follow it, including ones in the trash, so a
restore can't bring back a public page under a private one. `followersChanged`
in the result says how many sub-pages changed, and `list-resource-shares` returns
`publicFollowers` to the page's owner and admins (with `publicFollowersMore`
when there are more than 500). Tell the user how many sub-pages a public
change carries. A change that would carry more than 500 is refused with
`too_many_followers`: change a few sections on their own first, then the
page. Every other change (private to org and back) touches only the requested
page, so set those page by page. Sub-pages created later copy their parent's
visibility when they're made. This is
distinct from `set-document-discoverability`, whose `includeChildren` option
controls search/sidebar listing (not link or organization access).

Public pages (`/p/<id>`) carry `noindex`, so search engines don't list them;
link previews in Slack and elsewhere still work.

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
