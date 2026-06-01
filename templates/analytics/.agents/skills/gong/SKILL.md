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

- `gong-calls` — list recent calls, search by company/domain/person/email, fetch
  a single transcript by call ID, or return transcript excerpts for matching
  calls.

## Patterns

For account or deal deep dives:

1. Search calls with `company` set to the account name, domain, person, or email.
2. Set `includeTranscripts=true` when the user asks for context, risks,
   objections, next steps, decision process, sentiment, or a "deep dive".
3. Use `transcriptLimit` around 3-5 for a first pass. Increase only when the
   user asks for broader coverage or the returned calls are not enough.
4. Use the compact transcript excerpts returned by `includeTranscripts=true`.
   Do not fetch raw individual transcripts unless the user asks for exhaustive
   quoting, debugging, or export.
5. Ground qualitative findings in the transcript excerpts and state how many
   calls were inspected.

Example:

```txt
gong-calls(company: "The Knot", days: 180, limit: 8, includeTranscripts: true, transcriptLimit: 5)
```

If transcript loading fails for a call, report that gap instead of inferring the
conversation content from title, date, or participants.

When a single transcript is needed, `gong-calls(transcript: "...")` returns
compact extracted text by default. Set `rawTranscript=true` only for
debugging/export, and never pass raw transcript payloads into `save-analysis`.
