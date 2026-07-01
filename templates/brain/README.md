# Brain

An open-source, agent-native alternative to Glean — clean company chat backed by
cited institutional knowledge. Ask a plain-English question and get an answer
from approved company knowledge, with links back to the source.

**Live app: [brain.agent-native.com](https://brain.agent-native.com)**

Brain ingests approved Slack channels, meetings, transcripts, GitHub issues/PRs,
and webhook captures, distills them into reviewable knowledge, and answers with
exact evidence quotes and source links instead of guesses.

## Features

- Company chat that answers from cited, reviewed knowledge — not hallucinations.
- Source connectors for Slack, Granola, GitHub, Clips, and generic webhooks.
- Pre-storage privacy filter and review queue before knowledge becomes durable.
- Portable SQL text search and agentic query expansion — no vector database required.
- Read-only, citation-backed retrieval exposed to other apps over A2A.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-brain --standalone --template brain
cd my-brain
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-brain](https://agent-native.com/docs/template-brain).
