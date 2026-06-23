# Builder `autoSaveOnly` contract findings

**Slice:** `slice/builder-autosave-verify`
**Date:** 2026-06-22
**Harness:** `templates/content/scripts/builder-autosave-contract/`
**Question being answered:** Does `PUT/PATCH …/api/v1/write/{model}/{id}?autoSaveOnly=true`
stage a revision *without* changing the live published artifact? This assumption
is Fusion-proven but was **not** Builder-verified, and it gates un-gating live
Builder writes in the content template.

---

## TL;DR / recommendation

**Conditional GO — pending one gated live write.**

Read-only evidence against the real Builder delivery API confirms the *delivery
half* of the contract: a published entry that carries staged autosaves
(`meta.hasAutosaves: true`) still delivers its **published** content
(`published: "published"`, `stageModifiedSincePublish: false`). The delivery
envelope exposes purpose-built fields (`meta.hasAutosaves`,
`stageModifiedSincePublish`, `rev`) that let us *verify after every write* that
the live artifact did not move.

The *write half* — that `?autoSaveOnly=true` itself flips `hasAutosaves` to
`true` while leaving `published` and the delivered body untouched — still needs
one controlled live write against a throwaway entry to be backed by raw
evidence. **The harness is complete and ready to produce that evidence the
moment a safe credential + test space is provided.** Until then, keep live
writes gated.

See [Safety / why live writes did not run](#safety--why-the-live-write-half-did-not-run).

---

## How to reproduce

```bash
cd templates/content

# Plan only — no network, safe anywhere:
node --experimental-strip-types scripts/builder-autosave-contract/run-contract.ts

# Read-only delivery probe (needs only the public BUILDER_API_KEY):
node --env-file=<env-with-public-key> --experimental-strip-types \
  scripts/builder-autosave-contract/probe-readonly.ts --model blog-article

# Full live contract run against YOUR throwaway entry (needs BOTH keys):
node --env-file=.env.local --experimental-strip-types \
  scripts/builder-autosave-contract/run-contract.ts --live \
  --model zz-autosave-contract-test-model

# Add the destructive unpublish probe (Q3), throwaway entry only:
... --live --allow-unpublish-test
```

Credentials (read from env, never hard-coded):
`BUILDER_PRIVATE_KEY` / `BUILDER_CMS_PRIVATE_KEY` (write) and
`BUILDER_API_KEY` / `BUILDER_PUBLIC_KEY` (public delivery). A `--live` run
**requires both** — without the delivery key the harness cannot read delivered
state to assert the invariants, so it refuses to run rather than emit an
unverified GO.

**Safety gates enforced in code (not convention):**

- Live writes refuse any model that is not test-named (`zz-*` or containing
  `autosave-contract-test`) unless it is explicitly passed via `--allow-model
  <name>`. There is no default production model.
- Mutating client calls (`createEntry`/`patchEntry`) require an opaque
  capability token (`MutableModel` / `MutableTarget`) that only `safety.ts` can
  mint — a bare model/id string is rejected at runtime. A write into unvetted
  content is therefore unrepresentable, not merely discouraged.
- The throwaway entry is created as a **draft** (`published:"draft"`), so even
  the harness's own entry is never pushed live.

Raw captured request/response is written to
`scripts/builder-autosave-contract/evidence/`. Every persisted field flows
through a single recursive redaction path that strips credential-looking query
params (`apiKey`, `api_key`, `key`, `token`, `privateKey`, …) **anywhere** —
including ones nested inside embedded URLs such as Builder pixel/preview URLs —
and credential-looking object fields in request/response bodies and headers.

---

## Evidence captured this run (read-only, real space)

Two `GET https://cdn.builder.io/api/v3/content/blog-article` calls — published-only
and `includeUnpublished=true` — both `HTTP 200`. Raw envelope saved to
`evidence/readonly-probe-*.json`. The delivery result carries these top-level
fields:

```
createdBy, createdDate, data, firstPublished, folders, id, lastUpdated,
lastUpdatedBy, meta, modelId, name, previewUrl, published, query, rev,
screenshot, stageModifiedSincePublish, testRatio, variations
```

`meta` includes: `breakpoints, hasAutosaves, hasErrors, hasLinks, kind,
lastPreviewUrl, shopifyDomain`.

The load-bearing observation (3 real published articles):

| name (truncated)                         | published     | meta.hasAutosaves | stageModifiedSincePublish |
| ---------------------------------------- | ------------- | ----------------- | ------------------------- |
| Building in the Age of Collaborative…    | `published`   | `false`           | `false`                   |
| AI Sped Up Coding Faster Than…           | `published`   | `false`           | `false`                   |
| How to Make AI Agents Follow Your Design…| `published`   | **`true`**        | `false`                   |

The third row is the proof point: a **live, published** entry that **has staged
autosaves** yet still delivers published content (`stageModifiedSincePublish:
false`). Autosaves and the published artifact coexist; the delivery API returns
the published revision regardless of `hasAutosaves`.

---

## Answers to the 5 questions

### Q1 — What does `PUT …?autoSaveOnly=true` do to an already-published entry? Does the live delivered artifact stay unchanged?

**Answer (read-evidence: strongly supports YES; write-side confirmation
pending one live run).**

- Real evidence: an entry with `meta.hasAutosaves: true` is still served as
  `published: "published"` with `stageModifiedSincePublish: false` — i.e. the
  presence of staged autosaves does **not** change what delivery returns.
- The production write adapter (`_builder-cms-write-adapter.ts`) issues exactly
  `PATCH /api/v1/write/{model}/{id}?autoSaveOnly=true&triggerWebhooks=false`
  with a `data`-only body (no `published` field), so it never asks Builder to
  change publish state.
- **Remaining gap:** that the write call *itself* leaves `published` and the
  delivered marker unchanged still needs the gated live run. When it runs, the
  harness **asserts** (it does not just capture): the autosave PATCH returns
  HTTP ok, `published` is unchanged from the `q1-baseline-delivery` baseline,
  and the delivered `data.marker` is unchanged. If any assertion fails the
  finding is recorded as `failed` and the process exits nonzero — a violated
  contract can never read as a GO.

### Q2 — Does it create Builder History autosaves? Trigger webhooks? Change `lastUpdated` / delivery-cache behavior?

**Answer (partially answered from real evidence; rest harness-ready).**

- **History autosaves:** Yes — Builder exposes `meta.hasAutosaves`, and we
  observed it `true` on a real published entry. `?autoSaveOnly=true` is the
  documented mechanism that produces those autosave revisions. The live harness
  **asserts** `meta.hasAutosaves === true` on the `includeUnpublished` re-read
  after the autosave PATCH; a `false`/missing value is recorded as a `failed`
  finding.
- **Webhooks:** The adapter sends `triggerWebhooks=false`, so autosave writes
  suppress webhooks by design. The harness records the write response; webhook
  firing is observable only with a configured webhook sink (out of scope of a
  pure API harness — noted as a follow-up if webhook behavior must be proven).
- **`lastUpdated` / cache:** `lastUpdated` is a top-level delivery field; the
  harness re-reads with `cachebust` before and after the autosave so any
  `lastUpdated` movement is captured. Delivery cache is defeated via `cachebust`
  (matching the reference Fusion repo's read pattern).

### Q3 — What happens when `published: "draft"` is sent to an already-published entry *without* `autoSaveOnly`? (the unpublish risk)

**Answer: BLOCKED — harness ready (gated).** Not exercised this run because (a)
no safe throwaway entry was creatable and (b) the probe is destructive by
construction. The harness runs it only with `--live --allow-unpublish-test`, and
only against an entry it created this run whose name carries the
`zz-autosave-contract-test` prefix and whose model passed the live gate.

Expected (and the reason this path is gated in production): the draft PATCH sets
the entry's publish state to `draft`, so published-only delivery returns 0
results / 404 while the entry still exists under `includeUnpublished=true`. The
harness **asserts** exactly that: the unpublish PATCH is HTTP ok and
published-only delivery no longer returns the entry (`failed` otherwise). The
production adapter gates this behind `metadata.allowDraftWrites === true`
precisely because, against an already-*published* entry, it takes live content
down.

> **Caveat for the gated run:** because the harness now creates its throwaway
> entry as a *draft* (so nothing is ever pushed live), this probe characterizes
> the draft→delivery relationship rather than a true published→unpublished
> transition. To exercise the destructive published→draft path explicitly, the
> entry would first need to be published as a separate, equally-gated step. The
> non-destructive draft baseline is the safer default; the published-transition
> variant is left as an explicit opt-in if that exact transition must be proven.

### Q4 — Which response fields identify the live revision vs. an autosaved revision?

**Answer (answered from real evidence).** The delivery envelope distinguishes
them via:

- `published` — `"published"` vs `"draft"` (publish state of the delivered
  revision).
- `meta.hasAutosaves` — `true` when staged autosave revisions exist that are
  *not* what's being delivered.
- `stageModifiedSincePublish` — `true` when the staged/editor content differs
  from the published revision; `false` means published == stage.
- `rev` — opaque revision token; `lastUpdated` / `lastUpdatedBy` — last-write
  metadata; `firstPublished` — original publish timestamp.

So "is the live artifact still the published one?" = `published === "published"
&& stageModifiedSincePublish === false`, and "did an autosave land?" =
`meta.hasAutosaves === true`. These two are independent — which is exactly why
autosave is safe: it can toggle `hasAutosaves` without touching `published`.

### Q5 — How do scheduled entries behave? How to resolve duplicate handles/slugs when `includeUnpublished=true` returns more than one candidate?

**Answer (read-evidence + rule; per-entry confirmation harness-ready).**

- **Scheduled entries:** Builder carries scheduling via `startDate` / `endDate`
  on the entry; an entry can be `published` but outside its active window. The
  delivery query (`includeUnpublished=true`) surfaces these; the harness's
  `q5-query-by-handle` captures the full candidate set for inspection.
- **Duplicate handle/slug resolution:** `includeUnpublished=true` can return
  multiple candidates for one handle (e.g. a published entry plus a draft copy).
  Recommended deterministic rule, backed by the delivery fields above:
  1. Prefer `published === "published"` over `draft`.
  2. Among those, prefer the most recent `lastUpdated`.
  3. Use `id` as the final stable tiebreaker.
  This matches how the reference Fusion repo treats handle conflicts
  (`BLOG_SLUG_CONFLICT_WARNING`) — surface, don't silently pick. The harness
  records the raw candidate list so the rule can be validated against real
  duplicates.

---

## Safety / why the live write half did not run

- The seeded `templates/content/.env.local` in this worktree contains **only**
  `BETTER_AUTH_SECRET` — no Builder write key. The shell environment has no
  Builder key either.
- A populated `BUILDER_PRIVATE_KEY` exists in a *sibling* repo
  (`fusion-content-workspace-preserved-config-*`), but that key belongs to a
  **real production Builder space with live blog content**, not a discoverable
  dedicated test space. Per the harness's safety rules, writing/creating into
  unknown real content — even a new test model in a production space — is not
  something to do autonomously.
- Decision: ran only **read-only** delivery probes (using the *public* delivery
  key, never the private key) to characterize real response shapes, and left
  all writes gated. This follows the rule: *if you cannot guarantee an operation
  targets your own throwaway entry, do not run it — build the harness and
  document what's needed.*

### What is needed to finish the live half

1. A Builder space that is **safe to write to** — ideally a dedicated test
   space, or explicit confirmation that creating a `zz-autosave-contract-test-*`
   model + entry in the existing space is acceptable.
2. Its `BUILDER_PRIVATE_KEY` (write) **and** `BUILDER_API_KEY` (delivery) placed
   in `templates/content/.env.local`. Both are required — `--live` refuses to
   run without the delivery key, since it cannot otherwise assert the contract.
3. Run `… run-contract.ts --live` (and `--allow-unpublish-test` for Q3). The
   model must be test-named (`zz-*`) or passed via `--allow-model`. The harness
   creates its own throwaway entry **as a draft**, runs the autosave + (gated)
   unpublish probes against *only* that entry, asserts the invariants, captures
   raw evidence to `evidence/`, and prints the created entry IDs for cleanup.

When that runs clean — the run exits 0 with every finding `answered` because
the autosave PATCH flipped `meta.hasAutosaves`→`true` while `published` and the
delivered marker stayed unchanged — this becomes an unconditional **GO** to
treat `autoSaveOnly` as the canonical safe write mode. If any invariant is
violated the run exits nonzero with a `failed` finding and remains **NO-GO**.

## Security review & hardening (independent GPT-5.5 pass)

The safety guard was hardened over an adversarial review. Closed vectors:

- **Public token minting** — removed `__mint`; token construction is gated by
  unexported module-private key symbols (`MODEL_MINT_KEY` / `TARGET_MINT_KEY`).
- **Prototype / brand forging** — `.is()` now uses a true ECMAScript `#private`
  field (`#authentic in value`), not a copyable TS-`private` symbol, so
  `Object.create(prototype)` + brand-copy forgeries fail.
- **Raw-helper bypass** — `capture()` / `writeHeaders()` are `#private`; the only
  externally-callable write surface is the token-gated `createEntry`/`patchEntry`.
- **Token tampering** — minted tokens are `Object.freeze`d, so a vetted test
  token cannot be repointed at a production model/entry at runtime.
- **Guard monkey-patching** — token classes + prototypes are frozen, so `.is`
  cannot be reassigned to wave a forgery through.

**Known residual (accepted):** `ThrowawayRegistry.register()` trusts a
caller-supplied `id` (in-process code cannot prove an id belongs to an entry
this run created). Contained by the model gate: it only matters under an
explicit `--allow-model <production>`, and the shipped run flow only registers
the id `createEntry` just returned. Out of scope: code that replaces global
`fetch` or mutates `Object.prototype` could call Builder directly regardless of
this guard.
