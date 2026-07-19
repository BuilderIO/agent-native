---
name: brain-runbook
description: >-
  Internal architecture, ops, and rollout runbook for the Brain template
  (search layers, Slack backfill, distillation worker, connection resolution,
  scheduled sync, demo/eval internals, generic ingest). Use when operating,
  rolling out, or debugging Brain internals — not for ordinary retrieval.
---

# Brain Internal Architecture & Runbook

This skill captures internal runbook, ops, and roadmap detail that used to live
in the public `template-brain.md` overview and previously sat inline in
`AGENTS.md`. It is reference material for the agent and maintainers; it is
intentionally not in the public docs. Read it when you are operating, rolling
out, or debugging Brain internals rather than answering an ordinary question.

## Privacy, Evidence Audiences, And Search

Brain applies the deterministic hard-category screen before any privacy model.
It blocks performance/discipline, layoffs or termination, compensation,
recruiting, health/accommodation, investigation, privileged legal, credentials,
and personal data. An approved privacy classifier may make handling stricter;
it cannot override a deterministic hit. When no classifier is configured,
Brain is in degraded deterministic-only mode: clearly clean company material
may be allowed, while uncertainty is quarantined and `get-brain-health` reports
the missing configuration.

Quarantined re-fetchable material from Slack, GitHub, or Granola keeps only a
metadata receipt because the content can be re-fetched during an authorized
review. Push-only generic and Clips payloads instead use an encrypted,
short-TTL private side store that no search, agent, source editor, log,
citation, or distillation surface can read; expiry converts it to a suppression
receipt. Review records policy metadata, never a shortcut to raw sensitive
content. HR-blocked evidence is never declassifiable: write a new,
non-identifying reviewed statement if it has durable organizational value.

Every allowed capture and derived row has an audience id and ACL hash. Public
and organization material use the trivial organization audience. Private Slack
material uses its channel membership audience, and meeting material uses its
attendee audience. Retrieval prefilters by audience before FTS/vector ranking;
answers spanning multiple sources may only cite the intersection of their
evidence audiences. Private Slack audiences fail closed when membership has not
been refreshed for 15 minutes, so removal upstream cannot leave indefinite
Brain access.

Semantic indexing starts when a capture is `allowed`, rather than waiting for
distillation. A derived row is current only when its staleness key matches
`contentHash + BRAIN_SEARCH_INDEX_VERSION + sensitivityPolicyVersion + aclHash`.
Changing content, policy, or membership invalidates indexed artifacts,
knowledge/proposal evidence, and mirrored canonical resources before they can
be served.

## Search model layers

Brain search has three layers:

- **V1 Company Brain search:** answer from reviewed, distilled knowledge first.
  This is the trust layer for decisions, policies, product facts, processes,
  and durable summaries. V1 exposes `search-knowledge` and `get-knowledge` for
  distilled company memory.
- **V1.5 Brain-wide search:** use `search-everything` as the broad first pass
  across knowledge, raw captures, and sources. Then call `get-knowledge` for
  reviewed entries or `get-capture` for exact source context and links. The
  action also returns `federatedCoverage`: Brain source/provider coverage,
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

## Slack backfill scope and rollout

Brain resolves `SLACK_BOT_TOKEN` from a granted Slack workspace connection
first, then from backward-compatible Brain-local or registered vault
credentials. It scans explicitly configured channels plus all public channels
only when an admin opts into `includePublicChannels`:

```bash
pnpm --filter brain action create-source \
  --title "Slack product channels" \
  --provider slack \
  --visibility org \
  --config '{"channelIds":["C0123456789"],"historyLimit":15}'
```

The connector verifies each configured conversation before reading history and
rejects DMs and MPIMs. Public discovery is opt-in and exclusion patterns are
applied before capture. Private channels are never silently joined: an operator
must manually invite the Slack app before validation and membership sync. Cursor
state is stored on the source so each sync can pick up where the last one
stopped, including after Slack rate limiting.

New Slack sources default their initial history boundary to four weeks ago and
keep automatic sync off until the rollout is reviewed. `oldest` applies only
before a channel has saved cursor progress; later runs resume from that cursor.
`historyLimit` bounds messages per page (1–15), `maxChannelsPerSync` bounds
channels per run (1–25), and `pagesPerChannel` bounds cursor pages per selected
channel (1–5). Broad public-channel backfills should use repeated bounded syncs
rather than removing these limits. Explicit allow-lists and public discovery
keep separate round-robin offsets so channels beyond the per-run cap are not
starved.

Use `test-slack-connection` before a production backfill. It validates the Slack
bot token with `auth.test` and, when channel refs are provided, checks channel
metadata without reading message history.

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
material ignored. Slack source cards expose this as a clean rollout flow:
**Test** checks the credential and allow-list without history reads, **Safe
pilot** imports only a tiny capped sample, **Review captures** opens the capture
inventory, and **Review queue** sends reviewers to approve proposals before they
become queryable company memory.

Use `get-pilot-report` after a sample sync to inspect sync health, capture
counts, queue state, published knowledge, pending proposals, privacy notes, and
recommended rollout steps without returning raw capture bodies.

Recommended production rollout:

1. Start with one or two high-signal public channels and explicitly invited
   private channels; never use discovery as implicit private-channel consent.
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

When approving a proposal, keep the company-context switch off unless the memory
should be ambient context for Dispatch and other apps. Turn it on for canonical
decisions, policies, product facts, or durable process notes that are safe to
place under `context/company-brain/...`; Brain shows the exact Markdown preview
before approval publishes it. Use the Knowledge route or
`set-knowledge-canonical --published=false` to remove a mirrored resource after
previewing what will be removed, without deleting the underlying Brain knowledge.

## Distillation worker internals

Distillation has two worker paths. When a Brain tab is open, the app shell
claims queued items with `claim-distillation` and delegates them to the app
agent in the background. When no tab is open, the `brain-distillation` server
sweep runs with `RUN_BACKGROUND_JOBS`, claims due queued rows, reclaims stale
`processing` rows, and invokes the same agent loop headlessly. Re-running
`enqueue-distillation` for an active queue item refreshes the handoff instead of
duplicating queue rows. The agent reads the capture, writes cited knowledge or
review proposals, then calls `mark-capture-distilled`, which marks the active
queue row done. If the agent does not close the queue, the worker requeues the
item with a short delay and eventually fails it after repeated attempts.

The Ops route is the operator view for distillation. It lists queued,
processing, failed, done, stale, and retryable handoffs, backed by
`list-distillation-queue` and `retry-distillation`.

## Pilot and Ops controls

Slack pilots stay bounded by default, `get-pilot-report` summarizes source
quality without raw bodies, and the Ops route tracks stale or failed
distillation queue items with safe retry controls.

## Shared workspace connection resolution

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

Brain source credentials do not fall back to deploy-level environment variables.
If a shared provider exists but has not been granted to Brain, grant Brain
access instead of copying the same secret into a Brain-specific setting.

Ownership model:

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

## Scheduled sync internals

The Sources page includes a setup sheet for Slack, Granola, GitHub, Clips,
generic webhooks, and manual imports. Slack, Granola, and GitHub sources can opt
into `autoSync` with a `pollMinutes` cadence. Use `sync-source` for a single
source, `sync-due-sources` for all due accessible sources, or enable
`RUN_BACKGROUND_JOBS=1` locally to let the Brain background job poll due sources
from the Nitro process.

## Demo and eval internals

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

`run-retrieval-eval` checks an offline real-channel-style retrieval set. It uses
existing workspace Brain data when the expected branch-safety answers already
have citation-backed support; otherwise, with `seedIfMissing` enabled, it seeds
a small Slack-style fallback corpus and re-runs the same checks. The result
covers Slack-style citations, branch-safety terms, and an unsupported
cleanup-cron not-found case. The same mode is available through `run-demo-eval`
with `mode: "retrieval"`.

The repository-level `pnpm test` command includes `pnpm test:brain-evals`, which
runs Brain's product-demo and retrieval action evals against a disposable local
SQLite database. `pnpm test:brain-privacy-evals` is a separate CI lane with
must-block sensitive fixtures and must-allow benign false-positive fixtures
(such as API-limit raises, bonus features, and medical-device customers). Both
paths are fully seeded and offline; neither requires production Slack, Granola,
Clips, or external workspace data.

## Generic ingest payload validation

The signed ingest webhook at `/api/_agent-native/brain/ingest` accepts a
`RawCapturePayload`. Create a source with a `sourceKey` to receive a bearer
token, set `Authorization: Bearer <ingestToken>` on the request, and send the
payload shape below. Clips can export to that endpoint without Brain reading the
Clips database directly. Generic sources use the same payload shape for call
transcripts, customer research, imported notes, or any other source that can
produce a bounded capture.

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
