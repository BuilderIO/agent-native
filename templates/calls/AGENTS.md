# Calls — Agent Guide

Calls is an agent-native conversation intelligence app. The agent works with
recordings, transcripts, summaries, snippets, trackers, search, sharing, and talk
analytics through actions and SQL-backed state.

Detailed capture, transcript, summary, search, tracker, and sharing patterns live
in `.agents/skills/`.

## Core Rules

- Use actions for call lifecycle, transcript work, summaries, snippets, trackers,
  search, analytics, and sharing. Do not mutate ownable call data directly.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. The action schema is the parameter source of truth.
- Never fabricate transcript content, speaker attribution, action items, or
  sentiment. If the transcript is incomplete, say so and use available evidence.
- Use `view-screen` when the active call, selected snippet, or visible transcript
  segment is unclear.
- Keep summaries practical: decisions, follow-ups, objections, dates, owners, and
  source-backed moments.
- Use framework sharing/access helpers for calls and derived resources.

## Application State

- `navigation` exposes the current call, library/search view, selected segment,
  tracker, or analytics surface.
- `navigate` moves the UI to calls, snippets, search, and detail views.
- Use action results for full transcripts rather than relying on ambient screen
  context.

## Skills

Read the relevant skill before deeper work:

- `call-capture` and `transcription` for recording/transcript flows.
- `call-summary` for summaries and follow-ups.
- `call-search`, `snippets`, `trackers`, and `talk-analytics` for analysis work.
- `call-sharing` for visibility, grants, links, and embeds.
- `frontend-design` and `shadcn-ui` for UI changes.
