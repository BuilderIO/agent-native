---
name: gong
description: >-
  Search Gong call metadata and transcript excerpts for sales-call analysis,
  customer conversations, objections, risks, and next steps.
---

# Gong

Use Gong for sales-call evidence. Call metadata alone is not enough for a deep
dive that asks what happened in customer conversations.

## Action

- `account-deep-dive` — first choice for named account/deal deep dives that
  need HubSpot plus Gong. It searches by account/deal/company/contact domain,
  loads Gong call details, and returns compact transcript excerpts for synthesis.
- `gong-calls` — list recent calls, search by company/domain/person/email, fetch
  a single transcript by call ID, or return transcript excerpts for matching
  calls.

## Patterns

For account or deal deep dives:

1. Call `account-deep-dive` first when the request also needs CRM context,
   contacts, stages, amount, close date, or an overall opportunity narrative.
2. Use `gong-calls` for targeted follow-up searches by account name, domain,
   person, or email.
3. Set `includeTranscripts=true` when the user asks for context, risks,
   objections, next steps, decision process, sentiment, or a "deep dive".
4. Use `transcriptLimit` around 3-5 for a first pass. Increase only when the
   user asks for broader coverage or the returned calls are not enough.
5. Use the compact transcript excerpts returned by `includeTranscripts=true`.
   Do not fetch raw individual transcripts unless the user asks for exhaustive
   quoting, debugging, or export.
6. Ground qualitative findings in the transcript excerpts and state how many
   calls were inspected.

Example:

```txt
gong-calls(company: "The Knot", days: 180, limit: 8, includeTranscripts: true, transcriptLimit: 5)
```

Gong search is best-effort: it matches title plus external participant names,
emails, and domains through `/calls/extensive`. Treat call details and transcript
excerpts as evidence; treat missing coverage as a gap, not proof that the topic
never came up.

If transcript loading fails for a call, report that gap instead of inferring the
conversation content from title, date, or participants.

When a single transcript is needed, `gong-calls(transcript: "...")` returns
compact extracted text by default. Set `rawTranscript=true` only for
debugging/export, and never pass raw transcript payloads into `save-analysis`.
