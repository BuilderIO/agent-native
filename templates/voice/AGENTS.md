# Voice — Agent Guide

Voice is an agent-native dictation app for snippets, transcription cleanup,
dictionary terms, style presets, stats, and navigation through actions and SQL
state.

## Core Rules

- Use actions for dictations, snippets, dictionary, style settings, stats,
  navigation, and context. Do not mutate app tables directly.
- Treat transcripts as evidence. Do not invent spoken content; preserve ambiguity
  where recognition is uncertain.
- Use dictionary and style settings when cleaning or transforming dictation.
- Use `view-screen` when the active dictation, snippet, dictionary term, or
  settings context is unclear.
- Keep transcription fixes targeted and reversible. Do not silently discard raw
  text.

## Application State

- `navigation` exposes dictation/snippet/settings views, selected ids, and
  visible context.
- `navigate` moves the UI to dictations, snippets, dictionary, stats, and
  settings.

## Skills

This template has no dedicated local skills yet. Use root skills:
`voice-transcription`, `actions`, `storing-data`, `real-time-sync`, `security`,
`frontend-design`, and `shadcn-ui`.
