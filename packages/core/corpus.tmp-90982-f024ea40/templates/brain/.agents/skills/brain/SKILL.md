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
   `get-capture` redacts `title`/`content`/`metadata` by default; pass
   `includeRawContent: true` (requires `editor` access on the source) to get
   the real text needed for an exact-substring quote.
5. Call `write-knowledge` with `evidence` entries whose `quote` fields are exact capture substrings — `validateEvidence` throws otherwise.
6. If `write-knowledge` returns `mode: "proposal"`, leave it in review unless the user asks to approve. See AGENTS.md for the exact tier/confidence conditions that trigger a proposal.

## Capture Sanitization (Transcripts)

Transcript-kind captures are sanitized **before storage** by default
(`shouldSanitizeCaptureBeforeStorage` — true whenever `kind === "transcript"`,
unless `captureSanitizationEnabled: false` in settings or a per-capture
`metadata.sanitizeBeforeStorage` / source-config override says otherwise).
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

## Search: Two Distinct Actions, No Vector Index

- `search-knowledge` — SQL text match over `title`/`summary`/`body` of
  **distilled knowledge only**. Use for "what does Brain officially know about
  X."
- `search-everything` — broader pass across knowledge, raw captures, and
  sources in one call, plus `federatedCoverage` (delegation hints for other
  apps). Use this as the default first search for an open-ended question;
  narrow with `type: "knowledge" | "capture" | "source"` when you already know
  which record type you need.
- Neither uses embeddings/vector search — matching is deterministic SQL LIKE
  scoring. Don't describe results as "semantically similar"; they matched on
  literal term overlap.

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
  distillation worker, scheduled sync cron, demo/eval seeding).
- `ask-across-everything`, `security`, `sharing`.
