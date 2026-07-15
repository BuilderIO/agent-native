---
name: video-projects
description: >-
  The full multi-track video editor ("video projects") — multi-source
  compositions built on the vendored Remotion Editor Starter. Use when working
  on /video-projects routes, the add-recording-to-video-project flow, project
  persistence, editor asset uploads, or when the agent needs to inspect or
  modify a project's composition.
---

# Video Projects — The Full Editor

## What it is

Video projects are multi-track compositions that combine **multiple sources**:
Clips recordings, uploaded b-roll (images/video/GIFs), music/audio, text,
solids, and caption tracks. They complement — not replace — the simple
per-recording editor (`video-editing` skill): the simple editor stays the fast
path for trimming one clip; a video project is for composing.

The editor UI is the vendored Remotion Editor Starter at
`app/video-editor/editor/` (paid-licensed third-party source — do not copy it
into other repos or publish it separately). Clips-specific glue lives in
`app/video-editor/clips/` and the vendored seams are marked with
"Clips modification" comments.

## Data model

- **`clips_video_projects`** (ownable + shareable, registered as
  `video-project`):
  - `state_json` — the editor's serialized `UndoableState`:
    `{ tracks[], items{}, assets{}, fps, compositionWidth, compositionHeight,
    deletedAssets[] }`. Canonical types:
    `app/video-editor/editor/state/types.ts`. `""` = new empty project.
  - `pending_imports_json` — server→client handoff queue of recording imports
    (see below). The client materialises entries and clears the queue.
  - `source_recording_ids` — provenance list of imported recording ids.
- Recordings are referenced by URL (`/api/video/:recordingId` — the authed,
  Range-capable media proxy); **bytes are never copied** into the project.

## Actions

| Action | Purpose |
| --- | --- |
| `create-video-project` | New empty project |
| `list-video-projects` | GET — accessible projects, newest first |
| `get-video-project` | GET — full state for one project |
| `update-video-project` | Rename, persist `stateJson`, clear pending imports |
| `delete-video-project` | Soft delete (trash) |
| `add-recording-to-video-project` | Queue a recording as a source; creates the project when `projectId` omitted |
| `list-editor-media-assets` | GET — the user's previously uploaded b-roll/music (metadata index) |
| `delete-editor-media-asset` | Remove an entry from that index (file/projects untouched) |
| `save-video-project-export` | Create a ready library recording from a rendered export URL |

`add-recording-to-video-project` flags: `respectEdits` (default true — imports
the simple editor's kept ranges as sequential timeline items, subdivided at
split markers so each clips-editor segment arrives as its own item),
`includeCaptions` (maps `recording_transcripts` segments to a caption track,
remapped to edited time).

## How the editor loads and saves

1. Route `app/routes/video-projects.$projectId.tsx` fetches
   `get-video-project`, then mounts
   `app/components/video-projects/video-project-editor.tsx`, which sets a
   module-level **bridge** (`app/video-editor/clips/bridge.ts`) before
   rendering the vendored `<Editor/>`.
2. The vendored persistence (`app/video-editor/editor/state/persistance.ts`)
   reads/writes through the bridge → `update-video-project`. Autosave is
   debounced (`app/video-editor/clips/auto-save.tsx`); Cmd+S / the Save button
   also work.
3. Pending imports are consumed on load by
   `app/video-editor/clips/pending-imports.tsx` (client-side, because the
   vendored state helpers own the item shape), then cleared via
   `update-video-project --clearPendingImports`.

## Agent editing of compositions

- Read a project with `get-video-project`; `view-screen` shows a composition
  summary when the user has a project open (`view: "video-project"`,
  `projectId`).
- For small tweaks to `state_json` prefer `db-patch` (surgical find/replace on
  the JSON column). For full rewrites use `update-video-project --stateJson`
  with the **complete** document. Never write fragments.
- If the user has the project open in the editor, their autosave may overwrite
  concurrent agent writes — prefer editing while the project is closed, or
  tell the user to reload.
- `navigate` supports `{ "view": "video-projects" }` and
  `{ "view": "video-project", "projectId": "..." }`.

## Asset uploads and the recent-sources index

Editor uploads (b-roll, music) go through `PUT /api/editor-assets`
(`server/routes/api/editor-assets/`) → framework `uploadFile()` (Builder.io
Connect or S3-compatible). No storage configured + hosted mode → clear 424
error; local dev falls back to inline data URLs for small files. Fonts are
served from the vendored Google-Fonts DB via `GET /api/editor-fonts/:name`.

Each provider upload also records a **metadata row** in
`clips_editor_media_assets` (filename, MIME, size, URL — never bytes). That
index powers the toolbar's "Recent sources" popover
(`app/video-editor/clips/recent-assets-button.tsx`), which re-adds an asset
by URL without re-uploading, and the `list-editor-media-assets` action.
Deleting an index entry never touches the stored file or projects using it.

## Export (client-side rendering)

`FEATURE_RENDERING = true`, implemented with **@remotion/web-renderer**
(WebCodecs + Mediabunny) in `rendering/render-state.ts` — upstream's Remotion
Lambda transport was replaced; no site deploys, no AWS. Notes:

- `FEATURE_NEW_MEDIA_TAGS = true` is required: the web renderer supports
  `@remotion/media` `<Video>`/`<Audio>` but not `<OffthreadVideo>`/
  `<Html5Audio>`.
- Fonts are collected per-composition via `/api/editor-fonts` (never import
  the multi-MB fonts database in the browser — it throws by design).
- The whole export flow lives in one dialog
  (`app/video-editor/clips/export-dialog.tsx`), opened from the prominent
  Export button in the top action row (plus a second entry point in the
  composition inspector): format choice → cancelable progress → inline
  preview of the result with labeled **Save to library** / **Download**
  buttons. Save uploads through `/_agent-native/file-upload` and calls
  `save-video-project-export`, which creates a ready `recordings` row —
  sharing/embeds/comments/transcription work on exports for free. The
  render core is `app/video-editor/clips/render-composition.ts`.
- Rendering is single-threaded in the user's tab (keep it open; background
  tabs throttle) and needs WebCodecs (`canRenderMediaOnWeb` gates with a
  clear error). Remotion Lambda remains a possible hosted fast-path later.

## Deliberately disabled upstream features

- `FEATURE_CAPTIONING = false` — upstream used OpenAI Whisper; Clips never
  transcribes via OpenAI. Captions come from Clips transcripts at import time.

## Rules

1. Never mutate `state_json` through `db-exec` UPDATE with hand-built JSON —
   use `update-video-project` or `db-patch`.
2. Keep the vendored `app/video-editor/editor/**` diff minimal; put Clips glue
   in `app/video-editor/clips/` and mark unavoidable vendored edits with a
   "Clips modification" comment. Upstream updates re-vendor cleanly only if
   the seams stay small.
3. Recordings must stay referenced by proxy URL. Do not download/re-upload a
   recording's bytes into project assets.
4. Projects are user-authored resources: writes require `assertAccess(
   "video-project", id, "editor")`; deletes require `admin`.
