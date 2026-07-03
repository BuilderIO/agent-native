---
name: session-replay
description: Inspect, troubleshoot, and extend Analytics session replay recordings.
scope: dev
---

# Session Replay

Use this skill when working on `/sessions`, replay ingest, replay storage, or
agent answers about browser recordings in the Analytics template.

## Source Of Truth

- Replay ingest writes `session_recordings` and `session_replay_chunks`.
- The UI and agent must use `list-session-recordings`,
  `get-session-replay-summary`, and `get-session-replay-events`.
- `/sessions/:recordingId` is keyed by `session_recordings.id`, not
  `analytics_events.session_id`.
- Do not add actions that synthesize "sessions" from `analytics_events`.
  Events can be linked beside a recording through `session_id`, but they are not
  playable replay rows by themselves.

## Storage And Access

- Never expose object-storage URLs or raw `session_replay_chunks` rows to the
  browser or agent.
- Playback bytes must go through scoped server helpers that check
  `session-recording` access before reading private blob refs.
- SQL inline chunks are a local/dev fallback only; production should use
  private or encrypted blob storage.
- When sharing a replay with an external agent, use
  `create-session-replay-agent-link`. It mints a two-hour `agent_access` URL
  scoped to the recording, embeds a small SSR discovery payload on
  `/sessions/:recordingId`, and advertises
  `/api/session-replay/agent-context.json` plus bounded
  `/api/session-replay/agent-events.json` reads.
- Do not make session recordings public just so an agent can inspect them.
  Tokenized agent links are the intended handoff path.

## Capture Defaults

- Replay is off unless enabled by config/env.
- Consumers can enable replay directly with
  `configureTracking({ key, endpoint, sessionReplay: { enabled: true } })`.
- Agent Native templates already call `configureTracking()` in their roots;
  hosted template deployments can usually enable replay with Vite/Netlify env
  vars on the recorded site.
- Inputs are masked by default. Page text is visible unless marked with
  `.an-mask` or `data-an-mask`.
- Use `.an-block`, `.an-ignore`, `data-an-block`, or `data-an-ignore` for
  sensitive zones that should not be captured.
