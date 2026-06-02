---
title: "Brain"
description: "Clean company chat backed by cited institutional memory, reviewable source ingestion, and reusable workspace integrations."
---

# Brain

Brain is clean company chat backed by cited institutional memory. People ask
plain-English questions; Brain answers from approved company knowledge with
links back to the Slack thread, meeting, transcript, issue, or webhook capture
that supports the answer.

Brain ingests approved Slack channels, Clips recordings, Granola Team-space
notes, GitHub issues/PRs, and generic transcript/webhook payloads. It stores raw
captures, distills durable facts/decisions/processes, and routes sensitive or
low-confidence memories through review before they become company knowledge.

The product surface stays simple on purpose: **Ask** is the primary chat
experience, while **Sources**, **Review**, and **Knowledge** are admin/support
surfaces for connecting data, approving proposals, and inspecting cited memory.

![Brain company chat with cited memory sources](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9c9fe3b5b9494e33803cd3f494cba356?format=webp&width=1200)

Use Brain when your team wants agents to answer questions like "why did we make
this product decision?", "how does this in-development feature work?", or "what
changed in this process?" with links back to the source conversation, meeting,
or issue.

## What you can do with it

- **Ask cited questions.** Ask is the main product surface: a clean chat over
  reviewed company memory, with source health, review count, and suggested
  questions kept secondary. Every answer links back to the Slack thread,
  meeting, issue, or capture that supports it.
- **Connect approved sources.** Configure manual, generic webhook, Clips, Slack,
  Granola, and GitHub sources. Sources are org-shared by default so company
  memory is useful to the whole workspace.
- **Review before publishing.** Proposed memories get a first-class Review route
  where reviewers edit wording, inspect evidence/source links, and approve or
  reject. High-confidence, non-sensitive entries can publish immediately;
  company-tier or sensitive entries queue as proposals.
- **Inspect cited knowledge.** The Knowledge route shows distilled, atomic
  entries with kind, topic, entities, confidence, exact evidence quotes, and
  supersede links.
- **Reuse workspace integrations.** Brain sources can reuse shared workspace
  connection grants instead of re-entering provider tokens. The Sources page
  shows Brain source records beside reusable connection grants and provider
  readiness.
- **Mirror approved memory as ambient context.** Canonical approved entries can
  mirror into workspace resources under `context/company-brain/...` so other
  apps can use them as context. Both flows preview the exact Markdown before the
  resource is written or removed.

## Useful prompts

- "What did we decide about annual pricing, and where was that discussed?"
- "Find the most recent onboarding-process change and cite the source."
- "Summarize what this GitHub discussion means for the launch plan."
- "Review the pending memory proposals and flag anything too vague to publish."
- "Which sources are stale or failing sync?"

## Getting started

1. **Try the demo.** Open Ask and choose **Start demo**. Brain seeds a small
   product-decision corpus, runs the trust checks, and asks a cited question so
   you can see answers, citations, review, and not-found behavior before adding
   real company data.
2. **Add one source.** Start with a single Slack channel, Granola Team-space
   feed, GitHub repository, Clips export, or generic transcript webhook. Keep
   the scope small until citations and review quality look right.
3. **Review before publishing.** Use Review to inspect evidence, edit wording,
   and approve only durable company memory.
4. **Ask from the source.** Use Ask for questions that should be grounded in
   approved knowledge, not raw chat logs.

For a public demo, the seeded corpus demonstrates product-decision recall,
citation links, supersede behavior, review gating, redaction, personal-content
exclusion, and honest not-found behavior without connecting a real workspace.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-brain --template brain --standalone
```

Then open the app, add sources, import a transcript, and ask the agent to
distill cited memories from the raw capture.

## Connecting sources

Brain resolves provider credentials from a granted workspace connection first,
then from backward-compatible Brain-local or registered vault credentials.
Brain source credentials do not fall back to deploy-level environment variables.
If a shared provider already exists, grant Brain access instead of copying the
same secret into a Brain-specific setting.

**Slack.** Create a source scoped to specific channel IDs. The connector
verifies each configured conversation, rejects DMs and MPIMs, and stores cursor
state so each sync resumes where the last one stopped. A safe rollout flow on
each Slack source card lets you **Test** the credential and allow-list without
reading history, run a tiny capped **Safe pilot** sample, **Review captures**,
and approve in the **Review queue** before anything becomes queryable. Grant the
bot only the scopes the source needs (credential validation, allow-list
verification, allow-listed channel history, and durable permalinks).

**Granola.** Create a source with a polling window and page size. Granola
Enterprise API keys expose Team-space notes, not private notes or folders. Brain
stores the note summary, transcript, attendees, calendar metadata, and source
URL as a raw capture before distillation.

**GitHub.** Create a source scoped to approved repositories. The connector
imports bounded issue and pull-request context with stable source URLs that can
be distilled like Slack or meeting context. This is Brain context ingestion, not
a replacement for Analytics-style GitHub reporting.

**Clips and generic webhooks.** Brain exposes a signed webhook for Clips and
generic transcript/capture imports at `/api/_agent-native/brain/ingest`. Create
a source with a `sourceKey` to receive a bearer token, then send a
`RawCapturePayload` with `Authorization: Bearer <ingestToken>`. Generic sources
use the same payload shape for call transcripts, customer research, imported
notes, or any other source that can produce a bounded capture.

Slack, Granola, and GitHub sources can opt into background `autoSync` with a
poll cadence once review quality is proven.

## Brain vs Dispatch

Brain and Dispatch are complementary, but they do different jobs:

- **Brain owns company memory.** It ingests sources, reviews raw captures,
  distills durable facts/decisions/processes, answers from cited evidence, and
  exposes approved knowledge to agents.
- **Dispatch owns the workspace control plane.** It centralizes messaging,
  secrets, recurring jobs, approvals, A2A orchestration, and the distribution
  and approval of workspace-wide resources.

In a multi-app workspace, Dispatch can route a question to Brain over A2A and
can grant Brain shared provider credentials. Brain remains the specialist for
approved source ingestion, review, retrieval, and cited Company Brain answers.
Brain exposes read-only, citation-backed retrieval as its public A2A capability
so Dispatch and sibling apps can ask company-memory questions — the A2A agent
card is public discovery metadata, while retrieval still happens inside Brain's
authenticated action surface.

## Data model overview

Brain intentionally uses SQL text search and agentic query expansion. There is
no vector database requirement, so the template stays portable across SQLite,
Postgres, Neon, D1, Turso, and similar hosts.

- **Sources** hold connector configuration: provider, allow-listed channels or
  repositories, sync cursors, review posture, and distillation state.
- **Raw captures** store transcripts, channel exports, notes, and webhook
  imports in portable SQL with dedupe keys and source metadata. Raw content is
  redacted from listing/search surfaces by default.
- **Distilled knowledge** holds atomic entries with kind, topic, entities,
  confidence, exact evidence quotes, and supersede links.
- **Proposals** queue company-tier or sensitive entries for review before they
  become durable company memory.
- **Application state** mirrors route, filters, and selected IDs so the agent
  always knows the current navigation and selection.

## Privacy and gating

Brain is designed for company memory, not personal surveillance:

- Slack sync only reads explicitly configured channels and rejects DMs/MPIMs.
- Granola sync reads Team-space notes exposed by Granola's API, not private
  notes or private folders.
- Raw captures are redacted from listing/search surfaces by default; reviewers
  and distillation flows request previews or raw content only when needed.
- Source configs can require review before distilled knowledge becomes durable
  company memory.
- Settings control default publish tier, whether company-tier knowledge requires
  approval, citation requirements, email redaction, and connector error
  notifications.

## Customizing it

The template follows the agent-native four-area contract:

- **UI:** Ask, Search, Knowledge, Review, Sources, and Settings routes.
- **Actions:** imports, source management, pilot reports, distillation, proposal
  review, cited search, and navigation/context actions.
- **Skills/instructions:** Brain-specific guidance for distillation and
  retrieval in `templates/brain/.agents/skills/`.
- **Application state:** route, filters, and selected IDs mirror into
  `application_state` for agent context.

Ask the agent to make changes for you — it can edit its own source. See
[Self-Modifying Code](/docs/key-concepts#agent-modifies-code).

See [Dispatch](/docs/dispatch) for the workspace control plane, the
[Dispatch template](/docs/template-dispatch) for the scaffolded app,
[Workspace](/docs/workspace) for shared resources, and
[A2A Protocol](/docs/a2a-protocol) for cross-app delegation.
