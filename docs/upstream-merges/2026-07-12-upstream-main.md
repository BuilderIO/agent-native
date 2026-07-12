# Upstream merge — 2026-07-12

| | |
| --- | --- |
| Branch | `safe/main3` |
| Merge commit | `81f09ea2e` |
| Upstream ref | `upstream/main` @ `7dcb2ad36` |
| Merge base | `8fd422495` |
| Commits brought in | 313 upstream (52 touching `templates/clips`) over 81 fork commits |
| Conflicts resolved | 45 files, all semantically (no blanket accept-ours/theirs) |
| Verified | `tsc` clean · `cargo check` clean · migrations apply on boot · recording page / editor / library smoke-tested in browser |

## Clips changes pulled from upstream

### Upload & media reliability (largest theme)

- Streaming uploads by default with a resumable-upload provider
  (`server/lib/resumable-upload-provider.ts`); parallel chunk uploads; camera
  released immediately on stop.
- Recordings flip to **ready only after storage actually serves the media**
  (verify-before-ready). Directly relevant to the local
  file-never-created data-loss incident (U92eti8J6xym).
- Upload retry metadata and recovery chunks preserved across attempts;
  failed buffered chunks cleared for hosted uploads.
- **Background video compression**: Builder compress-media job
  (`server/jobs/builder-media-compression.ts`) plus a dark-launched media
  worker (`server/lib/media-worker.ts`, callback route). Off by default,
  gated by `CLIPS_MEDIA_WORKER_ENABLED` / `CLIPS_MEDIA_WORKER_URL` /
  `CLIPS_MEDIA_WORKER_SECRET`, kill switch
  `CLIPS_DISABLE_BUILDER_COMPRESSION` (see `.env.example`).
- `trim-recording` got a compare-and-swap retry loop (concurrent edit
  safety). Fork's `hidden` cut mode was threaded through it.
- Permanent delete now cleans up S3 media objects
  (`server/lib/recording-media-cleanup.ts`).
- Post-finalize work moved to a background dispatch worker
  (`server/lib/post-finalize-dispatch.ts` + `_agent-native-background` route).
- Fixes: first-play startup, playback progress start/finish events, wrong
  duration for paused fullscreen recordings, no-audio-track videos handled,
  clear message for unplayable formats.

### Sharing & viewers

- **"Viewed by" per-view log**: `recording_views` table (fork migrations
  51–53), `list-clip-views` action, `viewed-by-popover.tsx` behind the view
  count.
- **Temporary agent share links**: `create-recording-agent-link` — share a
  private clip with an external agent without making it public.
- **Shared-with-me collection**: `/shared` route + "Mit mir geteilt" nav;
  `navigate --view=shared` exposed to the agent.
- Share popover z-order fix; shared pages recover from transient video
  errors; agent share links appear as soon as the share menu opens.

### Transcripts & AI

- Automatic transcript **retry after transient failures** (`retry_count`
  column — fork migration 50) plus stale-pending presentation in the public
  agent context (woven with the fork's editsJson exclusion filtering).
- **Per-user AI/cleanup preferences**: `clips-ai-prefs.ts`,
  `get/update-clips-ai-prefs` actions, `user-prefs` routes.
- AI tools can include the full video, not just the transcript.
- Auto-chapter regeneration opens in the matching agent chat.
- Transcripts line up with video start after trimming.

### Dictation

- **Personal dictation dictionary** (learned vocabulary biasing speech
  recognition; Dictate-tab manager, `remove-vocabulary-term` action,
  `vocabulary-section.tsx`).
- **Paste last dictation** (⌘⌃V / tray menu, `paste_last_dictation`
  command); Esc cancels an in-progress dictation; double-tap for hands-free
  mode; faster local Whisper start (prewarmed context).
- Upstream's dictation insert refactor (shared `insert_text_for_frontmost`,
  clipboard save/restore) merged **with the fork's delivery modes winning**:
  paste-and-copy still deliberately leaves the transcript on the clipboard.

### Meetings

- Mic-not-transcribed fix; stale-meeting sweeper job; calendar event
  classification; ad-hoc Zoom join detection (popover offers to take notes);
  time-remaining + end-meeting control; **search inside meeting
  transcripts**; calendar reconnect fix; Granola-style "how to trigger
  meeting notes" guide.

### Desktop app & Chrome extension

- First-launch permissions walkthrough; manual update check; pending update
  no longer blocks recording; countdown dims the screen; device refresh when
  the popover opens; Bluetooth headphones no longer forced into call-quality
  mode; mic noise reduction and louder mic-only captures; stuck mic
  selection fix; custom record shortcut start/stop.
- Chrome extension: recordings survive tab refresh, keep the selected
  microphone, copy the clip link after saving, device labels in menus,
  continue after permission grants.

### Mobile

- 16:9 player layout with actionable controls (adopted for the fork's
  recording page around `EditVersionReview`).

### Architecture

- `app/components/ui/*` became re-exports of the new
  **`@agent-native/toolkit`** package (see resolution notes below).
- Substantial test suite added across actions/server/components
  (`*.test.ts` / `*.spec.ts`) — the fork now inherits it.

## Conflict-resolution decisions (fork policy)

- **`ui/*` components**: fork's Plastic 3D implementations kept as local
  overrides of the toolkit shims (shadcn ownership model). Components the
  fork never styled became toolkit re-exports. `radio-group` restored as a
  shim after the merge deleted it while a fork file still imported it.
- **DB migrations**: fork keeps versions 45–49 (already applied to existing
  databases: video projects, editor assets, annotations, edit versions, raw
  transcript columns); upstream's four new migrations renumbered 50–53.
  Future upstream migrations must keep being renumbered after the fork's
  highest applied version.
- **Clips editor**: fork's Descript-style timeline wins wholesale (upstream
  built a simpler parallel zoom system — dropped); upstream's scroll clamp
  and zoom bounds adopted.
- **Recording page**: upstream's side-panel restructure and mobile wrapper
  adopted; fork's `EditVersionReview`, Activity-tab `AnnotationsStrip`, and
  synthesize-edit-plan suggestion ported into it.
- **Desktop popover**: fork's per-clip pending-upload stack
  (retry/export/discard per row) kept, renamed to upstream's
  `onDismiss`/`dismissingUploadId` prop contract; upstream's single-latest
  banner dropped.
- **Rust tray**: fork's marker hotkeys, sink watchdog, multi-segment
  consolidate guard, and `product_name()` branding woven with upstream's
  upload-finished events, dictation refactor, and mic-description error
  copy.
- **Lockfile**: taken from upstream, regenerated with `pnpm install` after
  `package.json` resolution.

## Follow-ups

- [ ] Re-localize upstream's new i18n keys — they shipped with
  `(Lokalisiert)`-style placeholders across de/es/fr/ja/ko/pt/zh-CN — and
  refresh the fork's German meetings strings whose upstream meaning changed
  (`meetings.intro`, `meetings.requiredForReminders`,
  `meetings.noMeetingsDescription`).
- [ ] Rebuild the desktop tray to pick up merged Rust changes.
- [ ] Review merged app on `safe/main3`, then decide promotion to the main
  line.
- [ ] Consider enabling the dark-launched media worker / compression once
  the upstream worker endpoint story is clear.
