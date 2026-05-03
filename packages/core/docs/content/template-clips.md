---
title: "Clips"
description: "Async screen recording (Loom-style), calendar-synced meeting notes (Granola-style), and push-to-talk voice dictation (Wisprflow-style) — all transcribed, summarized, and searchable in one app you own."
---

# Clips

A capture-everything app: screen recordings (Loom-style), meeting notes from your calendar (Granola-style), and Fn-hold voice dictation (Wisprflow-style). The agent transcribes, titles, summarizes, and indexes all of it — then lets you ask "find the clip where we discussed the rollout plan" and searches across every transcript you've ever made.

Think along the lines of Loom + Granola + Wisprflow rolled into one app — but the agent is a first-class editor across every surface, and the recordings, meetings, and dictations are yours, not a SaaS vendor's.

## What you can do with it

- **Record your screen** with a built-in recorder, webcam overlay, audio capture, and pause/trim.
- **Capture meetings from your calendar.** Connect Google Calendar, see upcoming meetings in the sidebar, and hit record on any one. You get a live transcript plus AI summary, bullet notes, and action items the moment it ends.
- **Push-to-talk dictation.** Hold Fn on your machine, speak, and the cleaned-up text drops into whatever app you're using. Every dictation is kept in a searchable history with originals and AI-cleaned versions side by side.
- **Get an auto-generated title, summary, and chapter markers** for every recording — the agent fills them in and keeps them current.
- **Search across every transcript** — screen recordings, meetings, and dictations all in one library. "Find the clip where we discussed the rollout plan."
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

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-clips --template clips --standalone
```

Clips is a larger template with a native recorder (it ships a desktop companion for local capture). See the template `README.md` for setup specifics around screen-capture permissions and storage configuration.

### Customize it

Clips is a full cloneable SaaS — fork it and ask the agent to extend it. Some examples:

- "Add a filler-word removal button that strips ums and uhs from the transcript and re-stitches the video."
- "Auto-post my standup notes to Slack #eng whenever a meeting ends." (Connect Slack first via [Messaging](/docs/messaging).)
- "Add a hotkey that drops the last dictation into Linear as a new ticket."
- "Group the library by project — detect the project from the first words of each transcript."
- "Add a 'Generate blog post from this clip' button that drafts a post from the transcript and saves it as a draft."
- "Let viewers leave timestamped reactions on a shared clip."

The agent edits routes, components, the transcript pipeline, and the schema as needed. See [Cloneable SaaS](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [Getting Started](/docs/getting-started) if this is your first agent-native template.

## What's next

- [**Cloneable SaaS**](/docs/cloneable-saas) — the clone-and-own model
- [**Context Awareness**](/docs/context-awareness) — how the agent knows the current clip and playhead
- [**Agent Teams**](/docs/agent-teams) — delegate transcript cleanup to a specialist sub-agent
