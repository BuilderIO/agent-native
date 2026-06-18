# Multi-source content databases (lightweight federation)

*Working design + phasing. Created 2026-06-17. Sibling to
`BUILDER-LIVE-WRITE-PLAN.md` (write routing depends on that work).*

## Vision

A content-template database stops being "a table backed by one source" and
becomes a **materialized join**: each row is an **entity identified by a
canonical key**, and any number of connected sources contribute a slice of the
row's columns. Sources are joined on a key that each one **normalizes into the
shared key space** via a formula.

Builder CMS is the first source. Notion, and Agent-Native "Analytics" (the
agent-native analytics template) follow. A single database can show Builder
content columns, Notion workflow columns, and Sigma/Analytics metrics columns
side by side — as long as they share a key.

## Core model

- **Canonical key** — one designated identity for the database's rows (e.g. a
  URL/slug). Rows are keyed by it. **Single property (v1)** — a true composite
  key is achievable through the normalization formula
  (`concat(lower(region), "/", slug)`), so we don't need composite-key
  machinery; revisit only if a concrete case forces it.
- **Per-source key mapping** — each source declares `(keyField,
  normalizationFormula)` that maps its own key into the canonical space.
  Example: Builder `data.url = /blog/foo`, Notion `URL =
  site.com/blog/foo`, Sigma `slug = foo` all normalize to `foo`. (Exact
  field shapes per provider TBD — the idea, not the literal fields.)
- **Outer / union join (locked).** Rows = the union of canonical keys across
  sources. A row shows whatever columns its matching sources provide; columns
  from sources that don't have that key are simply empty. We want all rows,
  even with incomplete data. Nothing stricter — it would fight "the integration
  is the source of truth."
- **Column provenance** — every column is bound to a source field and knows its
  origin (already modeled in `content_database_source_fields`).

### Two join types: identity vs reference
A single database can join sources in **two distinct ways**, and both should be
expressible at once (e.g. articles federated across Builder/Notion/Analytics by
URL, *and* author data pulled from a `blog-authors` table by the `Author` field):

- **Identity join (federation).** Sources describe the *same entity* (a blog
  article). Join on the **canonical key** (URL); their columns **merge onto one
  row**. Cardinality 1:1. The key defines the row's identity. (This is the whole
  "Core model" above.)
- **Reference join (lookup).** A source describes a *different entity* (an
  author). A field on the row (`Author`) is a **foreign key** into that
  collection; matching rows' columns are **pulled in as derived columns**.
  Cardinality N:1 (many articles → one author). This mirrors Notion's
  *relation + rollup* / Airtable's *linked record + lookup field*.

Unify both as a typed join record so the reference case drops in without a
schema change:

```
join = {
  kind: "identity" | "reference",
  collection,            // any source: integration, AN app, OR a local table
  localExpr,             // identity → the canonical key; reference → e.g. "Author"
  remoteKeyField,        // the collection's own key
  normalizationFormula,  // same normalize-then-exact matching as identity joins
}
```

- **No relation column needed.** Unlike Notion (which stores an explicit per-row
  link in a dedicated relation column), ours is a **value join**: the existing
  `Author` field's *value* is matched against the authors' key. The join is
  configured in the **Sources** UX, not as a column. The field you already have
  doubles as the foreign key. Trade-off: a value join can be ambiguous (two
  authors normalize alike, or a typo matches nothing) where an explicit link
  can't — covered later by multi-value handling + the manual-pin escape hatch.
- **Order of operations** — build the federated identity row first (URL), *then*
  resolve reference joins against the row's fields (the `localExpr` may itself be
  a federated column).
- **Single-value only for v1.** A single-valued `Author` is a clean 1:1 lookup.
  Multi-value (co-authors, `multiple-blog-authors`) makes it N:M → the looked-up
  columns become lists needing an aggregation/display rule. **Deferred.**
- **Local tables are a source too.** Any local content database can act as a
  source (identity *or* reference), mirroring Notion — indexed by one of its
  properties as its key. See the third Sources group below.

## Design decisions

### Progressive key disclosure (don't introduce complexity until needed)
- **Single source from scratch** (today's flow): no explicit key ceremony — the
  source's natural identity is the key. Unchanged.
- **Adding source #2**, OR **adding a source on top of existing local data**:
  *now* a canonical key is required, so we prompt for it.
- The key concept only ever surfaces when a join actually has to happen.

### AI-suggested key, with a non-AI fallback
- When a key is needed, **lean on the agent** to propose the join key +
  normalization formula — it can see both schemas and sample values and suggest
  "join on URL; strip `/blog/` from Builder, strip host from Notion."
- **Interactive (lightweight) confirm, not one-shot.** The agent proposes, then
  shows a small preview — the chosen key + ~5 sample matches (`/blog/foo` ↔
  `site.com/blog/foo` → `foo`) — and the user confirms or tweaks the formula
  before it commits. A silently-wrong join corrupts the whole table and is hard
  to spot; one confirmation with evidence is cheap insurance.
- **Fallback when the agent isn't available:** a similarity/heuristic matcher
  picks *which field is the key* — the field pair whose normalized value sets
  overlap most (Jaccard on sampled values) + name/format heuristics. No model
  required.

### Matching is normalize-then-exact (no fuzzy joins)
- Deterministic differences are handled by **normalization**, not fuzzy
  matching: trim whitespace + lowercase + strip trailing slash + strip
  host/known prefix. After normalization, rows match on **string equality**.
- Fuzzy/similarity matching on the key itself is banned — it produces silent
  false joins. Similarity is used *only* by the no-AI fallback above to pick the
  key field; the actual row match stays exact. No join confidence threshold.

### Manual row-pin = v2 (deferred)
- A manual "pin row A ↔ row B" override gets complex fast (per-row override
  store, UI, conflict surface). **Defer to a later version.**
- We don't need it for v1 correctness: with the outer join, rows whose key
  doesn't normalize cleanly just appear **un-joined** (their other-source
  columns blank) — visible and graceful, not silently broken.

### Column model — single-bind by default, opt-in merge/sync (proposed)
The tension: per-column single-source is clean, but the tool is only useful if
some columns can **stay in sync across sources** (Notion + Builder title/date
kept identical). Proposed reconciliation that avoids read-time merge magic:

- A column binds to **one primary source** (defines the displayed/read value and
  is a write target).
- A column may optionally bind **mirror sources** (additional write targets).
  A column with mirrors is a **merged/synced column**: editing it fans the write
  out to the primary *and* all mirrors, keeping them in sync.
- **Reads** always show the primary — no ambiguity. If a mirror drifts upstream,
  that's caught at push time by the existing `conflictState: "source_changed"`
  primitive (same model-B conflict handling we locked).
- Merge is **opt-in, manual, at table setup** — never implicit.
- Merge sits **on top of the join**: you can only sync two sources' columns for
  the *same entity*, which requires the canonical-key join to exist first.
- **Write fan-out is inherently a live-write feature** → the synced-column
  *behavior* activates with the live-write PR. The column *model* (primary +
  mirrors) can be designed/stored earlier; it just displays the primary until
  writes are enabled.

### Write routing (forward-looking, compatible)
Each column writes back to its own source; in a multi-source row, push is
per-source. The outbound change-set already carries `sourceId`, so per-source
routing is natural, and the "Review diff" slot would group pending changes by
destination source. (Lives in `BUILDER-LIVE-WRITE-PLAN.md`.)

### Sources UX hierarchy
Drill-down; the minimal read-only panel we already built becomes the **leaf**:

```
Sources (N)                              ← plural; count of connected sources
  Integrations
    └ Builder  [logo]                    ← provider w/ brand mark (live)
         └ "<real space>" (derived)      ← the authed space for THIS table
              └ blog-article             ← data model → existing read-only panel
    └ Notion  [logo]  (coming soon)
  Agent-Native apps  (opt-in ecosystem)
    └ Analytics  [logo]  (coming soon)   ← the agent-native analytics template
  Local tables  (later)
    └ <other database in this workspace> ← any local table can be a source
```

- Three groups: **third-party integrations** (Builder, Notion, …),
  **Agent-Native apps** (Analytics, …) which require opting into the open-source
  AN ecosystem, and **local tables** (any other content database in the
  workspace — this is what makes "any table is a source" / Notion-style relations
  work without a relation column; the join is configured here).
- Each integration has **provider-specific specifics** behind a common adapter.
  Deriving the Builder *space* display name is a Builder-only call: there is **no
  public-key path** to a space name — it comes from the **Admin GraphQL API**
  (`https://builder.io/api/v2/admin`, auth with the private `bpk-…` key we hold
  at user scope) via the root `settings: JSONObject!` query (also
  `SpaceType.settings`). Exact field name is undocumented — confirm with one
  live query during NOW. Today we only persist `orgName` (a generic default).

### Provider adapter interface (sketch)
Common surface so new sources are "fill in the adapter": `listSpaces()` /
`deriveSpaceName()`, `listModels()`, `readEntries()`, `keyField` +
`normalizeKey()`, and (later) `writeField()`. Builder, Notion, Analytics each
implement it; the federation/join/merge logic stays provider-agnostic.

## What already supports this (build on, don't rebuild)
- `content_database_sources` is keyed by `databaseId` — schema already allows
  **N sources per database**; code just assumes one (`getExistingSource`).
- `content_database_source_fields` already carries per-column provenance.
- `evaluatePropertyFormula` (`shared/properties.ts`) — the engine for
  key-normalization formulas (needs string ops: `replace`/`lower`/`slug`/regex).
- `list-builder-cms-models` — the drill-down's leaf list.
- The simplified read-only Source panel — becomes the per-model leaf view.

## Phasing

### NOW — UX shell (this PR)
- Rename "Source" → **"Sources"** (plural, with count); build the drill-down
  (Sources → Builder → derived space → models), **Builder-only**.
- **Derive the real Builder space name** (Builder API), replacing the generic
  `orgName`.
- Wire the existing minimal panel as the model leaf. Single-source flow keeps
  working with zero key ceremony.
- No join/merge logic yet — proves the model + navigation end to end.

### NEXT — read-side federation, identity joins only (this PR)
- **Canonical key** as an explicit (but progressively-disclosed) property.
- **Per-source key-normalization formula**; AI-suggested key + similarity
  fallback; formula-language string extensions.
- Replace the Builder adapter's brittle lowercased-title matching with the
  canonical-key join.
- **Outer-join a second source's columns onto existing rows (read-only):**
  display columns from >1 source on the same row. (Use a real second source if
  one's ready; otherwise validate with Builder + a fixture/local source.)
- Store the column model (primary + optional mirror bindings); display primary.
- **Design the typed `join` record now** (`kind: identity | reference`, see Core
  model) even though only `identity` is built — so reference joins drop in later
  with no schema change. Identity-only here.

### LATER — truly later (separate PRs)
- **Reference joins (lookups)** — its own sub-phase: match a row field against a
  related collection's key, pull derived columns. Single-value first; the
  relation/cardinality machinery is what makes this bigger than NEXT.
- **Local tables as sources (identity)** — shipped in NEXT (2026-06-18). Reference-
  join mode for local tables follows with the reference-join sub-phase.
- **Multi-value reference joins** (co-authors → list columns + aggregation).
- Additional adapters: **Notion**, **Analytics** (AN analytics template), Sigma.
- **Merged/synced columns** write fan-out — depends on the live-write layer.
- Conflict UX for diverged mirrors.
- **Manual row-pin** escape hatch (v2).

## Resolved (2026-06-17)
- **Canonical key:** single property; composite via formula-concat if ever needed.
- **Agent key suggestion:** interactive lightweight confirm (propose → sample
  matches → confirm/edit → commit), not silent one-shot.
- **Matching:** normalize-then-exact; no fuzzy joins, no confidence threshold.
- **Builder space name:** Admin GraphQL `settings` query, private-key auth (no
  public-key path). **Spike confirmed (NOW):** the display name is the
  `settings.name` field; `settings.id` is the space's public key. Private key is
  reliably present at user scope post-cli-auth (`credentialSource: "user"`).
- **Status-route integration:** the space lookup is **non-blocking** — the
  `/status` route returns whatever is cached and warms the cache in the
  background (`getCachedBuilderSpaces` + fire-and-forget `listBuilderSpaces`), so
  the connect-flow polling never blocks on Builder. The admin call has a hard
  4s timeout; resolved names cache 5min, empty/failed lookups 60s. (See
  `packages/core/src/server/builder-space.ts`.)

## NOW status — shipped
The NOW phase is built and browser-QA'd: Sources (plural) → grouped Integrations
(Builder live; Notion coming-soon) + Agent-Native apps (Analytics coming-soon) →
Builder → space list (real derived name) → models (attached model marked) →
read-only leaf. Single-source flow unchanged.

## NEXT status — shipped (overlay)
The NEXT phase (identity joins, **overlay** form) is built, unit-tested, and
browser-QA'd end to end:
- **Formula engine** gained string ops (`lower/upper/trim/replace/slug/striphost/
  regexExtract/regexReplace`) plus `evaluateNormalizationFormula` (strict: null =
  un-joinable). (`shared/properties.ts`)
- **Storage:** typed `join` record + per-source `federation` block live in each
  source's `metadataJson`; the canonical-key descriptor rides on the **primary
  source's** `metadata.federation` (not `viewConfigJson`, to avoid the view-config
  normalizer dropping it). No migration. (`shared/api.ts`,
  `actions/_database-source-utils.ts`)
- **Read engine** (`actions/_federation-join.ts`): `computeNormalizedKey` +
  `federateSources` overlay a secondary source's matching rows by normalize-then-
  exact key. Orphan secondary keys are **dropped** (no virtual rows yet).
- **Local tables are the real second source** (decision 2026-06-18, replacing the
  synthetic fixture). A new `local-table` source type lets any other workspace
  database be federated: `list-content-databases` discovers candidates;
  `readLocalTableEntries` maps the target's rows/properties into source entries
  (keyed by property name); attach stores them additively (`insertSecondarySource`,
  read-only, empty-`documentId` join-by-key sentinel) and writes federation on both
  sources. A federated secondary has a clickable read-only leaf with **remove**
  (`disconnect` extended with `sourceId`).
- **Opt-in federated columns** (replacing always-on auto-inject): the secondary's
  fields appear in the add-column picker grouped **"From <source>"** (labeled
  *Federated*); adding one creates a real read-only column whose per-row value is
  populated from the matched overlay at read time (`applyFederatedOverlayValues`) —
  exactly how Builder source columns already work. No values are materialized onto
  local documents.
- **Suggestion** is a deterministic Jaccard heuristic (`actions/_join-suggestion.ts`
  + `suggest-source-join-key`), no LLM; the session agent can compose the same
  `join` record. Interactive **CanonicalKeyConfirmView** shows editable per-source
  formulas + a live sample-match preview before commit.
- Verified end to end: Builder primary + a **real** workspace database as the
  local-table source #2 → "Match on a key" (heuristic matched `data.url` ↔
  `Builder URL`, 5/5 samples) → confirm → add the secondary's `Blurb` field from the
  picker → values overlay read-only onto matched rows. Removing the secondary works.
  Single-source flow unchanged (673 tests green).

## Still open / deferred
- **Virtual (union) rows** — the immediately-following sub-step: render a read-only
  row for a secondary-only key. Requires editor read-path guards (no page open / no
  select-delete / pagination caveat). Engine is already the union engine.
- **Brittle matcher** — the primary's title/URL entry→item matcher is retained as a
  fallback; swapping it for the canonical-key matcher is a robustness follow-up (it
  doesn't affect join correctness, which reads stored `sourceValues`).
- **Column-header provenance marker** — overlay columns display read-only with their
  source labels; a header glyph naming the originating source is a polish follow-up.
- **Secondary resync on refresh** — refresh currently resyncs the primary only.
- LATER (unchanged): reference joins, local-table sources, multi-value, Notion/
  Analytics adapters, merged-column write fan-out, manual row-pin.
