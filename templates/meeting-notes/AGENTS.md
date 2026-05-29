# Meeting Notes — Agent Guide

Meeting Notes helps users prepare for meetings, capture notes, enhance notes,
track people/companies, and share outputs through actions and SQL state.

## Core Rules

- Use actions for meeting lifecycle, notes, enhancement, people, companies,
  sharing, navigation, and context. Do not bypass access checks.
- Never fabricate attendees, decisions, transcript text, or action items. Mark
  uncertainty when notes are incomplete.
- Use `view-screen` when the active meeting, notes pane, person, or company is
  unclear.
- Before a meeting, surface context and agenda prep. During a meeting, preserve
  raw notes. After a meeting, produce decisions, owners, dates, follow-ups, and
  clean summaries.
- Use framework sharing actions for note visibility and grants.

## Application State

- `navigation` exposes meeting list/detail, selected meeting, people/company
  context, and notes state.
- `navigate` moves the UI to meeting, notes, people, companies, and settings
  views.
- Use actions for complete notes and attendee context.

## Skills

This template has no dedicated local skills yet. Use root skills: `actions`,
`storing-data`, `real-time-sync`, `security`, `sharing`, `frontend-design`, and
`shadcn-ui`.
