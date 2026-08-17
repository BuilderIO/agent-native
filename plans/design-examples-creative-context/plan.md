# Pull past designs in as examples when generating new ones

## Answer

Design already has two context pillars — a design system index and templates
(skeletons like playbooks and LinkedIn ads). The desired third pillar is a
library of **examples**: fully-fledged past designs that are retrieved
automatically and conditioned on when generating net-new work, so "make our
fifth LinkedIn ad" is grounded in the previous four.

That pillar already exists as `@agent-native/creative-context`. It is a
governed, versioned corpus with hybrid retrieval, native code-level reuse, and
per-generation provenance. **Do not build a second vector store.** The
automatic pull-from-examples path is already wired into `generate-design`.

What is missing is not storage or retrieval. It is:

1. a curation front door, so the library is not empty;
2. a hardcoded per-source cap that structurally prevents retrieving four
   examples from one source;
3. a binding from a template to a context, so template selection deterministically
   selects the right examples; and
4. the template path never resolving context at all.

Four phases of plumbing and UI close all of it. No ranking-algorithm changes,
so no cross-app risk.

## Evidence

### The examples pillar already exists

`@agent-native/creative-context` is a governed creative corpus, not a design
system package ([README.md](../../packages/creative-context/README.md)). Its
object model is four layers:

- **Sources** (`creative_context_sources`) — Google Slides, Figma, Notion,
  websites, uploaded files, and _native_ app submissions.
- **Items** (`creative_context_items`) — carries `kind`, `tags`, `colors`,
  `curationRank` (`canonical | exemplar | normal | ignored`), `starred`, and
  `parentItemId` ([schema/index.ts](../../packages/creative-context/src/schema/index.ts)).
- **Versions** (`creative_context_item_versions`) — immutable and
  content-hashed, so an old generation can replay exactly what it saw.
- **Packs** (`creative_context_packs`) — the immutable receipt for one
  generation: exact `(itemId, itemVersionId)` evidence, lane scores, and
  selection reason.

A **Creative Context** is the durable, shareable collection people maintain
(Default, Marketing, Sales). Memberships carry `rank: canonical | exemplar |
normal`, so "these four are the exemplar LinkedIn ads" is already expressible.

Design registers a native capture adapter
([native-creative-context.ts](../../templates/design/server/lib/native-creative-context.ts))
that writes an immutable JSON snapshot and PNG previews to private blob
storage. Crucially, generic retrieval responses never expose the app-native
payload — only Design's typed clone actions
([clone-creative-context-design-native.ts](../../templates/design/actions/clone-creative-context-design-native.ts))
can resolve it. That is what makes real code reuse possible rather than
mood-boarding from screenshots.

### Automatic retrieval already runs

Every `generate-design` call resolves context with no manual input
([generate-design.ts](../../templates/design/actions/generate-design.ts#L291-L294)):

1. Read app state `creative-context`; bail on `contextMode: "off"`, replay
   `pinnedPackId` if set.
2. Resolve **Default + at most one specialty**. Precedence: explicit
   `selectedContextId` → app binding for the role → `selectSemanticSpecialty`.
3. Search both, fuse with a `+0.15` specialty boost, sort, take top N.
4. Write an immutable pack, return `reuseLabels`.

See [generation-context.ts](../../packages/creative-context/src/server/generation-context.ts#L279-L420).

### Ranking is curation-dominated

Final score is relevance plus `rankQuality()`
([retrieval.ts](../../packages/creative-context/src/server/retrieval.ts#L97-L117),
applied at [#L412](../../packages/creative-context/src/server/retrieval.ts#L412)):

| Signal                                 | Max contribution |
| -------------------------------------- | ---------------- |
| `starred` or `curationRank: canonical` | 1.00             |
| `curationRank: exemplar`               | 0.50             |
| recency                                | 0.03             |
| prior reuse count                      | 0.04             |
| helpful feedback                       | 0.04             |

Curation outweighs recency by roughly 30x. The system therefore retrieves the
_best-curated_ LinkedIn ads, not the _most recent_ ones — and retrieves nothing
useful until someone marks items `exemplar`.

### Retrieval lanes

Three lanes, fused, with `coverage` reported on every response:

- **lexical** — portable normalized grep, weighted title/summary/body.
- **fts** — PostgreSQL `tsvector`/GIN.
- **vector** — pgvector in the same `DATABASE_URL` database. Multimodal: one
  family covers text and image, and text queries _are_ embedded
  ([retrieval.ts#L312-L320](../../packages/creative-context/src/server/retrieval.ts#L312-L320)).

The vector lane requires `isPostgres()`, a resolvable
`GEMINI_API_KEY`/`COHERE_API_KEY`/`VOYAGE_API_KEY`
([core/embeddings/index.ts](../../packages/core/src/embeddings/index.ts#L217-L228)),
a dimension-matched active embedding set, and indexed metadata. An image query
without it throws; a text query silently degrades to lexical, reporting
`coverage.vector.available: false`.

## Settled decisions

| Question          | Decision                                                                             | Rationale                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ranking           | **Curation-led.** No changes to `rankQuality()`.                                     | `rankQuality` is shared by Slides, Assets, and Content. Reweighting recency would change retrieval for every app.                                |
| Template path     | **Resolve once at copy time**, attach one `contextPackId` to the generation session. | Per-edit resolution would let different editing passes pull different examples into one design and split provenance across several packs.        |
| Deployment        | **Postgres + embedding key.** Vector lane is live.                                   | Semantic text matching and image similarity both available.                                                                                      |
| Changeset         | **Required.**                                                                        | `@agent-native/creative-context` is public at 0.6.0 and absent from the `ignore` list in [.changeset/config.json](../../.changeset/config.json). |
| One-specialty cap | **Deferred.**                                                                        | Default + one specialty covers LinkedIn Ads. Lifting it changes ranking package-wide.                                                            |

Two consequences follow. Curation-led ranking makes Phase 4 load-bearing rather
than cosmetic — nothing is retrieved until items are marked `exemplar`. And
because Phase 2 passes `selectedContextId` explicitly, the brittle lexical
name-matching in `selectSemanticSpecialty` is bypassed entirely on the template
path.

## Implementation

Sequence: **4 → 1 → 2 → 3 → 5**, so retrieval is exercised against a real
populated library rather than fixtures.

### Phase 4 — "Save as example" curation UX

The bottleneck. No new action is needed: `review-context-items` already
supports `exemplar`, `star`, `normal`, and `ignore`
([review-context-items.ts](../../packages/creative-context/src/actions/review-context-items.ts#L16-L27),
store mapping at
[content.ts#L2245-L2255](../../packages/creative-context/src/store/content.ts#L2245-L2255)).

Add a "save as example" affordance beside the existing "save as template" on a
finished design. It submits through `manage-context-membership`, then marks the
resulting item `exemplar`.

### Phase 1 — Make `maxPerSource` tunable

`maxPerSource: 3` is hardcoded at
[generation-context.ts#L353](../../packages/creative-context/src/server/generation-context.ts#L353).
Every design submitted natively from Design shares one source, so the cap makes
"retrieve four ads" impossible.

Add `maxPerSource?: number` to `ResolveGenerationCreativeContextInput`
([#L159-L168](../../packages/creative-context/src/server/generation-context.ts#L159-L168))
and thread it into `searchInput`. Default stays 3, so Slides, Assets, and
Content are unaffected. `performCreativeContextSearch` already accepts the
field — this is pure plumbing. Needs a changeset.

### Phase 2 — Bind a creative context to a design template

Add an additive `contextId` column to `designTemplates`
([schema.ts#L30-L72](../../templates/design/server/db/schema.ts#L30-L72)) plus an
additive migration in
[db.ts](../../templates/design/server/plugins/db.ts), mirroring the existing
`designSystemId` link. `create-design-from-template` sets it on the design and
generation session; `generate-design` passes it as `selectedContextId`.

**No resolver changes are required.** `selectedContextId` is already an accepted
input
([#L166](../../packages/creative-context/src/server/generation-context.ts#L166))
and is honored on the local path at
[#L327](../../packages/creative-context/src/server/generation-context.ts#L327),
taking precedence over both the app binding and `selectSemanticSpecialty`.

### Phase 3 — Resolve context on the template path

Blocked on Phase 2.

`create-design-from-template` returns `nextRequiredAction` → `get-design-snapshot`

- `edit-design`, so `resolveGenerationCreativeContext` never runs and the
  template path retrieves zero examples. This is the one flow that most needs
  examples and currently gets none.

Resolve context once at template-copy time and attach the `contextPackId` to the
generation session so every downstream edit and variant inherits the same
immutable snapshot. This matches the existing rule in the `creative-context`
skill: keep one explainable snapshot across every screen and variant.

### Phase 5 — Update Design skills

Per the `adding-a-feature` four-area checklist, document the behavior in
`templates/design/.agents/skills/creative-context/SKILL.md` and the
`design-templates` skill: templates may carry a bound context, template selection
sets `selectedContextId`, and the template path resolves one pack at copy time.
Mirror into `templates/design/.claude/skills/`. Read `writing-agent-instructions`
first.

## Open loops

- **Recency.** If "the last four" ever needs to mean literal recency rather than
  curation quality, use the existing `updatedAfter` search filter rather than
  reweighting the shared `rankQuality()`.
- **Specialty naming.** `selectSemanticSpecialty`
  ([#L68-L88](../../packages/creative-context/src/server/generation-context.ts#L68-L88))
  is lexical name/description token matching, not embeddings, despite the name.
  Phase 2 bypasses it on the template path, but free-form prompts
  ("make a paid social creative") still depend on it matching a context name.
- **Multiple specialties.** Combining a LinkedIn Ads context with a campaign
  context simultaneously is out of scope and would require lifting the
  Default-plus-one cap.
