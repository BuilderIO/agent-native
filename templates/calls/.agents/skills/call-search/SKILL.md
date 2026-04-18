---
name: call-search
description: >-
  Full-text search over title, description, and transcripts using a dialect-
  agnostic LIKE-based query builder. Supports +required, -excluded, and
  "quoted phrases". Use when changing the FTS tokenizer, the SQL builder,
  or the highlight-snippet rendering.
---

# Call Search

Global search at `/search` and the library's search bar both go through `search-calls`. Per-call transcript search (the "jump to moment" box on the player) runs **in-memory on the client** over the loaded transcript segments — it does not hit `search-calls`.

## When to use

Read this skill before:

- Changing the query syntax (adding filters, operators)
- Modifying the SQL builder that applies LIKE clauses
- Adjusting how highlight snippets are generated
- Debugging "why doesn't this query match?"

## The tokenizer

`server/lib/search/fts.ts:buildSearchTerms(query)` parses the user's input into three buckets:

```ts
interface SearchTerms {
  positive: string[];   // must match at least one column
  negative: string[];   // must NOT match any column
  phrases: string[];    // quoted — must match as substring
}
```

Syntax:

| Input                                 | Parsed                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `pricing`                             | `positive: ["pricing"]`                                                       |
| `pricing objection`                   | `positive: ["pricing", "objection"]`                                          |
| `"next steps"`                        | `phrases: ["next steps"]`                                                     |
| `pricing -competitor`                 | `positive: ["pricing"]`, `negative: ["competitor"]`                           |
| `+pricing objection`                  | `positive: ["pricing", "objection"]` (the `+` is optional on positives)       |
| `"refund policy" pricing -budget`     | `phrases: ["refund policy"]`, `positive: ["pricing"]`, `negative: ["budget"]` |

Tokens are split on whitespace after phrases are extracted. Empty tokens are dropped.

## SQL

`applySearchWhere(query, ...columns)` builds a Drizzle `SQL` expression combining:

- For each `phrase`: OR across columns with `LIKE '%phrase%'`. Escaped for `%` / `_` / `\\`.
- For each `positive` token: OR across columns with `LIKE '%token%'`. AND combined across tokens.
- For each `negative` token: AND `NOT (OR across columns LIKE '%token%')`.

All `LIKE` patterns are escaped via `escapeLikeTerm` to prevent user-controlled wildcards. The whole WHERE is `AND`ed with `accessFilter(schema.calls, schema.callShares)` so users only see calls they can access.

Example query `pricing -budget "next steps"` against `calls.title`, `calls.description`, `call_transcripts.full_text`:

```sql
WHERE accessFilter(...)
  AND (title LIKE '%next steps%' OR description LIKE '%next steps%' OR full_text LIKE '%next steps%')
  AND (title LIKE '%pricing%' OR description LIKE '%pricing%' OR full_text LIKE '%pricing%')
  AND NOT (title LIKE '%budget%' OR description LIKE '%budget%' OR full_text LIKE '%budget%')
```

**Dialect-agnostic by design.** No Postgres `tsvector`, no SQLite FTS5. LIKE works on every dialect we target. When we scale to a million calls and LIKE chokes, we'll add a real FTS provider behind the same interface — but the public API stays the same.

## Why LIKE, not FTS5/tsvector

See the framework `portability` skill. Calls must run on SQLite (local dev), Neon Postgres (prod), Turso, D1, and Supabase with no schema drift. A dialect-specific FTS layer would either force per-dialect schemas or a runtime feature-flag. LIKE trades a bit of speed for portability.

The transcript `full_text` column is lowercased at write time (`request-transcript`) so LIKE patterns are effectively case-insensitive without calling `LOWER()` at query time. Keep this convention — mixing cased + lowercased `full_text` would break queries.

## Highlight snippet

`buildSnippet(fullText, terms, { window = 120 })` returns a short excerpt centered on the first positive term / phrase hit, with `<mark>` tags around the match. Used in search result cards.

```ts
const snippet = buildSnippet(call.fullText, terms, { window: 120 });
// -> "…customer mentioned <mark>pricing</mark> concerns during the discovery portion…"
```

Falls back to the first 120 characters of `description` if the match is in `title`.

## Global vs per-call search

- **Global** (`/search`, library bar) → `search-calls` action → server-side LIKE over title / description / transcript.
- **Per-call** (player's transcript search box) → loads `call_transcripts.segments_json` via `get-call-player-data`, filters segments client-side. No server round-trip per keystroke.

The per-call path also highlights the exact segment containing the match and scrolls the transcript to it. The global path returns call-level results and leaves segment jumping to the user clicking into the call.

## Filter composition

`list-calls` supports filters that combine with search:

```bash
pnpm action list-calls --search="pricing" --trackerId=<pricing-tracker-id> --accountId=<acme-id> --sort=recent
```

These compose with AND semantics. For full-text across transcripts, use `search-calls`; for metadata-only filtering (source / folder / space / participant), use `list-calls`.

## Rules

- **Escape every LIKE term via `escapeLikeTerm`.** Never interpolate user input into a LIKE pattern directly.
- **Always scope via `accessFilter`** — search must respect share grants.
- **Positive tokens AND together; phrases AND together; negatives AND NOT together.** Don't "fuzz" this into OR — the user expects boolean intersection.
- **Lowercase `full_text` at write time, not query time.** Changing this convention requires migrating every row.
- **Per-call transcript search stays client-side.** Don't add a server round-trip for keystroke-level search — it's not faster and it's a worse UX.
- **Highlight snippets use a 120-char window by default.** Tune per caller if needed; the default is tuned for card layouts.

## Related skills

- `transcription` — `full_text` is produced by `request-transcript`.
- `portability` — why we use LIKE instead of Postgres tsvector / SQLite FTS5.
- `storing-data` — `full_text` lives on `call_transcripts`, not `calls`, to keep the hot-path row small.
- `trackers` — tracker filters compose with search via `list-calls --trackerId=...`.
