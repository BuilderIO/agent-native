# Documents — Agent Guide

Documents is an agent-native editor for docs, comments, media blocks, sharing,
and Notion-connected content. The agent edits documents through actions and
application state shared with the UI.

Detailed document editing, Notion, storage, and UI rules live in
`.agents/skills/`.

## Core Rules

- Use actions for documents, blocks, comments, media, sharing, navigation, and
  Notion integration. Do not mutate document rows directly unless a skill says to
  and access checks are preserved.
- Notion workspace access is per-user OAuth only. Never read `NOTION_API_KEY`
  from `process.env`, never save a user-entered Notion token through
  `/_agent-native/env-vars`, and require editor access for routes that pull or
  push Notion content.
- Preserve user-authored content. Prefer targeted edits over wholesale rewrites
  unless requested.
- For cross-app or Slack artifact requests, create/update the document artifact
  through the app action path so it remains visible and shareable.
- Use `view-screen` when the active document, selected block, comment, or Notion
  context is unclear.
- Use framework sharing actions for document visibility and grants.
- Keep public/exported content server-renderable where relevant.

## Application State

- `navigation` exposes document, selected block, comment, media, and Notion view
  context.
- `navigate` moves the UI to documents, comments, media, and settings surfaces.
- Use actions for full document content and comment context.

## Skills

Read the relevant skill before deeper work:

- `document-editing` for structured document updates.
- `notion-integration` for connected Notion workflows.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
