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

Brain's shipped shape is company chat plus cited, reviewed memory over approved
sources. The current template also includes Brain-wide search across knowledge,
captures, and source records, plus reusable workspace connections for source
credentials. Broader federated workspace search and expertise ranking are
platform direction, not something you need to set up on day one.

## Start Here

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

## Useful Prompts

- "What did we decide about annual pricing, and where was that discussed?"
- "Find the most recent onboarding-process change and cite the source."
- "Summarize what this GitHub discussion means for the launch plan."
- "Review the pending memory proposals and flag anything too vague to publish."
- "Which sources are stale or failing sync?"

## What It Includes

- **Full-page company chat.** The Ask route is the main product surface: a
  clean chat over cited company memory with source health, review count, and
  suggested questions kept secondary. It uses `AgentChatSurface`, so the Brain
  composer stays on the same shared chat input stack as the agent sidebar and
  Agent-Native Code.
- **Repeatable demo flow.** Load a product-decision corpus, run the demo eval,
  ask a cited question immediately, then continue into Review or Knowledge so a
  new workspace can see the trust loop before connecting real sources.
- **Approved sources.** Configure manual, generic webhook, Clips, Slack,
  Granola, and GitHub source records. Sources are org-shared by default so the
  company memory is useful to the whole workspace. Slack is channel-oriented by
  design; DMs and MPIMs are not scan targets.
- **Raw captures.** Store transcripts, channel exports, notes, and webhook imports in portable SQL with dedupe keys and source metadata.
- **Distilled knowledge.** Write atomic entries with kind, topic, entities, confidence, exact evidence quotes, and supersede links.
- **Review queue.** Proposed company memories have a first-class Review route
  where reviewers edit wording, inspect evidence/source links, approve, or
  reject. Reviewers can also choose whether an approved proposal becomes
  canonical company context immediately.
- **Review gating.** High-confidence non-sensitive entries can publish immediately; company-tier or sensitive entries can queue as proposals for approval.
- **Cited retrieval.** V1 exposes `search-knowledge` and `get-knowledge` for
  distilled company memory. The V1.5 expansion adds a Search route and
  `search-everything` action for searching knowledge, raw captures, and source
  records together, then drilling into `get-knowledge` / `get-capture`.
- **Pilot and Ops controls.** Slack pilots stay bounded by default, `get-pilot-report` summarizes source quality without raw bodies, and the Ops route tracks stale or failed distillation queue items with safe retry controls.
- **Shared integrations.** The Sources page shows Brain source records beside
  reusable workspace connection grants and provider readiness. Reusable
  integrations own provider identity, credential references, and app grants;
  Brain sources own app-specific choices such as channels, repositories,
  cursors, review posture, and distillation state. The provider-reader runtime
  gives shared provider search/get contracts; live provider API calls stay
  template-owned unless a reader is explicitly promoted to shared.
- **Ambient context.** Canonical approved entries can mirror into workspace
  resources under `context/company-brain/...` for cross-app context. The Review
  route exposes this as a per-proposal switch; the Knowledge route can publish
  or unpublish approved memories later with `set-knowledge-canonical`. Both
  flows preview the exact Markdown through `preview-canonical-resource` before
  the resource is written or removed.

Brain intentionally uses SQL text search and agentic query expansion for v1.
There is no vector database requirement, so the template stays portable across
SQLite, Postgres, Neon, D1, Turso, and similar hosts. Privacy is handled with
source allow-lists, personal-source exclusions, redaction, and review gates.
Raw capture content is redacted by default in review/search surfaces;
editor-authorized distillation can request exact raw text for quote validation.

## Search Model

Brain search has three layers:

- **V1 Company Brain search:** answer from reviewed, distilled knowledge first.
  This is the trust layer for decisions, policies, product facts, processes,
  and durable summaries.
- **V1.5 Brain-wide search:** use `search-everything` as the broad first
  pass across knowledge, raw captures, and sources. Then call `get-knowledge`
  for reviewed entries or `get-capture` for exact source context and links.
  The action also returns `federatedCoverage`: Brain source/provider coverage,
  reusable workspace connection readiness, compact discovered agent metadata
  when available, and deterministic hints for which specialist app the agent
  should ask next.
- **V2 federated workspace search:** reuse workspace connections and search
  across apps/sources with permission-aware result filtering and ranking. The
  expertise graph belongs to this future/platform layer. V1.5 does not directly
  read sibling app databases; cross-app work is delegated from the agent loop
  with `call-agent`.

Agents should cite evidence links or source URLs whenever available. If Brain
does not return support for a question, the agent should report that honestly
instead of implying the company memory contains an answer.

Use `federatedCoverage.delegationHints` as routing guidance, not as retrieved
evidence: Analytics owns dashboards/metrics, Mail/Gmail owns mailbox-native
search, and Dispatch owns workspace resources, provider grants, approvals,
secrets, recurring jobs, and cross-app routing.

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
so Dispatch and sibling apps can ask company-memory questions. That is not
anonymous data access: the A2A agent card is public discovery metadata, while
retrieval still happens inside Brain's authenticated action surface. Callers
ask over A2A, then Brain uses `ask-brain`, `search-everything`,
`get-knowledge`, and `get-capture` with its normal review, redaction, citation,
and source-access rules.

## Scaffolding

```bash
pnpm dlx @agent-native/core create my-brain --template brain --standalone
```

Then open the app, add sources, import a transcript, and ask the agent to distill cited memories from the raw capture.

For a public demo, open the Ask page and choose **Start demo**. Brain seeds the
product-decision corpus, runs the demo eval, asks the cited freemium question,
then offers Review and Knowledge follow-ups. The seeded corpus demonstrates
product-decision recall, citation links, supersede behavior, review gating,
redaction, personal-content exclusion, and honest not-found behavior without
connecting a real workspace.

## Generic Ingest

Brain exposes a signed webhook for Clips and generic transcript/capture imports
at:

```txt
/api/_agent-native/brain/ingest
```

Create a source with a `sourceKey` to receive a bearer token, then send a `RawCapturePayload`:

```json
{
  "sourceKey": "clips",
  "externalId": "meeting-123",
  "title": "Pricing decision review",
  "participants": ["Ada", "Grace"],
  "occurredAt": "2026-05-15T15:00:00.000Z",
  "transcript": "We decided to keep annual pricing because...",
  "sourceUrl": "https://example.com/share/meeting-123",
  "tags": ["pricing", "product"],
  "raw": {}
}
```

Set `Authorization: Bearer <ingestToken>` on the request. Clips can export to
that endpoint without Brain reading the Clips database directly. Generic sources
use the same payload shape for call transcripts, customer research, imported
notes, or any other source that can produce a bounded capture.

## Slack Backfill

Brain resolves `SLACK_BOT_TOKEN` from a granted Slack workspace connection
first, then from backward-compatible Brain-local or registered vault
credentials. It scans only channels that an admin configures on the source:

```bash
pnpm --filter brain action create-source \
  --title "Slack product channels" \
  --provider slack \
  --visibility org \
  --config '{"channelIds":["C0123456789"],"historyLimit":15}'
```

The connector verifies each configured conversation before reading history and
rejects DMs and MPIMs. Cursor state is stored on the source so each sync can pick
up where the last one stopped, including after Slack rate limiting.

Use `test-slack-connection` before a production backfill. It validates the
Slack bot token with `auth.test` and, when channel refs are provided, checks
channel metadata without reading message history.

For Slack, grant the bot the smallest scopes needed for the source:

- `auth.test` for credential validation.
- `conversations.info` for allow-list verification and DM/MPIM rejection.
- `conversations.history` for allow-listed channel history.
- `chat.getPermalink` for durable citations.
- `conversations.list` only when setup resolves channel names instead of IDs.

Private channels require inviting the bot to the channel. Public channels may
also require joining or inviting the bot depending on the Slack app posture.

For local CLI/action-runner QA, put `SLACK_BOT_TOKEN` in a workspace connection,
registered vault secret, or Brain-local app credential before running source
actions. Brain source connectors intentionally do not read process environment
variables directly, so `.env.local` alone is not a credential source.

Use `run-slack-pilot` for a safer first-pass rollout report. The default action
validates the Slack credential and allow-listed channels, reports guardrails,
privacy exclusions, current knowledge/proposal counts, and next steps, and does
not call `conversations.history`. Only pass `readHistory: true` when the user
explicitly wants a tiny sample sync; the pilot caps the read to two validated
channels, one page per channel, ten messages per page, ten permalinks,
`autoSync: false`, and a recent default history window.

After a sample sync succeeds, list the imported inventory before opening raw
message bodies:

```bash
pnpm --filter brain action list-captures \
  --sourceId <source-id> \
  --status queued
```

The listing omits raw capture content by default and includes each capture's
latest distillation queue state. Use `get-capture` for one specific record when
a reviewer or agent needs exact source context, then write only durable, cited
knowledge. Keep `autoSync` disabled until the channel allow-list, review gate,
and first distilled entries are validated.

The Sources UI has the same flow: open **Captures** on a source card to review
queued records, opt into short previews only when needed, queue distillation,
see whether a capture is waiting on the distillation worker, or mark non-company
material ignored.

Slack source cards expose this as a clean rollout flow: **Test** checks the
credential and allow-list without history reads, **Safe pilot** imports only a
tiny capped sample, **Review captures** opens the capture inventory, and
**Review queue** sends reviewers to approve proposals before they become
queryable company memory.

Use `get-pilot-report` after a sample sync to inspect sync health, capture
counts, queue state, published knowledge, pending proposals, privacy notes, and
recommended rollout steps without returning raw capture bodies.

Recommended production rollout:

1. Start with one or two high-signal channels and channel IDs.
2. Keep `autoSync: false` until review quality is proven.
3. Run `test-slack-connection`, then `run-slack-pilot` without history.
4. Run one explicit `run-slack-pilot --readHistory true` sample when the report
   is clean.
5. Review captures with previews only when needed; ignore social, personal, or
   thin records.
6. Distill durable company context, approve proposal-gated memories, and verify
   `ask-brain` returns cited Slack permalinks.
7. Expand with bounded manual `sync-source` runs before enabling background
   polling.

When approving a proposal, keep the company-context switch off unless the
memory should be ambient context for Dispatch and other apps. Turn it on for
canonical decisions, policies, product facts, or durable process notes that are
safe to place under `context/company-brain/...`; Brain shows the exact Markdown
preview before approval publishes it. Use the Knowledge route or
`set-knowledge-canonical --published=false` to remove a mirrored resource after
previewing what will be removed, without deleting the underlying Brain
knowledge.

Distillation has two worker paths. When a Brain tab is open, the app shell
claims queued items with `claim-distillation` and delegates them to the app
agent in the background. When no tab is open, the `brain-distillation` server
sweep runs with `RUN_BACKGROUND_JOBS`, claims due queued rows, reclaims stale
`processing` rows, and invokes the same agent loop headlessly. Re-running
`enqueue-distillation` for an active queue item refreshes the handoff instead
of duplicating queue rows. The agent reads the capture, writes cited knowledge
or review proposals, then calls `mark-capture-distilled`, which marks the
active queue row done. If the agent does not close the queue, the worker
requeues the item with a short delay and eventually fails it after repeated
attempts.

The Ops route is the operator view for distillation. It lists queued,
processing, failed, done, stale, and retryable handoffs, backed by
`list-distillation-queue` and `retry-distillation`.

## Granola Polling

Brain resolves `GRANOLA_API_KEY` from a granted Granola workspace connection
first, then from backward-compatible Brain-local or registered vault
credentials. It polls Granola's public API for notes, then fetches each note
with its transcript:

```bash
pnpm --filter brain action create-source \
  --title "Granola team notes" \
  --provider granola \
  --visibility org \
  --config '{"pageSize":10,"updatedAfter":"2026-05-01T00:00:00.000Z"}'
```

Granola Enterprise API keys expose Team-space notes, not private notes or
private folders. Brain stores the note summary, transcript, attendees, calendar
metadata, and source URL as a raw capture before distillation.

## GitHub Connector

GitHub is Brain's first reusable connector proof. It resolves `GITHUB_TOKEN`
from a granted GitHub workspace connection first, then from backward-compatible
Brain-local or registered vault credentials, and imports bounded issue and pull
request context from approved repositories:

```bash
pnpm --filter brain action create-source \
  --title "GitHub product repos" \
  --provider github \
  --visibility org \
  --config '{"repositories":["owner/repo"],"state":"all","limit":25}'
```

The connector accepts `repositories` or `repos`, optional `state`, `limit`,
`includeIssues`, and `includePullRequests`. Imported items become raw captures
with stable source URLs and can be distilled like Slack or meeting context. This
is intentionally Brain context ingestion, not a replacement for Analytics-style
GitHub reporting.

## Shared Workspace Connections

Brain sources can reuse shared workspace connections when Dispatch or another
workspace setup has already connected a provider and granted `appId=brain`
access. The source record still belongs to Brain: it stores channel ids,
repositories, sync cursors, review settings, and other source-specific choices,
while the provider credential stays in the workspace vault behind a connection
or grant credential ref.

The `list-connection-providers` action returns each Brain provider with
connection counts, grant state, credential reference names, credential health,
and whether Brain has access. It never returns credential values. Source sync
resolves credentials in this order:

1. Granted `workspace_connections` / `workspace_connection_grants` credential
   refs for `appId=brain`.
2. Backward-compatible Brain-local SQL credentials.
3. Registered vault secrets for the same user/org/workspace scope.

Brain source credentials do not fall back to deploy-level environment
variables. If a shared provider exists but has not been granted to Brain, grant
Brain access instead of copying the same secret into a Brain-specific setting.

Keep the ownership model simple:

- Reusable workspace integrations own provider identity, account metadata,
  credential ref names, and app grants.
- Dispatch is the workspace control plane where admins usually connect, repair,
  and grant those integrations.
- The vault owns the secret values.
- Brain owns source-local choices such as Slack channels, GitHub repositories,
  Granola polling windows, cursors, review posture, and distillation status.
- Agents should inspect connection readiness first, then request a grant or
  source configuration instead of asking the user for another provider token.

The Sources page surfaces the same provider catalog. A provider can be:

- `connected` when an active workspace connection is already granted to Brain.
- `granted` when Brain can access the connection but it is not currently active.
- `needs_grant` when the workspace has a connection that has not been granted to
  Brain.
- `not_connected` when Brain is using scoped credentials or has no connection
  yet.

The page also shows provider readiness: ready, grant needed, needs repair,
missing keys, or metadata only. Agents should inspect this same readiness via
`list-connection-providers` before asking users for duplicate Slack, Granola,
GitHub, or future provider credentials.

## Scheduled Sync

The Sources page includes a setup sheet for Slack, Granola, GitHub, Clips,
generic webhooks, and manual imports. Slack, Granola, and GitHub sources can
opt into `autoSync` with a `pollMinutes` cadence. Use `sync-source` for a
single source, `sync-due-sources` for all due accessible sources, or enable
`RUN_BACKGROUND_JOBS=1` locally to let the Brain background job poll due sources
from the Nitro process.

## Demo and Eval

Brain ships with a repeatable product-decision demo corpus. `seed-demo-data`
loads Slack, Clips, Granola, and webhook-style captures; creates cited knowledge
about retiring freemium, how Decision Digest works, and why product decisions
are the lead demo; queues a policy-sensitive proposal; redacts an email; and
keeps a personal aside out of queryable knowledge.

`run-demo-eval` checks the behavior that matters most for trust: recall,
citations, supersede links, proposal gating, redaction, and personal-content
exclusion. The Ask page includes a compact **Start demo** CTA for empty
workspaces and reveals Review, Knowledge, and **Run eval** follow-ups once the
demo is ready.

`run-retrieval-eval` checks an offline real-channel-style retrieval set. It
uses existing workspace Brain data when the expected branch-safety answers
already have citation-backed support; otherwise, with `seedIfMissing` enabled,
it seeds a small Slack-style fallback corpus and re-runs the same checks. The
result covers Slack-style citations, branch-safety terms, and an unsupported
cleanup-cron not-found case. The same mode is available through `run-demo-eval`
with `mode: "retrieval"`.

The repository-level `pnpm test` command includes `pnpm test:brain-evals`, which
runs Brain's product-demo and retrieval action evals against a disposable local
SQLite database. The CI/prep eval path is fully seeded and offline; it does not
require production Slack, Granola, Clips, or any external workspace data.

## Privacy And Gating

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
- Demo/eval coverage checks proposal gating, PII redaction, personal-content
  exclusion, citations, real-channel-style retrieval, and honest not-found
  behavior.

## Developer Notes

The template follows the agent-native four-area contract:

- **UI:** Ask, Search, Knowledge, Review, Sources, Ops, and Settings routes.
- **Actions:** imports, source management, pilot reports, distillation queueing/claiming/retry, proposal review, cited search, and navigation/context actions.
- **Skills/instructions:** Brain-specific guidance for distillation and retrieval.
- **Application state:** route, filters, and selected IDs mirror into `application_state` for agent context.

See [Dispatch](/docs/dispatch) for the workspace control plane, the
[Dispatch template](/docs/template-dispatch) for the scaffolded app,
[Workspace](/docs/workspace) for shared resources, and
[A2A Protocol](/docs/a2a-protocol) for cross-app delegation.
