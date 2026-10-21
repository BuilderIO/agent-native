---
slug: can-people-and-an-ai-agent-edit-the-same-document
topic: agentic-apps
apps: []
job_id: job-agentic-apps
title: "Can people and an AI agent edit the same document at the same time?"
meta_description: "In Agent-Native apps, the AI agent edits as a peer alongside people, and concurrent edits merge without conflicts. How it works, and what to watch for."
audience: technical
published: 2026-10-15
author: "Agent-Native Team"
app_cta_url: "https://www.agent-native.com/docs/real-time-collaboration/"
cta_label: "Read the docs"
cta_band_heading: "Build with the agent as a teammate"
cta_band_subhead: "See how real-time collaboration works in Agent-Native."
related_resources:
  - label: "Real-Time Collaboration"
    url: "https://www.agent-native.com/docs/real-time-collaboration/"
  - label: "History"
    url: "https://www.agent-native.com/docs/toolkit-history/"
  - label: "Audit Log"
    url: "https://www.agent-native.com/docs/audit-log/"
related:
  - what-is-an-agent-native-app
internal:
  target_terms: "multi agent collaboration (US 200/mo)"
  basis: "Search Console: 'what agent-native office platform should i use to let multiple ai agents edit files safely?'. The docs describe people plus the agent, not several agents at once, so this article doesn't claim multiple agents."
  sources: "/docs/real-time-collaboration/, /docs/toolkit-history/"
---

Yes, in Agent-Native apps that use its real-time collaboration. People and the AI agent can edit the same document at once, and concurrent edits merge without conflicts. The agent appears as a peer editor, with a presence indicator while it's working.

## How does it work?

- Rich-text bodies merge through Yjs, a CRDT. Any two clients that exchange their state reach the same result, regardless of order.
- Each open tab counts as a participant. A presence bar shows who's in the document, including an indicator when the agent is actively editing.
- Access checks still apply: viewers can read, and editors can write.

## Where can edits still conflict?

Structured data works differently from document text. If two agents or users rewrite the same top-level record at the same moment, the edits can conflict. The docs recommend a granular, server-side merge, so concurrent edits to different items both survive.

## Can you undo what the agent did?

Agent-Native's History kit provides versioning, access-scoped history actions, and the groundwork for undo and redo. Restoring a version is a new action, not a silent rewind of the database. Each app builds its own timeline and restore controls on top, so check what the app you use offers. The Audit Log keeps a durable record of human and agent actions.

<!-- try-it -->

## Frequently asked questions

### Can the AI agent edit while I'm editing?

Yes. Concurrent edits from people and the agent merge without conflicts.

### What happens when two edits collide?

Document text merges automatically. Structured records can conflict when two agents or users rewrite the same top-level record at the same time, which is why the docs recommend a granular, server-side merge.

### Can I see when the agent is editing?

Yes. The presence bar includes an indicator when the agent is actively editing.

### Can I restore an earlier version?

The History kit supports restoring versions. Each app builds its own history and restore controls, so what you see depends on the app.

### Is there a record of what the agent changed?

Yes. The Audit Log keeps a durable record of human and agent actions.
