# Brain

An open-source, agent-native alternative to Glean — clean company chat backed by
cited institutional knowledge. Ask a plain-English question and get an answer
from approved company knowledge, with links back to the source.

**Live app: [brain.agent-native.com](https://brain.agent-native.com)**

Brain ingests approved Slack channels, meetings, transcripts, GitHub issues/PRs,
and webhook captures, distills them into reviewable knowledge, and answers with
exact evidence quotes and source links instead of guesses. It can search both
organization-wide material and explicitly invited private channels or
attendee-scoped meetings without widening their audience.

## Features

- Company chat that answers from cited, reviewed knowledge — not hallucinations.
- Source connectors for Slack, Granola, GitHub, Clips, and generic webhooks.
- Deterministic privacy screening before storage, with an optional approved
  privacy classifier for richer review decisions.
- Hybrid full-text and semantic search over allowed captures and knowledge,
  filtered by the requesting user's evidence audience before ranking.
- Private-channel and meeting evidence stays audience-scoped; multi-source
  answers use only the intersection of their evidence audiences.
- Sensitive sources are suppressed or quarantined before search, citations,
  distillation, and source editors can see their content.
- Read-only, citation-backed retrieval exposed to other apps over A2A.

## Privacy posture

Brain never treats a connected provider as permission to index everything.
Slack public-channel discovery is configurable, while private channels require a
manual app invite and membership sync. Meetings use their attendee audience.

Hard privacy categories such as performance discussions, layoffs, compensation,
recruiting, health accommodations, investigations, privileged legal material,
and credentials are blocked before they become searchable content. Re-fetchable
providers keep only a metadata receipt in quarantine. Push-only generic and
Clips payloads use an encrypted, short-lived private quarantine store and turn
into a suppression receipt at expiry.

Without an approved privacy classifier, Brain runs in deterministic-only
degraded mode: clearly clean, company-relevant material may proceed; ambiguous
or sensitive-looking material is quarantined and health surfaces the setup
warning. Configure the classifier before relying on higher-throughput ingest.

`sanitizeBeforeStorage: false` only disables relevance-oriented transcript
cleanup. Brain still runs deterministic privacy and PII scrubbing before
persisting titles, content, metadata, safe segments, or search artifacts; the
setting never retains raw input.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-brain --standalone --template brain
cd my-brain
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-brain](https://agent-native.com/docs/template-brain).
