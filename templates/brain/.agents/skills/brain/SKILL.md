---
name: brain
description: Work with the Brain institutional-memory template, including importing captures, validating quote evidence, writing knowledge, and reviewing proposals.
---

# Brain Template

Use Brain actions rather than raw SQL.

1. Call `get-brain-settings` before answering, searching broadly, or distilling when current settings are not already in context. Apply the returned guidance for assistant name, company name, tone, source policy, citation requirements, publish tier, redaction, and distillation instructions.
2. Import raw material with `import-capture` (generic) or `import-transcript`
   (meeting-shaped: participants, `sourceUrl`, tags). Both default
   `enqueueDistillation: true` and auto-create a `manual` source when
   `sourceId` is omitted — don't call `create-source` first just to import one
   ad hoc capture.
3. Call `enqueue-distillation` when a capture needs distillation. Re-running it
   for a capture that's already queued/processing refreshes the handoff
   instructions instead of creating a duplicate queue row.
4. Before writing knowledge, call `get-capture` and copy short exact quotes.
   Quotes and offsets always reference the persisted safe capture, never an
   upstream raw payload. `get-capture` redacts `title`/`content`/`metadata` by
   default; `includeRawContent: true` only reveals allowed, source-accessible
   capture content and never bypasses a sensitivity disposition.
5. Call `write-knowledge` with `evidence` entries whose `quote` fields are exact capture substrings — `validateEvidence` throws otherwise.
6. If `write-knowledge` returns `mode: "proposal"`, leave it in review unless the user asks to approve. See AGENTS.md for the exact tier/confidence conditions that trigger a proposal.

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
`exploratory` means raw captures and sources can always be labeled leads. See
AGENTS.md for the exact `rawCaptureFallback` behavior table.

For "ask across everything" requests, follow the `ask-across-everything` skill:
search Brain first, inspect `federatedCoverage`, delegate live/app-owned data
requests with `call-agent`, and never claim Brain searched sibling app databases
directly.

## Related Skills

- `ingestion-and-connectors` — source creation, health states, sync scheduling,
  and credential resolution order.
- `brain-runbook` — internal architecture and ops detail (Slack rollout,
  privacy quarantine, semantic index, distillation worker, scheduled sync cron,
  demo/eval seeding).
- `ask-across-everything`, `security`, `sharing`.
