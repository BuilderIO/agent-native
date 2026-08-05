# Upstream merge — 2026-08-05

| | |
| --- | --- |
| Branch | `main` |
| Upstream ref | `upstream/main` @ `8158433ef` |
| Merge base | `7dcb2ad36` (the 2026-07-12 sync) |
| Commits brought in | 809 upstream over 132 fork commits |
| Conflicts resolved | 52 files, all semantically (no blanket accept-ours/theirs) |
| Verified | template `tsc` clean · template vitest 1159/1159 · desktop `cargo check` clean · desktop vitest 160/160 · core `pnpm build` clean |

## Toolchain

- Upstream moved to **pnpm 10.29.1** (lockfile v9, catalogs). Homebrew's pnpm 8
  shadows the corepack shim — run installs with the nvm bin first in PATH or
  `corepack pnpm`, and consider `brew unlink pnpm`.
- New workspace packages consumed by core: `@agent-native/toolkit`,
  `@builder.io/ai-utils`.

## Headline upstream changes (clips)

- **Custom ScreenCaptureKit capture engine** (`custom_capture.rs`):
  AVAssetWriter fragmented-MP4 writer with **live upload during recording** —
  most bytes stream to the server while recording; stop drains the tail and
  finalizes. Architecturally removes the stop→upload gap and the
  moov-at-finalize fragility behind the fork's segment-rollover footage
  losses. Abandoned live sessions reset stale chunks before re-upload.
- Upload robustness: upload leases (`upload-lease.ts`, migrations
  upload-attempt/generation fences), verify-before-ready now returns served
  byte counts, `verificationPending` state threaded through recorder + pages.
- Whisper model catalog rework (`whisper_model.rs` commands + settings hook
  UI), engine-level mic-echo suppression, offline file transcription.
- Rewind extension (clip "started here" provenance), default recording
  visibility setting, agent view tracking (`recording_agent_views`),
  playback positions table, meetings share-transcript flag.
- Same-bug convergences with the fork (upstream version adopted): the
  post-finalize worker 401 publicPaths bypass (their exact-path variant),
  bounded `view-screen` transcript previews, cross-tab SSE leader election
  (their hosted-gateway-aware superset replaced the fork's implementation),
  transcript-cleanup compare-and-swap guarded write.

## Fork policy calls made in this merge

- **DB migrations renumbered**: fork owns 45–49 (video projects, editor media
  assets, annotations, edit versions, raw transcript snapshot — now named per
  upstream's naming convention). Upstream's new 49–58 became **54–63**.
  `db.spec.ts`'s hardcoded viewer-key version updated to 53 (fork numbering).
- **Fork kept the Groq BYOK speech-to-text fallback** that upstream removed
  (Builder-only upstream). The Groq provider helpers (`pickProvider`,
  `resolveKey`, `SpeechToTextResponse`, `failEmptyProviderTranscript`) were
  restored beside upstream's new heartbeat/preserve flow, and Builder
  transcription runs wrapped in both upstream's pending-heartbeat and the
  fork's recording-scope credential resolution.
- **Fork's Descript-style editor timeline won** (filmstrip, zoomAround,
  annotation bands, strip context menu) with upstream's Rewind feature,
  duration-scaled track width, and split-point handles threaded through.
  Plastic-3D `global.css` design system kept wholesale.
- **Fork kept**: word-level whisper timestamps (max_len=1 + sentence
  grouping; upstream's per-segment probability gate adapted to utterance
  level so it can't punch word holes), dictation delivery modes
  (paste-and-copy leaves clipboard), marker hotkeys ⌥⇧M/E/B/N,
  `large-v3-turbo-q8_0` model + prewarm gating (via serde alias for the
  renamed config field), 45 s stop-drain, virtual-mic-device filtering,
  tray diag events (re-threaded into the live-upload stop path with a
  `live` flag), sink watchdog, SCK start timeout, 2560px capture cap,
  1200 kbps transcode bitrate floor, scaled transcode timeout, annotations
  everywhere upstream restructures touched them (`view-screen`,
  `add-comment` anchoring + upstream's second-flooring applied after),
  amber "still working" stuck-notice UX (upstream's `verificationPending`
  folded into its guard; upstream's recovery-state variables reduced to
  real failures), `list-recordings` raw-sql meetings exclusion (fixes the
  CLI dual-drizzle stack overflow; upstream's builder-subquery test
  assertion inverted accordingly), backup-transcription opt-out setting and
  cleanup default-off, extensions sidebar section (restored after the
  auto-merge silently dropped its render), `videoProjects` i18n sections.
- **i18n**: key-level 3-way merge across all 11 locales; the fork's calm
  "still working" copy survived; upstream rewording superseded fork
  translations for `retryFromClipsMenu` (all locales) and
  `passwordSetPlaceholder`/`downloadRecording` (7 locales — placeholder
  style, needs re-translation follow-up).

## Known follow-ups

- Re-translate `passwordSetPlaceholder` / `downloadRecording` in
  de/es/fr/ja/ko/pt/zh-CN.
- The live-upload capture engine likely subsumes several fork pipeline
  mitigations (client transcode timing, final-chunk patience); revisit
  after real-world runs. Desktop app needs a rebuild + reinstall to pick
  all of this up.
- Fork's `SCK_START_TIMEOUT` and mic-preference helpers still compile but
  should be re-validated against the custom capture backend's start path.
