---
title: "Clips"
description: "Record your screen, get an AI-generated title, summary, and chapter markers automatically, and search across every recording you've ever made."
---

# Clips

A screen-recording app where the agent does the post-production work for you. Record your screen, and Clips transcribes it, suggests a title and summary, builds chapter markers, and tags the content automatically. Ask "find the clip where we discussed the rollout plan" and the agent searches across every transcript you've ever made.

Think along the lines of products that record short async videos for your team — but the agent is a first-class editor, and the recordings are yours, not a SaaS vendor's.

## What you can do with it

- **Record your screen** with a built-in recorder, webcam overlay, audio capture, and pause/trim.
- **Get an auto-generated title, summary, and chapter markers** for every recording — the agent fills them in and keeps them current.
- **Search across every transcript** with full-text search. "Find the clip where we discussed the rollout plan."
- **Share clips** with per-clip permissions (public, team, private). Link tracking and threaded comments work too.
- **Smart library views.** Group by project, filter by speaker, auto-tag based on content.
- **Edit the transcript through chat.** "Fix the mis-transcribed word at 1:42." "Pull three quotes for a blog post." The agent edits the transcript and the UI updates live.

## Why it's interesting

Three things make Clips a good showcase of what agent-native enables:

1. **The agent edits the transcript.** Fix a mis-transcribed word, generate chapter timestamps, pull quotes for a blog post — all in natural language, in the chat, with the UI updating live via polling.
2. **Context awareness on recordings.** When you're viewing a clip, the agent knows the clip id, the current playhead, and the selected transcript range. Ask "summarize from here to the end" and it understands what "here" means.
3. **Clips you own, not a vendor.** The recordings live in your storage, the transcripts live in your SQL, and the agent is yours. Fork the template, change how chapters get built, wire it to your own CDN — it's your code.

## For developers

The rest of this doc is for anyone forking the Clips template or extending it.

### Naming note

In the template, always say **"Clip"** in user-facing strings and agent messages. Internal table / variable names (`recordings`, `recording_transcripts`, etc.) stay as-is.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-clips --template clips --standalone
```

Clips is a larger template with a native recorder (it ships a desktop companion for local capture). See the template `README.md` for setup specifics around screen-capture permissions and storage configuration.

### Customize it

Ask the agent:

- "Add a 'filler word removal' button that strips ums and uhs from the transcript and re-stitches the video." It edits the transcript processor and wires the UI.
- "Auto-post a new clip to Slack #eng-demos when I record one." It adds the hook.
- "Group the library by project — detect the project from the first words of each transcript." It updates the list view.

See [Cloneable SaaS](/docs/cloneable-saas) for the full clone → customize → deploy flow.

## What's next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Context Awareness**](/docs/context-awareness) — how the agent knows the current clip and playhead
- [**Agent Teams**](/docs/agent-teams) — delegate transcript cleanup to a specialist sub-agent
