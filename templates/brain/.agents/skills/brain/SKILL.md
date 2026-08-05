---
name: brain
description: Work with the Brain institutional-memory template, including importing captures, validating quote evidence, writing knowledge, and reviewing proposals.
---

# Brain Template

Use Brain actions rather than raw SQL.

1. Call `get-brain-settings` before answering, searching broadly, or distilling when current settings are not already in context. Apply the returned guidance for assistant name, company name, tone, source policy, citation requirements, publish tier, redaction, and distillation instructions.
2. Import raw material with `import-capture` (generic) or `import-transcript`
   (meeting-shaped: participants, `sourceUrl`, tags). Both default
   `enqueueDistillation: true`, immediately create or reuse a queue item, and
   auto-create a `manual` source when `sourceId` is omitted — don't call
   `create-source` first just to import one ad hoc capture.
3. Call `enqueue-distillation` when an existing capture needs an explicit
   queue/retry handoff. Re-running it for a capture that's already
   queued/processing refreshes the handoff instructions instead of creating a
   duplicate queue row.
4. Before writing knowledge, call `get-capture` and copy short exact quotes.
   Quotes and offsets always reference the persisted safe capture, never an
   upstream raw payload. `get-capture` redacts `title`/`content`/`metadata` by
   default; `includeRawContent: true` only reveals allowed, source-accessible
   capture content and never bypasses a sensitivity disposition.
5. Call `write-knowledge` with `evidence` entries whose `quote` fields are exact
   capture substrings. `write-knowledge` calls `validateEvidence`, which throws
   if `evidence[].quote` is not found verbatim in the referenced capture's
   content. Copy the quote from `get-capture` output — do not paraphrase, trim
   mid-sentence in a way that changes the substring, or reconstruct it from
   memory.
6. If `write-knowledge` returns `mode: "proposal"`, leave it in review unless the
   user explicitly asks to approve it now. See **Publish Tiers And Proposal
   Gating** below for the exact tier/confidence conditions that trigger a
   proposal.
7. `review-proposal` and `approve-proposal`/`reject-proposal` overlap:
   `review-proposal` is the general one (`decision`: `approve` | `reject` |
   `needs_changes`); `approve-proposal` and `reject-proposal` are narrower
   single-purpose actions with the same underlying effect. Any of them is
   correct; don't call more than one for the same proposal.

## Privacy, Quarantine, And Safe Captures

Every ingest first receives a deterministic sensitivity screen. Performance,
discipline, termination/layoff, compensation, recruiting, health or
accommodation, investigation, privileged legal, credential, and personal-data
signals can only tighten handling; no model or workspace instruction can lower
that boundary.

- `allowed` captures persist safe content and may be indexed immediately. This
  is independent of distillation: semantic coverage must not wait for an agent
  to author a memory.
- `quarantined` or `suppressed` content is unavailable to search, citation,
  distillation, source editors, agent tools, and logs. Review shows only the
  minimal policy metadata needed to operate the queue.
- Re-fetchable providers (Slack, GitHub, Granola) retain metadata-only
  quarantine records. Push-only `generic` and `clips` material is retained only
  in the encrypted, short-TTL private quarantine store; expiry becomes a
  suppression receipt.
- If no approved privacy classifier is configured, deterministic-only mode
  allows clearly clean, company-relevant material and quarantines uncertainty.
  Treat the health/setup warning as a requirement to configure the classifier
  before broad ingestion.

Administrators may review a disposition but may not declassify HR-blocked
evidence. A broader statement must be a newly reviewed, non-identifying memory
with no private quotes, links, or identities.

## Capture Sanitization (Transcripts)

Transcript-kind captures are sanitized **before storage** by default
(`shouldSanitizeCaptureBeforeStorage` — true whenever `kind === "transcript"`,
unless `captureSanitizationEnabled: false` in settings or a per-capture
`metadata.sanitizeBeforeStorage` / source-config override says otherwise).
That override may skip relevance-oriented transcript cleanup, but deterministic
privacy and PII scrubbing always run and raw input is never retained.
Sanitization always strips, regardless of settings:

- Recruiting/hiring/candidate-evaluation content (`RECRUITING_SIGNAL`).
- Personal-life details, medical/family/compensation mentions
  (`PERSONAL_SIGNAL`).
- Slack mention/channel encoding, emails, phone numbers, API-key-shaped
  strings, and bare URLs (deterministic regex pass, not model-dependent).
- Raw transcript metadata keys (`raw`, `segments`, `transcript`, `messages`,
  `utterances`, `attendees`, `participants`, `speaker(s)`, etc.) are dropped
  from stored `metadata`, not just the text.

Company-relevant signal (`COMPANY_SIGNAL`: product, decision, roadmap,
pricing, incident, GTM, etc.) is what sanitization tries to retain. If nothing
company-relevant survives, the stored content becomes the literal string "No
company-relevant content retained from this capture." — treat that string as
"this capture had nothing worth distilling," not as an error.

## Search: Scoped Hybrid Retrieval

For every company-specific factual question, call `ask-brain` before answering.
Use only its cited evidence. A result with no citations means the fact is
unverified or unavailable, not that the agent may fill the gap from general
model knowledge.

- `search-knowledge` — scoped retrieval over **distilled knowledge only**. Use
  for "what does Brain officially know about X."
- `search-everything` — broader pass across knowledge, raw captures, and
  sources in one call, plus `federatedCoverage` (delegation hints for other
  apps). It uses full-text and available semantic signals after applying source,
  project, kind, and audience filters. Use it as the default first search for
  an open-ended question; narrow with `type: "knowledge" | "capture" |
  "source"` when you already know which record type you need.
- Audience filtering happens before ranking. Public and organization sources
  use the cheap organization audience; private channels and meetings use their
  restricted audience. A multi-source answer must use the intersection of the
  cited evidence audiences.

Follow `sourcePolicy` for how much of `search-everything`'s output an answer
may lean on: `strict` means reviewed knowledge only, `balanced` means raw
captures are labeled fallback context only when knowledge is thin, and
`exploratory` means raw captures and sources can always be labeled leads. The
exact `rawCaptureFallback` behavior table is below.

For "ask across everything" requests, follow the `ask-across-everything` skill:
search Brain first, inspect `federatedCoverage`, delegate live/app-owned data
requests with `call-agent`, and never claim Brain searched sibling app databases
directly.

## Retrieval Policy Is Configurable — Read It, Don't Assume

`sourcePolicy` (in Brain settings) changes what `ask-brain` and
`search-everything` are allowed to answer from, and it is enforced in code,
not just documented:

| `sourcePolicy` | `rawCaptureFallback` | Behavior |
| --- | --- | --- |
| `strict` | `never-answer` | Reviewed knowledge only. If knowledge is missing/thin, say so — never fall back to raw captures as answer support. |
| `balanced` (default) | `thin-results` | Prefer reviewed knowledge; fall back to raw captures only when knowledge is missing or combined summary+body text is under ~260 chars, and label them as raw capture matches. |
| `exploratory` | `allowed-leads` | Always include accessible raw captures/sources alongside knowledge, clearly labeled as unreviewed leads. |

`requireCitations` (default true) additionally blocks `ask-brain` from
returning an answer with no usable citation — it returns a policy-explanation
message instead of a bare summary when that happens.

Each source may also carry an `answerPolicy`, configured through the
`create-source` / `update-source` `policy` argument. `ask-brain` excludes stale
or answer-ineligible results, prevents review-required raw captures from
supporting answers, ranks `blessed` before `standard` before `untrusted`, and
then ranks by `authority`. It returns the evaluated policy alongside citations
so external apps can explain why a result was preferred or excluded. Sources
without this policy retain the compatible `standard`, eligible, authority-50
behavior.

## Publish Tiers And Proposal Gating

`write-knowledge` writes at a `publishTier`: `private` (draft, private
visibility), `team`, or `company` (published, org visibility) — default comes
from `settings.defaultPublishTier`. A `company`-tier write becomes a
**proposal** (`mode: "proposal"`, held for human review) when any cited source
has `answerPolicy.reviewRequired: true`. Otherwise the workspace approval
behavior applies when ALL of:

- `proposalMode !== "never"`, and
- `tier === "company"`, and
- `settings.requireApprovalForCompanyKnowledge` is true, and
- it is NOT a high-confidence auto-publish (`confidence >= 90` AND it's a new
  record, no `knowledgeId` AND nothing was redacted).

Setting `proposalMode: "always"` forces a proposal regardless of tier/settings;
`proposalMode: "never"` only works when the caller also has bypass access
(e.g. `approve-proposal`/`review-proposal` set it internally). If
`write-knowledge` returns `mode: "proposal"`, leave it in review unless the
user explicitly asks to approve it now.

## Action Reference

AGENTS.md carries a one-line action index; these are the fuller purposes.

| Action | Purpose |
| --- | --- |
| `get-brain-settings` | Identity, tone, `sourcePolicy`, citation, and distillation settings — read first. |
| `search-everything` | Broad search across knowledge + captures + sources, plus `federatedCoverage`. |
| `search-knowledge` | SQL text search over distilled knowledge only. |
| `ask-brain` | Cited-answer endpoint: reviewed knowledge, capped raw-capture fallback, citations, `federatedCoverage`. |
| `get-knowledge` / `list-knowledge` | Read one or list distilled knowledge records. |
| `get-capture` / `list-captures` | Read one or list raw captures (redacted by default; `includeRawContent` for exact quotes). |
| `import-capture` / `import-transcript` | Ingest a generic capture or meeting transcript, auto-create a `manual` source when needed, and queue distillation by default. |
| `enqueue-distillation` / `mark-capture-distilled` | Queue a capture for distillation; close out the queue row when done. |
| `write-knowledge` | Write/update durable knowledge; may return a pending proposal — see Publish Tiers above. |
| `review-proposal` / `approve-proposal` / `reject-proposal` / `list-proposals` / `update-proposal` | Human-review workflow for gated writes. |
| `set-knowledge-canonical` | Mirror/unmirror approved knowledge into `context/company-brain/...` workspace resources. |
| `create-source` / `update-source` / `delete-source` / `list-sources` / `get-source` | Source lifecycle across the six providers. |
| `sync-source` / `sync-due-sources` | Run one connector now, or sweep all due sources. |
| `get-brain-health` | Setup/source health, sync freshness, queue and proposal counts, next steps. |
| `list-connection-providers` | Per-provider workspace-connection readiness and credential health. |
| `test-slack-connection` / `run-slack-pilot` | Slack credential/channel validation and bounded first-sync report. |
| `provider-api-catalog` / `provider-api-docs` / `provider-api-request` | Raw provider HTTP calls beyond the source actions. |
| `run-demo-eval` / `run-retrieval-eval` / `seed-demo-data` | Demo corpus and offline eval checks (see `brain-runbook`). |

## Related Skills

- `ingestion-and-connectors` — source creation, health states, sync scheduling,
  and credential resolution order.
- `brain-runbook` — internal architecture and ops detail (Slack rollout,
  privacy quarantine, semantic index, distillation worker, scheduled sync cron,
  demo/eval seeding).
- `ask-across-everything`, `security`, `sharing`.
