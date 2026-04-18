---
name: call-summary
description: >-
  How the AI call summary is generated — the Recap / Key Points / Next Steps /
  Topics / Questions / Action Items structure, the agent delegation flow, and
  how `write-call-summary` validates and persists the JSON. Use when tuning
  the summary prompt, the parse step, or adding new summary fields.
---

# Call Summary

## When to use

Read this skill before:

- Tuning the summary prompt or adding a new field
- Changing how `write-call-summary` validates the agent's JSON
- Wiring the "Regenerate" buttons for recap / topics / next steps
- Debugging a missing or empty summary

## Structure

Defined in `shared/api.ts`:

```ts
interface CallSummary {
  recap: string;                                       // one paragraph, 3-6 sentences
  keyPoints: Array<{ text: string; quoteMs?: number }>;
  nextSteps: Array<{
    text: string;
    owner?: string;       // participant label or email
    dueAt?: string;       // ISO date when mentioned
    quoteMs?: number;     // timestamp of the quote that anchors this step
  }>;
  topics: Array<{ title: string; startMs: number; endMs?: number }>;
  questions: Array<{ askedByLabel?: string; text: string; ms: number }>;
  actionItems: Array<{ text: string; owner?: string; ms?: number }>;
  sentiment?: "positive" | "neutral" | "negative";
}
```

Persisted in `call_summaries` split across columns (`recap`, `key_points_json`, `next_steps_json`, etc.) so you can regenerate one field without touching the rest.

**Every list item that references the timeline SHOULD carry a `quoteMs` / `ms` / `startMs`.** That's what powers click-to-jump in the UI and click-to-create-snippet. The prompt asks for it explicitly.

## The rule: agent, not inline LLM

The summary is a prose + structured reasoning task — it belongs in the agent chat. `regenerate-summary` does **not** call an LLM itself. It queues a delegation:

```
user: "Summarize this call"
  -> pnpm action regenerate-summary --callId=<id>
     -> writeAppState("ai-delegation-<callId>-<uuid>", {
          kind: "summary",
          callId,
          message: "Read the transcript via get-transcript --callId=<id> and return
            a CallSummary JSON. Then call write-call-summary --callId=<id> --summary=<json>.",
          ...
        })
     -> returns { queued: true }
  -> agent picks up the delegation, reads the transcript, produces JSON, calls write-call-summary.
  -> UI polls `refresh-signal`, re-renders with the new summary.
```

The same pattern applies to `regenerate-topics`, `regenerate-next-steps`, and `suggest-snippets`.

## Prompt

The prompt template lives in `server/lib/summary/prompt.ts`. Key principles:

- **Cite everything.** Every `keyPoint`, `nextStep`, and `actionItem` should carry a `quoteMs` pointing at the exact segment that supports it. The prompt instructs the agent not to invent facts and to omit items it can't anchor.
- **Verbatim quotes preferred.** The `quote` fields (in tracker hits) must be verbatim substrings; `keyPoints.text` can be paraphrased but should stay faithful.
- **Language-aware.** The prompt reads `call_transcripts.language` and asks the agent to write the summary in that language (English default).
- **Short recap.** 3–6 sentences, plain prose, no bullets. If the call is too short (< 100 words total), the action returns early without generating a summary — a 30-second hallway call doesn't need a recap.
- **Topic segmentation.** `topics` should be 3–8 segments covering the whole call. `startMs` is mandatory, `endMs` optional (defaults to the next topic's `startMs`).

## Parse + validate

`server/lib/summary/parse.ts` exposes `parseSummaryJson(raw: unknown): CallSummary` which:

- Accepts a JSON object **or** a string containing JSON (agents sometimes wrap in ```json fences — we strip those).
- Runs Zod validation (see `write-call-summary.ts`). Rejects bad shapes with a clear error the agent can read and retry from.
- Coerces `ms` fields from strings (`"12000"`) to numbers.
- Fills defaults for missing fields so partial regens don't nuke the whole row.

`write-call-summary` is the **single write path** — it calls `parseSummaryJson`, validates against `SummarySchema`, then persists each JSON column. `regenerate-topics` and `regenerate-next-steps` write partial updates to the same row via dedicated actions (`write-call-topics`, `write-next-steps`).

## Minimum threshold

If the transcript has fewer than ~100 words or 30 seconds of talk time, the summary generation is skipped and `call_summaries` gets a minimal row with an empty recap. Short interactions (voicemail pickups, accidental recordings) would produce noise.

## Regen buttons

Each summary section has its own regen:

| Action                    | What it refreshes                                          |
| ------------------------- | ---------------------------------------------------------- |
| `regenerate-summary`      | Full `CallSummary` — recap + all structured fields.        |
| `regenerate-topics`       | Just `topics_json`.                                        |
| `regenerate-next-steps`   | Just `next_steps_json`.                                    |

All three queue delegations; all three end with `writeAppState("refresh-signal", ...)`.

## Sentiment

Optional. The agent emits `"positive"` / `"neutral"` / `"negative"` if it can read the tone confidently, else omits it. The UI shows a small chip above the recap. Don't inflate — calls where the buyer says "we'll think about it" are almost always `neutral`, not `negative`.

## Rules

- **Never** call an LLM directly from `write-call-summary` or `regenerate-*`. Those are plumbing.
- **Never** write the summary straight from `request-transcript`. The transcript path only **queues** the summary task.
- **Every timeline reference (`quoteMs`, `startMs`, `ms`) must be within the call's duration.** Validate in `write-call-summary`.
- **Topics must start in order** and should cover the call — fail loudly if the agent emits overlapping ranges.
- **Owners** in `nextSteps` and `actionItems` are free text that the UI tries to resolve against `call_participants.displayName` / `.email`. If unresolvable, render the raw string — don't throw.

## Related skills

- `transcription` — the summary pipeline reads `call_transcripts.segmentsJson`.
- `delegate-to-agent` — the framework-wide rule this skill is grounded in.
- `trackers` — smart trackers follow the same delegation pattern.
- `snippets` — `suggest-snippets` delegation produces proposals the user can promote.
- `real-time-sync` — `refresh-signal` is what flips the UI from "generating…" to the populated summary.
