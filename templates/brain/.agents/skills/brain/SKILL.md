---
name: brain
description: Work with the Brain institutional-memory template, including importing captures, searching synced Slack and Zoom content, validating quote evidence, and writing knowledge.
---

# Brain Template

Use Brain actions rather than raw SQL.

1. Call `get-brain-settings` before answering, searching broadly, or distilling when current settings are not already in context. Apply the returned guidance for assistant name, company name, tone, source policy, citation requirements, publish tier, redaction, and distillation instructions.
2. Import raw material with `import-capture` (generic), `import-transcript`
   (meeting-shaped: participants, `sourceUrl`, tags), or
   `import-markdown-files` for a bounded Markdown folder/batch. These default
   `enqueueDistillation: true`, immediately create or reuse queue items, and
   auto-create a private `manual` source when `sourceId` is omitted — don't
   call `create-source` first just to import one ad hoc item.
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
6. `write-knowledge` publishes directly at its publish tier; there is no manual
   approval step and it never creates a proposal.

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
- After the deterministic screen, the verdict comes from the classifier named
  by the `privacyClassifier` setting: `jev` (default), `model`, or
  `deterministic`. Jev scores each category as a probability and quarantines
  only when a category scores 0.6 or higher; everything else is stored in full
  apart from the always-on credential, email, phone, and link scrub.
  Jev decides the verdict only — it cannot rewrite a document.
- A Jev failure throws instead of degrading: the sync fails visibly and retries
  on the next hourly run. Only a configured approved-model classifier that
  fails falls back, keeping uncertain captures quarantined.
- If no classifier is reachable, deterministic-only mode allows clearly clean,
  company-relevant material and quarantines uncertainty. Treat the health/setup
  warning as a requirement to configure a classifier before broad ingestion.
- `BRAIN_SENSITIVITY_POLICY_VERSION` stamps new decisions; it does not
  retroactively re-screen. Captures decided under an older policy keep their
  verdict and stay indexed until `resanitize-captures` re-runs them, so treat a
  classifier or policy change as needing a deliberate backfill.

Administrators may review a disposition but may not declassify HR-blocked
evidence. A broader statement must be a newly reviewed, non-identifying memory
with no private quotes, links, or identities.

## Capture Sanitization (Transcripts)

Allowed Slack messages and meeting transcripts are stored in full. Keyword
pre-storage sanitization is opt-in: `shouldSanitizeCaptureBeforeStorage` is
true only when a per-capture `metadata.sanitizeBeforeStorage` or source-config
`sanitizeBeforeStorage` is true, and `captureSanitizationEnabled: false` in
settings turns it off everywhere.

Always, regardless of settings:

- Slack mention/channel encoding, emails, phone numbers, API-key-shaped
  strings, and bare URLs are scrubbed (deterministic regex pass).
- Raw transcript metadata keys (`raw`, `segments`, `transcript`, `messages`,
  `utterances`, `attendees`, `participants`, `speaker(s)`, etc.) are dropped
  from stored `metadata`, not just the text.

When opted in, sanitization also strips recruiting (`RECRUITING_SIGNAL`) and
personal-life (`PERSONAL_SIGNAL`) lines and keeps company-relevant signal
(`COMPANY_SIGNAL`: product, decision, roadmap, pricing, incident, GTM). If nothing
company-relevant survives, the stored content becomes the literal string "No
company-relevant content retained from this capture." — treat that string as
"this capture had nothing worth distilling," not as an error.

## Search: Scoped Hybrid Retrieval

For every company-specific factual question, call `search-everything` (and
`ask-brain` for distilled knowledge) before answering. Answer from their
results, naming the source and date behind each fact. If neither returns
relevant results, say the information is not in Brain; never fill the gap from
general model knowledge.

- `search-knowledge` — SQL text search over **distilled knowledge only**. Use
  for "what does Brain officially know about X."
- `search-everything` — pgvector semantic plus full-text search across every
  synced Slack thread and Zoom transcript, knowledge, and sources in one call,
  plus `federatedCoverage` (delegation hints for other apps). Capture results
  carry provider, location (Slack channel or Zoom meeting), content,
  `capturedAt`, and `sourceUrl`; use `capturedAt` to judge recency. If
  `lanes.semantic.status` is `failed`, semantic matches are missing — say so.
  Use it as the default first search; narrow with `type: "knowledge" |
  "capture" | "source"` when you already know which record type you need.
- Audience filtering happens before ranking. Public and organization sources
  use the cheap organization audience; private channels and meetings use their
  restricted audience. A multi-source answer must use the intersection of the
  cited evidence audiences.

Follow `sourcePolicy` for how much of `search-everything`'s output an answer
may lean on: `strict` means distilled knowledge only; `balanced` and
`exploratory` allow answers from `search-everything` captures, each labeled
with its source and date. `ask-brain`'s own `rawCaptureFallback` behavior is in
the table below.

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
| `strict` | `never-answer` | Answers cite distilled knowledge only; synced captures stay searchable but are not answer evidence. If knowledge is missing/thin, say so. |
| `balanced` (default) | `thin-results` | Prefer distilled knowledge; when it is missing or combined summary+body text is under ~260 chars, answer from answer-eligible synced captures (Slack, Zoom, or other sources), naming source and date. |
| `exploratory` | `allowed-leads` | Always include answer-eligible synced captures alongside knowledge as citations with source and date. |

`requireCitations` (default true) additionally blocks `ask-brain` from
returning an answer with no usable citation — it returns a policy-explanation
message instead of a bare summary when that happens.

Each source may also carry an `answerPolicy`, configured through the
`create-source` / `update-source` `policy` argument. `ask-brain` excludes stale
or answer-ineligible results, and all captures from sources whose
`conflictBehavior` is `require-review` (legacy `reviewRequired` no longer
excludes anything). It ranks `blessed` before `standard` before `untrusted`,
then by `authority`. It returns the evaluated policy alongside citations
so external apps can explain why a result was preferred or excluded. Sources
without this policy retain the compatible `standard`, eligible, authority-50
behavior.

## Publish Tiers

`write-knowledge` writes at a `publishTier`: `private` (draft, private
visibility), `team`, or `company` (published, org visibility) — default comes
from `settings.defaultPublishTier`. Every write publishes directly at its tier;
it never creates a proposal, whatever the tier, confidence, or source
`reviewRequired`. The proposal actions exist only for legacy proposal rows.

## Action Reference

AGENTS.md carries a one-line action index; these are the fuller purposes.

| Action | Purpose |
| --- | --- |
| `get-brain-settings` | Identity, tone, `sourcePolicy`, citation, and distillation settings — read first. |
| `update-brain-settings` | Partial patch of any Brain setting; each field saves on its own, like the Settings rows. |
| `navigate` (`view: "settings"`) | `settingsSection` opens a Brain › General tab: `general`, `identity`, `behavior`, `publishing`, `safety`, or `privacy`. |
| `search-everything` | pgvector semantic plus full-text search across synced Slack/Zoom captures, knowledge, and sources, plus `federatedCoverage`; captures carry provider, location, content, `capturedAt`, `sourceUrl`. |
| `search-knowledge` | SQL text search over distilled knowledge only. |
| `ask-brain` | Cited-answer endpoint: reviewed knowledge, capped raw-capture fallback, citations, `federatedCoverage`. |
| `get-knowledge` / `list-knowledge` | Read one or list distilled knowledge records. |
| `get-capture` / `list-captures` | Read one or list raw captures (redacted by default; `includeRawContent` for exact quotes). |
| `import-capture` / `import-transcript` / `import-markdown-files` | Ingest generic material or a bounded Markdown batch, auto-create a private `manual` source when needed, and queue distillation by default. |
| `enqueue-distillation` / `mark-capture-distilled` | Queue a capture for distillation; close out the queue row when done. |
| `write-knowledge` | Write/update durable knowledge; publishes directly — see Publish Tiers above. |
| `review-proposal` / `approve-proposal` / `reject-proposal` / `list-proposals` / `update-proposal` | Legacy proposal records; new writes never create proposals. |
| `set-knowledge-canonical` | Mirror/unmirror published knowledge into `context/company-brain/...` workspace resources. |
| `create-source` / `update-source` / `delete-source` / `list-sources` / `get-source` | Source lifecycle across the seven providers. |
| `set-resource-visibility` / `share-resource` | Set source visibility or grant explicit source access. |
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
