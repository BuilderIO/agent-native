# Fix: double / re-refined logos when refining images

## Root cause

The canonical logo is **composited destructively into the stored asset's pixels**.
In `actions/generate-image.ts` (lines 466-479), when `includeLogo: true`,
`compositeLogo()` bakes the real logo into the image buffer, and that buffer is
the _only_ copy saved as the asset. There is no logo-free original.

Every "refine" path feeds that stored asset **back into the model as a reference
image**:

- `actions/refine-image.ts:70` passes the prior asset as `sourceAssetId`.
- `server/lib/generation.ts:1129` scores the source `+100`, `:1171`
  force-attaches it, and the prompt at `:919` tells the model source images
  "provide content or composition" / "prior candidates define continuity."

So the model receives an image with a logo baked into the upper-right and
faithfully tries to reproduce it. That produces the two symptoms:

1. **AI re-draws the logo** — even though `refine-image` sets `includeLogo:
false`, the reference _already shows_ a logo, so the model paints its own
   smeared approximation. This is precisely the degradation the composite
   pipeline exists to avoid.
2. **Double logos** — when refine (or any later `generate-image` that picks this
   candidate as a reference) runs with `includeLogo: true`: the model draws a
   logo-ish element in the corner _and_ `compositeLogo()` overlays the real one
   on top. Misalignment → the underdrawn one peeks out beside the real one. The
   logo-composite skill's "Failure modes" section documents exactly this.

There's also a **leak path**: generated candidates have role `"generated"` and
aren't excluded from `selectReferences` (only mildly penalized in restyle), so a
logo-baked candidate can be auto-selected as a reference for _unrelated_
generations too.

The fundamental flaw: **the logo is treated as stored pixels rather than a
presentation layer**, and refine has no way to get a clean version back.

## Solution

Core idea: **keep a logo-free base image and only ever feed _that_ to the model;
composite the real logo as the last step.**

Scope decision: store the clean base in asset **metadata** (additive, no
migration). The composited image remains the asset's displayed/exported image.

## Implementation steps

### 1. Persist the logo-free base when compositing

**File:** `actions/generate-image.ts:466-479`

Before `compositeLogo()` overwrites `image`, keep the pre-composite buffer. After
compositing, `putObject` the clean buffer under a derived key (e.g.
`<runId>-base.png`) and thread its key + mimeType into the
`createAssetFromBuffer` metadata at `:533-549` as `baseObjectKey` /
`baseMimeType`. The displayed/exported asset stays the composited image — only
metadata gains a pointer. Purely additive; no migration.

### 2. Feed the clean base to the model, never the composite

**File:** `server/lib/generation.ts` — `loadReferenceData` (lines 1195-1250, the
loader that base64-encodes each reference's bytes)

When a selected reference asset's metadata has `baseObjectKey`, load **that**
object instead of `asset.objectKey`. This is the keystone: refine/restyle/edit
and ordinary reference selection all go through this loader, so the model stops
seeing any baked-in logo → no re-draw, no underdraw-then-overlay.

### 3. Carry the logo intent forward in refine

**File:** `actions/refine-image.ts:68`

Replace hardcoded `includeLogo: false` with the source asset's recorded intent —
read `metadata.includeLogo` (already stored at `generate-image.ts:542`). So
refining a branded hero re-composites the real pixel-perfect logo onto the fresh,
clean result instead of silently dropping it or smearing it. Apply the same
carry-forward to `actions/restyle-image.ts:57` (uses `subjectAssetId`).

### 4. Prompt guard for legacy assets (no stored base)

**File:** `server/lib/generation.ts:919` (and the restyle branch at `:917`)

Append to the source/prior-candidate instruction: _"A source or prior image may
contain a composited brand logo; do not reproduce, redraw, or approximate any
logo — keep that area clean."_ This covers assets generated before this change
that have no `baseObjectKey`.

### 5. Stop logo-baked candidates leaking as auto-references

**File:** `server/lib/generation.ts:1109-1152` (the `selectReferences` candidate
filter)

Exclude (or strongly penalize) `role: "generated"` assets whose
`metadata.includeLogo === true` from being auto-picked as references when they
weren't explicitly requested — so a branded candidate doesn't bleed a logo into
an unrelated generation.

### 6. Update docs/skill

**File:** `.claude/skills/logo-composite/SKILL.md`

Document the base-vs-composite split, that references always use the clean base,
and the refine carry-forward contract. Update the "Failure modes" section (the
"peeks out behind a transparent logo" note) since that path is now resolved.

## Tests

Extend `actions/generate-image-batch.spec.ts` / a refine-image spec and
`server/lib/image-processing.test.ts`:

- (a) a `baseObjectKey` is stored when `includeLogo` is set,
- (b) refining that asset attaches the base bytes (not the composite) as the
  source reference, and
- (c) `includeLogo` is carried forward so the result is re-composited once.

## Four-area coverage (per CLAUDE.md)

- **Actions:** generate-image, refine-image, restyle-image (edit-image already
  neutral).
- **Server lib:** image-processing (save base), generation (reference loader,
  prompt, candidate filter).
- **Skills/instructions:** logo-composite skill.
- **Data/state:** additive asset metadata only — no schema migration.

## Edge cases

- **Pre-existing assets** without a base → step 4's prompt guard is the fallback.
- **SVG/PNG transparency** of the base buffer — store base as PNG to match
  `compositeLogo`'s output assumptions.
- **`set-canonical-logo`** is unaffected: pinned logos are `logo_reference` and
  intentionally fed as accurate brand references; only `generated` +
  `includeLogo` candidates are filtered in step 5.

## Suggested sequencing

Steps 1–3 are the actual fix; 4–6 harden and document. Land them in one pass.
