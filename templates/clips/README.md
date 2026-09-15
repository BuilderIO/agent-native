# Clips

An open-source, agent-native alternative to Loom, Granola, and Wispr Flow rolled
into one app. Screen recording, calendar-synced meeting notes, and push-to-talk
voice dictation — all transcribed, searchable, and yours to own.

**Live app: [clips.agent-native.com](https://clips.agent-native.com)**

The agent transcribes, titles, summarizes, and indexes everything you capture,
then lets you ask "find the clip where we discussed the rollout plan" across every
transcript. Shared clips are agent-readable: paste a share link into an agent and
it can read the transcript and see timestamped frames without the raw video.

## Features

- Screen recording with webcam overlay, audio capture, and pause/trim.
- Calendar-synced meeting recordings with AI summary, notes, and action items.
- Push-to-talk (Fn-hold) dictation with searchable history and vocabulary biasing.
- Auto-generated titles, summaries, and chapter markers for every recording.
- Full-text search across recordings, meetings, and dictations in one library.
- Sharing with per-clip permissions, agent-readable links, and Slack unfurls.
- Chrome extension for capturing browser logs with a recording.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips needs a video storage backend (Builder.io or an S3-compatible bucket)
before recordings can upload — see the docs for setup.
Full docs: [agent-native.com/docs/template-clips](https://agent-native.com/docs/template-clips).
