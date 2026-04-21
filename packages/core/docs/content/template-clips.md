---
title: "Clips Template"
description: "Agent-native screen recording with AI transcription, auto-titles, summaries, chapter markers, and full-text search across every clip."
---

# Clips

Clips is an agent-native screen-recording app. The user records a video, the app transcribes it, and the agent takes over: suggests titles, writes summaries, builds chapters, finds the exact moment someone said X, opens the right recording, shares it with the right teammate, drafts replies to comments.

Think Loom, but the agent is a first-class editor — and the recordings are yours, not a SaaS vendor's.

## What it does {#what-it-does}

- **Record your screen.** Built-in recorder with webcam overlay, audio capture, and pause/trim.
- **Auto-transcribe.** Every recording is transcribed on upload. Speaker turns, timestamps, searchable.
- **Agent-generated metadata.** Titles, summaries, chapter markers, tags — the agent fills them in and keeps them current.
- **Full-text search.** Query across every transcript in your library. "Find the clip where we discussed the rollout plan."
- **Share links.** Per-clip permissions (public, team, private), link tracking, comments threaded with the agent in the loop.
- **Smart library.** Group by project, filter by speaker, auto-tag based on content.

## Why it's interesting {#why}

Three things make the Clips template a good showcase of what agent-native enables:

1. **The agent edits the transcript.** Fix a mis-transcribed word, generate chapter timestamps, pull quotes for a blog post — all in natural language, in the chat, with the UI updating live via polling.
2. **Context awareness on recordings.** When you're viewing a clip, the agent knows the clip id, the current playhead, and the selected transcript range. Ask "summarize from here to the end" and it understands what "here" means.
3. **Clips you own, not a vendor.** Unlike Loom, the recordings live in your storage, the transcripts live in your SQL, and the agent is yours. Fork the template, change how chapters get built, wire it to your own CDN — it's your code.

## Naming note {#naming-note}

In the template, always say **"Clip"** in user-facing strings and agent messages — never "Loom." Internal table / variable names (`recordings`, `recording_transcripts`, etc.) stay as-is.

## Scaffolding {#scaffolding}

```bash
pnpm dlx @agent-native/core create my-clips --template clips --standalone
```

Clips is a larger template with a native recorder (it ships a desktop companion for local capture). See the template `README.md` for setup specifics around screen-capture permissions and storage configuration.

## Customize it {#customize}

Ask the agent:

- "Add a 'filler word removal' button that strips ums and uhs from the transcript and re-stitches the video." It edits the transcript processor and wires the UI.
- "Auto-post a new clip to Slack #eng-demos when I record one." It adds the hook.
- "Group the library by project — detect the project from the first words of each transcript." It updates the list view.

See [Cloneable SaaS](/docs/cloneable-saas) for the full clone → customize → deploy flow.

## What's next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Context Awareness**](/docs/context-awareness) — how the agent knows the current clip and playhead
- [**Agent Teams**](/docs/agent-teams) — delegate transcript cleanup to a specialist sub-agent
