# Plan: Agent-Native Plan Commenting UX Overhaul

> Independent design plan (Opus 4.8). Goal: when a human leaves comments **and**
> edits on a plan and hands off to a coding agent, the agent receives **crystal
> clarity** on (a) exactly what is commented on — which text, which part of an
> image / wireframe / canvas, with a focused marked screenshot for visual
> comments, (b) the diff of edits, (c) whether each comment is for a **human** or
> the **agent** to resolve — plus collaboration-grade `@mention` tagging.
>
> This plan is written to be merged into an already-in-progress implementation.
> It is framed as **what already ships → the real holes → the fixes**, with
> verified `file:line` references so the implementing agent can act precisely.

---

## 0. TL;DR — answers to the five questions asked

| Question                                                                     | Today                                                                                                                                                                                                                                                                                                                        | Verdict                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Is it clear when a comment should be resolved by a **human vs the agent**?   | A `resolutionTarget` (`'agent' \| 'human'`) toggle exists in the draft UI (`PlansPage.tsx:4587`) and is surfaced to the agent as an `Expected resolver:` line (`comment-context.ts:198`) — but it lives **only inside the anchor JSON blob**, is not a DB column, and the handoff doesn't partition the agent's queue by it. | **Partly. Make it queryable + partition the handoff.**                   |
| Can you `@tag` org members with design-editor autocomplete + inline chips?   | Yes — `CommentMentionEditor` (`:4320`) + `useOrgMemberMentionSearch` → `/_agent-native/org/members` (`:433/:451`) + `@[label](mailto:email)` token grammar (`comment-context.ts:55`).                                                                                                                                        | **Yes, already built. Harden, don't rebuild.**                           |
| When you comment on a location and pass to the agent, is it **fully clear**? | For **text**: yes-ish — quote + section, with `contextBefore/After` fields that exist but are **unevenly populated**. For **visual/canvas**: **no** — the agent gets coordinates + a label only, and the screenshot path that does exist is **bound to the wrong DOM surface** so canvas pins capture garbage.               | **Text: tighten. Visual: broken — this is the #1 fix.**                  |
| Do agents get a **screenshot** of the visual location?                       | An in-app capture path exists (`captureFocusedFeedbackImages`, `:2289`, html2canvas + red-ring marker) but: (1) it rasterizes the **prose reader**, not the canvas world, so canvas/wireframe/diagram pins produce empty crops; (2) crops reach **only** the in-app inline agent — external/MCP agents get text-only.        | **No, not reliably. Fix the surface + deliver via the handoff.**         |
| Does text-by-location attach to the **nearest text**?                        | It stores `textQuote` + `sectionTitle`; `contextBefore/After` (prefix/suffix) exist in the type but aren't reliably filled, and `resolveAnchorTarget` silently picks the first match for duplicate phrases.                                                                                                                  | **Mostly — guarantee prefix/suffix + nearest blockId + ambiguity flag.** |

**The single highest-value bug:** canvas comments are screenshotted against the
prose reader surface, not the pan/zoom canvas. Everything else is enrichment;
this one makes visual comments actually work.

---

## 0.5 Scope & sequencing (the robustness contract)

The guiding rule: **don't ship a piece that looks robust while leaving hidden
inconsistency.** That specifically means the DB-column migration is _not_ "later" —
queryability is the point, so it lands in this pass, done additively and correctly
(see the migration hazard in §D). Buckets:

**Do now (this implementation) — low-risk, additive, high-clarity:**

- Queryable `resolution_target` column (+ the migration done right, §D).
- `mentions_json` mirror; `resolved_by` / `resolved_at` audit fields.
- Agent-vs-human partitions in the `get-plan-feedback` handoff (§H).
- Text prefix/suffix (`contextBefore/After`) + nearest-block anchoring (§F).
- Explicit visual-screenshot **overflow** manifest — never silently drop pins (§E3).
- **Fix the review-mode rich-text click bug** (hole #8) — it corrupts pin location.

**Do now, but with care — crosses fragile math:**

- The canvas screenshot **surface fix** (§E1). Validate the smallest safe patch;
  prefer the no-view-mutation region-rectangle capture over pan/zoom inversion.

**Deliberately deferred to v2 — would create false confidence if half-built:**

- A synthetic `@agent` **email** mention (use the `resolutionTarget` toggle / a
  first-class agent participant instead — §C/§D).
- Persisting base64 crops in SQL or `application_state` (no crop store in v1).
- A full server-side / headless crop renderer (needs storage + staleness +
  privacy design; `@resvg/resvg-js`/`playwright` are present but out of scope here).

---

## A. Verified current state (what already ships on this branch)

The concurrent implementation is well ahead of a greenfield design. Confirmed by
reading the live working tree:

- **Anchor model** — `templates/plan/shared/comment-context.ts` defines
  `PlanCommentAnchor` with `resolutionTarget`, `mentions[]`, `targetKind`
  (`text|image|wireframe|canvas|diagram|table|code|control|block|unknown`),
  `contextBefore/After`, `targetLabel/Text/Alt/Src`, `visualContext`. Helpers:
  `extractCommentMentions`, `formatPlanCommentMentionToken`,
  `parsePlanCommentAnchor`, `normalizePlanCommentAnchor`,
  `formatPlanCommentAnchorForAgent`, and `planCommentAnchorDetails()` which
  already emits `Expected resolver:`, `Location:`, `Target:`, `Text before/after:`,
  `Mentioned:` lines for the agent.
- **Mention authoring** — `CommentMentionEditor` (`PlansPage.tsx:4320`),
  `useOrgMemberMentionSearch` → `GET /_agent-native/org/members` (`:433/:451`),
  `@[label](mailto:email)` tokens stored in `message` + a normalized `mentions[]`
  array on the anchor.
- **Audience toggle** — a `resolutionTarget` control already lives in the comment
  draft (`:4587`), default `'agent'`.
- **Visual capture** — `captureFocusedFeedbackImages` (`:2289`) +
  `cropFeedbackScreenshot` (red-ring + numbered label burn-in) +
  `shouldCaptureAnchor`, gated to `MAX_FEEDBACK_SCREENSHOTS = 4`. Wired into the
  in-app "send feedback to inline agent" path only.
- **Handoff** — `get-plan-feedback.ts` returns flat `comments[]` + grouped
  `threads[]` with a text `anchorContext`; recent review events describe an
  edit/comment delta. `CLAUDE.md`/`AGENTS.md` already mention `@mentions` +
  resolver intent.

**Reuse all of the above.** Do not swap `CommentMentionEditor` for a Tiptap
rewrite, do not re-derive the anchor type, do not rebuild the mention grammar.

---

## B. The real holes (grounded, with file:line)

1. **Routing intent isn't queryable.** `resolutionTarget` lives only in the
   serialized `anchor` JSON (`comment-context.ts:33`, normalized `:138`). The
   `plan_comments` table (`server/db/schema.ts:53-74`) has no
   `resolution_target` column, so neither SQL nor the thread list can filter
   "agent queue vs human FYI" without JSON-parsing every row, and
   `get-plan-feedback` returns one flat list with no actionable/FYI partition.

2. **No resolution actor.** `status` flips open↔resolved with no `resolved_by` /
   `resolved_at` (`schema.ts:61-63`). Can't show "resolved by Steve", and nothing
   stops the agent silently closing a human-targeted thread. The two-axis state
   (`consumedAt` = agent ingested vs `status=resolved` = addressed) is real but
   undocumented in any SKILL.

3. **★ Canvas comments are rasterized against the wrong surface.**
   `captureFocusedFeedbackImages` (`:2289-2292`) hard-binds
   `reader = nativeReaderRef.current; surface = reader.parentElement`, positions
   the pin with `anchor.x/100 * reader.scrollWidth` (`:2309`), scrolls the
   **reader**, and calls `html2canvas(surface)` (`:2332`). Canvas / wireframe /
   diagram pins (`anchor.planAnnotationId`, `canvasX/Y`,
   `targetKind ∈ {canvas,wireframe,diagram,image}`) pass `shouldCaptureAnchor`
   but their `anchor.x/y` are percentages of the **CanvasArea board world**
   (`CanvasArea.tsx:330-331`), which is **not inside `surface` at all** — it lives
   in the pan/zoom viewport (`plan-canvas-viewport`, `CanvasArea.tsx:484`;
   `plan-canvas-world`, `:553`). Result: empty / garbage crops for exactly the
   comments that most need an image.

4. **Image budget is a dumb flat slice.** `MAX_FEEDBACK_SCREENSHOTS = 4` +
   `.slice(0, 4)` (`:2297`), no prioritization, no spatial clustering, no
   degrade-to-coordinates manifest, no on-demand single-crop. Dense nearby pins
   each burn a near-duplicate crop; the 5th+ silently vanishes.

5. **No structured human-edit diff, and human edits are mislabeled.**
   `update-visual-plan` writes a `plan.updated` event whose `reviewEventPayload`
   (`:227`) records only boolean flags + op names + id lists — never before/after
   content. Worse, `createdBy: onlyAddsNewComments ? "human" : "agent"` (`:358`)
   and `onlyAddsNewComments` requires `contentPatches.length === 0` (`:83`) — so a
   human's inline prose edit is logged as **`"agent"`**. Any diff gated on
   `createdBy === "human"` misses precisely the case it exists for.

6. **Crops only reach the in-app agent.** Capture runs in `sendToAgentChat`
   only. External/MCP agents calling `get-plan-feedback` (a JSON action) get
   text-only. `html2canvas` is a browser API and can never run headless on the
   action surface — design around it, don't wish it away.

7. **Text anchoring populated unevenly.** `contextBefore/After` (the W3C
   prefix/suffix that disambiguates duplicate phrases) exist but aren't reliably
   filled at capture; `resolveAnchorTarget` silently picks the first quote match
   with no ambiguity flag and no orphaned-comment handling when prose is rewritten.

8. **Review-mode rich-text click bug.** Review annotation mode makes prose
   read-only so a click pins feedback (`CLAUDE.md` Browser Editing). A
   click-targeting bug there lands directly on anchor fidelity: a mis-resolved
   click produces a wrong pin location → the agent gets the wrong context. This is
   in the same `readNativeSelectionComment` / `anchorFromRange` path the anchoring
   work touches, so fix it in this pass — **scoped to the comment-pinning path
   only**, not a general editor-focus refactor.

---

## C. Design principles

1. **Audience/resolution = queryable state, not parsed prose.** Promote
   `resolutionTarget` to a column; add `resolved_by`/`resolved_at`; mirror
   `mentions` to a column so notification fan-out never re-parses message text.
2. **Mention ≠ assignment ≠ resolver.** An `@mention` = FYI + notify + subscribe
   (a real person with a real email). `resolutionTarget` = who must close it.
   **"Direct to the agent" is expressed through `resolutionTarget='agent'`, not
   through a fake email mention** — do not mint a synthetic `agent@plan.local`
   identity that pollutes `mentions_json` and the email fan-out. A first-class
   inline `@agent` participant (span-level "do this here") is a v2 that needs a
   real agent-identity entity, not an email. (No separate `assignee_email` in
   v1 — see Risks.)
3. **Right artifact per comment.** Prose → text-only anchor (quote + prefix/suffix
   - nearest block). Visual → a **cropped** region with a **visible marker**
     (Set-of-Mark), never the full canvas as the per-comment artifact, never 100
     images. Cluster nearby pins into one multi-marker crop; degrade overflow to
     labeled coordinates; expose on-demand single crops.
4. **The handoff is one ordered, target-grouped manifest** — per target, the
   human's edit hunk first, then the comments about that target; open +
   agent-targeted first; resolved/human collapsed; orphaned surfaced, never dropped.
5. **Additive-only, Neon/Postgres-safe, dialect-agnostic.** No drops / renames /
   truncation. Backfill-on-read; dual-write for one release.

---

## D. Data model changes (additive only)

### `plan_comments` — `server/db/schema.ts:53-74`

```ts
resolutionTarget: text("resolution_target", { enum: PLAN_COMMENT_RESOLUTION_TARGETS }),
  // NULLABLE on purpose — see migration hazard below. null = "derive from anchor at read".
mentionsJson:  text("mentions_json"),  // JSON PlanCommentMention[] mirror for notify/filter
resolvedBy:    text("resolved_by"),    // email or 'agent' — who flipped status→resolved
resolvedAt:    text("resolved_at"),    // ISO timestamp
```

> **⚠ Migration hazard — do NOT add `resolution_target NOT NULL DEFAULT 'agent'`.**
> Postgres backfills the default into **every existing row at migration time**, which
> permanently shadows any old comment whose true target lives in its anchor JSON —
> "column wins when present" then means the column is _always_ present and _always_
> `'agent'`, and backfill-on-read becomes dead code (silent data loss for
> human-targeted comments). Pick one:
>
> 1. **Nullable-first (recommended):** add the column with **no default**;
>    backfill-on-read derives the value; in a _later_ release, once dual-write has
>    populated real values, add `NOT NULL` + default. **OR**
> 2. **Data backfill at migration time:** add `NOT NULL DEFAULT 'agent'` _and_ run a
>    one-time pass reading each row's `anchor.resolutionTarget` to write the true value.
>
> `mentions_json` / `resolved_by` / `resolved_at` are genuinely nullable (null =
> unknown / unresolved), so they carry no such hazard. Confirm the approach against
> the repo's migration/startup pattern; additive only, never `drizzle-kit push` at
> prod, Neon-dialect-agnostic.

- Re-export `PLAN_COMMENT_RESOLUTION_TARGETS` from `shared/types.ts` (it currently
  lives in `comment-context.ts:1`); extend the `PlanComment` interface
  (`shared/types.ts:104-119`) with the optional fields.
- **Backfill-on-read** in `toComment()` (`server/plans.ts:334-353`): when the
  column is null (old rows) derive `resolutionTarget` from
  `parsePlanCommentAnchor(row.anchor).resolutionTarget` (default `'agent'` only when
  genuinely unknowable), and `mentions` from `extractCommentMentions(row.message)` ∪
  `anchor.mentions`. **Column wins when non-null.**
- **Dual-write** for one release: writers set both the column **and**
  `anchor.resolutionTarget`/`anchor.mentions`, so a rollback still reads cleanly.
  Drop the anchor-side write after one release.
- Extend `commentInputSchema` (`server/plans.ts:51-62`) +
  `buildInitial/UpdatedPlanCommentRows` to accept/dual-write the new fields and to
  stamp `resolvedBy`/`resolvedAt` on resolve.

### Anchor JSON — `shared/comment-context.ts` (rides existing `anchor` TEXT column)

```ts
blockType?: string;   // 'rich-text' | 'table' | 'code' | ... — category of a text target
ambiguous?: boolean;  // set by the resolver when textQuote matched >1 location
markerSeq?: number;   // stable per-comment number burned into Set-of-Mark crops
```

`resolutionTarget`, `mentions[]`, `contextBefore/After`, `targetKind` **already
exist** — reuse.

### `plan_events` — no schema change

The human-edit diff rides the existing free-form `payload` TEXT column on a **new
event type** `plan.human-edited`. Crops are **fully ephemeral** — generated in the
browser at handoff and passed straight to the inline agent. **Do not persist
base64 crops in SQL or `application_state`** (same base64-in-SQL bloat that bit
Clips, just smaller). A real crop store (blob/asset references with
staleness/privacy handling) is v2 if/when headless agents need images.

---

## E. Visual comment region-screenshot pipeline + image budget

### E1. Fix the surface bug first (highest value — but with care; it crosses pan/zoom math)

This is the "do now, with care" item. Validate the **smallest safe patch**; a
sub-agent is A/B-ing the two approaches below. **Prefer A** — it touches the least
fragile math.

- **Approach A (preferred): region-rectangle capture, no view mutation.** Canvas
  pins already carry board-world coords (`anchor.canvasX/canvasY`) and the board
  dims are known (`CanvasArea.tsx:330-331`). Forward a ref to the
  `plan-canvas-world` element (`:553`) and rasterize **only the region rectangle**
  via `html2canvas`'s `{ x, y, width, height }` capture window (plus
  `windowWidth/windowHeight` as needed). No pan, no zoom inversion, no mutation of
  the user's view, no full-board memory blow-up — you compute the region rect from
  known coords and capture just it. This sidesteps the racy "move the view, wait,
  snapshot, restore" dance entirely.
- **Approach B (fallback): pan-to-center.** Forward `canvasSurfaceRef` onto
  `plan-canvas-viewport` (`:484`) and export
  `panToAnnotation(annotationId | {canvasX, canvasY})` that inverts
  `clientPointToWorld` (`:313`, reusing `data-canvas-frame` bounds `:834`) to center
  the annotation, wait the existing double-`nextFrame()` so the transform settles,
  then `html2canvas(canvasSurfaceRef.current)`. Use only if A can't produce a clean
  rect for some surface type. Mutating the user's view mid-capture is the risk A avoids.
- **`captureFocusedFeedbackImages`** (`PlansPage.tsx:2289`) — **branch per anchor**:
  - **prose** (`anchorKind==='text'`, or `x/y` are reader-relative) → existing
    `nativeReaderRef` path.
  - **canvas** (`anchor.planAnnotationId || anchor.canvasX != null ||
targetKind ∈ {canvas,wireframe,diagram,image}`) → Approach A (or B), feeding the
    same `cropFeedbackScreenshot`. Red-ring + label burn-in reused verbatim.
- **Crop sizing** — keep the ~760×520 CSS window but pre-size so the crop lands
  ~768–1024px on the long edge, so the burned-in ring + numbered label stay
  legible after Claude's vision downsample. Pad ~15–20% around the anchor.

### E2. `cropFeedbackScreenshot` → Set-of-Mark

Extend its signature from a single `{pointX, pointY, label}` to
`markers: {x, y, seq, label}[]`, burning N numbered red rings into one crop.
Single-marker callers keep working.

### E3. The image-budget algorithm (exact, numeric)

Replace `MAX_FEEDBACK_SCREENSHOTS=4 + .slice` with **prioritize → cluster → cap →
overflow**. Tuned to Claude vision economics (tokens ≈ w·h/750; a ~700px crop ≈
210–650 tokens; a full ~1092px canvas ≈ 1568, so ~8–10 crops ≈ one full canvas):

```
Constants:
  IMAGE_CAP        = 10     // hard ceiling on images per handoff (well under API 100/req, 32MB)
  CLUSTER_MAX_PX   = 1000   // a cluster's bbox long edge must stay under this
  CLUSTER_RADIUS   = 1140   // ~1.5 crop tiles — pins closer than this on the SAME surface merge
  OVERVIEW_LONGEDGE= 768    // one downsampled full-canvas overview

Step 0 PARTITION
  prose threads (anchorKind==='text' && textQuote)  -> NO image (text anchor only; 0 tokens)
  visual/canvas/wireframe/diagram/image/point        -> image-eligible (shouldCaptureAnchor)

Step 1 PRIORITIZE (score eligible desc)
  rank = (open ? 2 : 0)
       + (resolutionTarget==='agent' ? 2 : 0)
       + (visual/canvas/wireframe/diagram ? 1 : 0)
       + recencyBoost(createdAt) + min(replyCount,3)*0.2

Step 2 CLUSTER (greedy spatial, per surface)
  sort eligible by (surfaceId, y, x)
  for each pin: if it fits an open cluster on the SAME surface whose bbox stays
     <= CLUSTER_MAX_PX AND within CLUSTER_RADIUS -> add; else -> new cluster
  one crop per cluster, one numbered marker (markerSeq) per pin
  // 3 nearby pins -> ONE crop with markers 1,2,3 — never 3 near-duplicates

Step 3 CAP
  emit cluster crops in priority order until IMAGE_CAP produced
  if >1 cluster total, also emit ONE downsampled OVERVIEW crop for spatial orientation

Step 4 OVERFLOW (every eligible comment with no crop)
  degrade to TEXT: visualLabel + normalized coords (0..1 of original surface)
                 + sectionTitle + targetKind + message
  manifest line: "N more visual comments as coordinate+label only;
                  call get-comment-crop(commentId) for a focused crop of any pin."
```

This kills **both** named failure modes: never the whole board with tiny dots (we
crop + cluster), never 100 images (cap + degrade + on-demand). Run the same
selection logic in the client capture and mirror the **selection result** (which
comments got crops vs overflow) into `get-plan-feedback`.

### E4. Delivery to external / MCP agents

- In-app inline agent: gets clustered crops automatically via the fixed
  `sendToAgentChat` path.
- `get-plan-feedback` (JSON, can't return live pixels): returns, per visual
  thread, a `crop` **descriptor** (surface/frame id + normalized marker point +
  `cropAvailable: boolean`) + an instruction to call the new action.
- **NEW `get-comment-crop({ planId, commentId })`** — on-demand, precise text
  fallback in v1. Because `html2canvas` is browser-only **and we deliberately do
  not persist crops** (§D), this returns a structured `{ visualLabel, normalized
coords (0..1 of surface), sectionTitle, targetKind, anchor details, message }`
  payload — the agent gets exact localization without a fake "image coming" promise.
  Honest about the constraint. _(A real on-demand image — server-side
  rasterization via the present `@resvg/resvg-js`/`playwright`, or a proper crop
  store — is the v2 that closes this for never-opened/headless plans; see Risks.)_

---

## F. Text comment nearest-block anchoring

- **Always populate prefix/suffix.** In `readNativeSelectionComment` (`:2048`) and
  `anchorFromRange`, fill `contextBefore`/`contextAfter` with ~40–60 chars on each
  side **within the same `[data-block-id]` block** — the W3C `TextQuoteSelector`
  {prefix, exact, suffix} that disambiguates duplicate phrases.
- **Carry `blockType`** from the nearest block's content type so the agent knows
  the category.
- **Never image prose** — `shouldCaptureAnchor` already returns false for
  `anchorKind==='text' && textQuote`; keep it.
- **Resolution contract (documented in SKILL):** resolve verbatim → whitespace /
  smart-quote normalize → Levenshtein within ~5%. If the quote matches >1 location
  and prefix/suffix doesn't disambiguate, set `anchor.ambiguous=true` and emit an
  `Ambiguous: quote matched N spots` line so the agent **asks instead of editing
  the wrong span**. If the span no longer exists (prose rewritten), surface the
  comment in a dedicated `detached[]` bucket — **never drop it.**

---

## G. Edit-diff surfacing

- **Gating (critical):** do **not** gate on the event's `createdBy` — inline human
  edits are tagged `"agent"` (`:358`). Gate on a real human requester:
  `args.content === undefined && args.contentPatches.length > 0 &&
!isAnonymousPublicViewer(requesterEmail)` and the requester isn't the agent
  identity. (`requesterEmail = getRequestUserEmail()` is computed at `:74`.)
- **Capture before/after:** `bundleAtLoad` is already loaded for the version guard
  when patches are present (`:140-143`). Snapshot the touched `blockId` bodies
  before applying; compute a compact per-block diff after.
- **Persist** a **new** `plan_events` row `type: 'plan.human-edited'`:
  ```json
  { "edits": [{ "blockId","blockType","op","sectionTitle","beforeExcerpt","afterExcerpt" }] }
  ```
  Excerpts ≤ ~600 chars. No schema change (payload is free-form).
- **Surface:** `get-plan-feedback` builds `humanEdits[]` from `plan.human-edited`
  events since the agent's last consume, and **interleaves** each edit with the
  comment thread(s) anchored to the same `blockId`/`sectionId` in the
  target-grouped manifest — "what they changed here" next to "what they said."

---

## H. Unified `get-plan-feedback` handoff payload

Extend `get-plan-feedback.ts` **additively** — keep the existing flat `comments[]`,
`threads[]`, `recentReviewEvents`, `summary` for back-compat; add `targets[]`,
partitions, `detached[]`, `overflowVisual[]`, `instructions`, richer `summary`.
Ordering law: within `targets`, open + `resolutionTarget==='agent'` first; targets
with `humanEdits` before comment-only; resolved/human collapsed last; each thread
root carries its anchor (text block **or** one marked crop descriptor) once.

```json
{
  "summary": {
    "actionableCount": 3,
    "fyiCount": 2,
    "openCount": 4,
    "resolvedCount": 1,
    "humanEditCount": 2,
    "imageCount": 4,
    "omittedImageCount": 6,
    "detachedCount": 1
  },
  "instructions": [
    "Work the actionable (resolutionTarget=agent, open) threads first; they are your queue.",
    "Do NOT resolve human-targeted (FYI) comments unless the user explicitly asks.",
    "On every comment you ingest set consumedAt; set status=resolved + resolvedBy='agent' ONLY on agent-targeted comments you actually addressed.",
    "In crops, the red ring marks the exact commented point; marker coords are 0..1 of the original surface.",
    "Resolve text quotes fuzzily (verbatim -> normalize -> ~5% Levenshtein). If a quote is flagged ambiguous, ask — do not guess.",
    "Comments in `detached` no longer match their quoted text (prose was rewritten); reconcile, do not silently drop.",
    "For any pin in `overflowVisual`, call get-comment-crop(commentId) for precise localization (normalized coords + anchor details; a focused image only when one is available)."
  ],
  "targets": [
    {
      "targetId": "block_login_42",
      "kind": "block",
      "sectionTitle": "Login screen",
      "blockType": "rich-text",
      "humanEdits": [
        {
          "op": "update-rich-text",
          "beforeExcerpt": "Users sign in with email and password.",
          "afterExcerpt": "Users sign in with email, password, or Google SSO."
        }
      ],
      "threads": [
        {
          "id": "cmt_a1",
          "status": "open",
          "resolutionTarget": "agent",
          "commentNumber": 1,
          "kind": "correction",
          "anchor": {
            "mode": "text",
            "textQuote": "email, password, or Google SSO",
            "contextBefore": "Users sign in with ",
            "contextAfter": ". On success we redirect",
            "blockId": "block_login_42",
            "blockType": "rich-text"
          },
          "comments": [
            {
              "id": "cmt_a1",
              "authorKind": "human",
              "author": "Steve",
              "message": "Add Apple SSO too. @[Tiana](mailto:tiana@acme.com) flagging for visibility.",
              "createdAt": "2026-06-06T17:02:00Z"
            }
          ],
          "mentions": [{ "label": "Tiana", "email": "tiana@acme.com" }],
          "consumed": false
          // routing comes from resolutionTarget='agent' (the column), NOT from a mention.
          // @mentions are real people who get notified — never a synthetic @agent email.
        }
      ]
    },
    {
      "targetId": "ann_hero_cta",
      "kind": "canvas",
      "sectionTitle": "Landing wireframe",
      "humanEdits": [],
      "threads": [
        {
          "id": "cmt_b7",
          "status": "open",
          "resolutionTarget": "agent",
          "commentNumber": 2,
          "kind": "comment",
          "anchor": {
            "mode": "visual",
            "visualLabel": "Hero CTA",
            "canvasXNorm": 0.42,
            "canvasYNorm": 0.18,
            "image": {
              "type": "image",
              "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "<...>"
              },
              "caption": "Comment 2 (cmt_b7): Hero CTA — red ring marks exact point; coords 0..1 of original surface"
            }
          },
          "comments": [
            {
              "id": "cmt_b7",
              "authorKind": "human",
              "author": "Steve",
              "message": "Make this button primary and move it above the fold",
              "createdAt": "2026-06-06T17:05:00Z"
            }
          ],
          "mentions": [],
          "consumed": false
        }
      ]
    }
  ],
  "detached": [
    {
      "id": "cmt_old",
      "status": "open",
      "resolutionTarget": "agent",
      "orphaned": true,
      "anchor": { "mode": "text", "textQuote": "the old onboarding copy" },
      "comments": [
        {
          "id": "cmt_old",
          "authorKind": "human",
          "author": "Steve",
          "message": "tighten this",
          "createdAt": "2026-06-05T10:00:00Z"
        }
      ]
    }
  ],
  "overflowVisual": [
    {
      "commentId": "cmt_c9",
      "threadId": "cmt_c9",
      "visualLabel": "Footer links",
      "canvasXNorm": 0.5,
      "canvasYNorm": 0.94,
      "sectionTitle": "Landing wireframe",
      "message": "align these",
      "hint": "call get-comment-crop(cmt_c9) for a focused crop"
    }
  ],
  "overviewImage": {
    "type": "image",
    "caption": "Full canvas overview for spatial orientation",
    "source": { "type": "base64", "media_type": "image/png", "data": "<...>" }
  },

  "plan": { "...": "unchanged" },
  "comments": ["...legacy flat list, unchanged..."],
  "threads": ["...legacy grouped, unchanged..."],
  "recentReviewEvents": ["...unchanged..."]
}
```

Companion: **`get-comment-crop({ planId, commentId })`** returns one marked crop
(or the structured text fallback) on demand for overflow pins.

---

## I. Skill / instruction updates (triplicated — sync-guarded)

`packages/core/src/cli/skills.sync.spec.ts` enforces **byte-identical** copies.
Every agent-facing wording change must land in **all three** or the test fails:

1. `packages/core/src/cli/skills.ts` constants (`VISUAL_PLANS_SKILL_MD`,
   `UI_PLAN_SKILL_MD`),
2. `templates/plan/.agents/skills/<name>/SKILL.md` (canonical),
3. `skills/<name>/SKILL.md` (exported mirror).

Document in the shared cores:

- **Two-axis state:** `consumedAt` = "agent read it" (set on every ingested
  comment); `status=resolved` + `resolvedBy='agent'` = "agent fixed it"
  (agent-targeted only). Leave human-targeted / human-mention comments **open**.
- **Routing:** read `resolutionTarget` (the queryable column); act on `agent`,
  treat `human` as context-only. Routing is the column, **not** an `@agent`
  mention. `@mentions` are real people (notify/subscribe), not a routing signal.
- **Manifest:** read `targets[]` to pair human edits with the comments about them;
  open + agent first.
- **Crops:** red ring = exact point; coords are 0..1 of the original surface; call
  `get-comment-crop` for overflow pins.
- **Quotes:** resolve fuzzily; if `ambiguous`, ask; `detached` = orphaned (prose
  rewritten) — reconcile, don't drop.

Also extend (not byte-synced, keep consistent): `templates/plan/CLAUDE.md` +
`templates/plan/AGENTS.md`. (Note: `visual-questions/SKILL.md` was removed when
the plan skill set was trimmed to `visual-plan` + `visual-recap` only; skip it.)

---

## J. Ordered, phased work plan (each phase independently shippable)

**Phase 1 — Data model + routing (foundation).**
`schema.ts:53-74` add `resolution_target` (default 'agent'), `mentions_json`,
`resolved_by`, `resolved_at`. `shared/types.ts` re-export
`PLAN_COMMENT_RESOLUTION_TARGETS`, extend `PlanComment`.
`comment-context.ts` add `blockType`, `ambiguous`, `markerSeq`.
`server/plans.ts` `toComment` backfill-on-read; `commentInputSchema` +
`buildInitial/UpdatedPlanCommentRows` accept/dual-write; assign stable `markerSeq`;
stamp `resolvedBy/resolvedAt`.

**Phase 2 — Edit diff.** `update-visual-plan.ts` gate on real-human
`requesterEmail` (not `createdBy`); snapshot from `bundleAtLoad` (`:140-143`);
write `plan.human-edited` event (excerpts ≤600 chars).

**Phase 3 — Unified handoff.** `get-plan-feedback.ts` build `targets[]`
(humanEdits-first interleave), actionable/fyi partitions, `detached[]`,
`overflowVisual[]`, `instructions`, richer `summary`; keep legacy fields; read the
`resolution_target` column; flag `Ambiguous` on multi-match quotes. NEW
`actions/get-comment-crop.ts`. `comment-notifications.ts:147-181` read
`mentions_json`, fan out to mentioned non-participants.

**Phase 4 — Visual capture fix + image budget (the ★ fix; do with care).**
`CanvasArea.tsx`: expose the `plan-canvas-world` ref (`:553`) for **Approach A**
region-rect capture (preferred); only add `panToAnnotation` (Approach B) if A can't
produce a clean rect. `PlansPage.tsx` branch `captureFocusedFeedbackImages`
(`:2289`) for canvas pins; extend `cropFeedbackScreenshot` to multi-marker; replace
`.slice(0,4)` (`:2297`) with prioritize→cluster→cap→overflow (`IMAGE_CAP=10`);
pre-size crops ~768–1024px; add overview + overflow note. **Crops stay ephemeral —
no `application_state` cache.** Populate `contextBefore/After` + `blockType` in
`readNativeSelectionComment` (`:2048`) and `anchorFromRange`. **Fix the review-mode
rich-text click bug (hole #8) in this same path, scoped to comment-pinning only.**

**Phase 5 — Authoring UX.** `PlansPage.tsx`: the audience toggle already exists
(`:4587`) — wire it to the new column and mirror real mentions into `mentions_json`
on submit. A **"Direct to agent" composer affordance** (one click that sets
`resolutionTarget='agent'`) is fine — but it must set the toggle, **not** inject a
synthetic `agent@plan.local` mailto mention (no fake identity in `mentions_json` /
email fan-out). `@`-autocomplete stays scoped to real org members
(`useOrgMemberMentionSearch` `:433`). Add a who-resolves badge ("For the agent" /
"For you" / "@person") on pins + thread rows, and SQL-backed thread filters (For
the agent / Mentioned me / All / Show resolved). _(Zoom-out pin clustering + unread
dots: nice-to-have, defer. Inline first-class `@agent` participant: v2.)_

**Phase 6 — Skills + docs + tests.** Triplicated SKILL.md (all 3 + `skills.ts`
constants, byte-identical; run `skills.sync.spec.ts`). `CLAUDE.md` + `AGENTS.md`.
Tests: `get-plan-feedback.spec.ts` (targets grouping, image-budget selection,
overflow, detached, partitions); `update-visual-plan.spec.ts` (human-edit event
gated on `requesterEmail`, new comment fields, `resolutionTarget`, `resolvedBy`);
a unit test for the clustering algorithm.

---

## K. Risks & open questions

1. **`html2canvas` is browser-only** — external/MCP agents can't get freshly
   rendered crops on a never-opened plan, and **we don't persist crops in v1**.
   Mitigation: precise text anchors + normalized coords + `get-comment-crop`
   returning a structured localization payload (no fake "image coming"). **Open
   (v2):** a server-side rasterizer (the repo already ships `@resvg/resvg-js`
   ^2.6.2 and `playwright` ^1.60.0) or a proper crop store closes this — but only
   with deliberate storage/staleness/privacy design. Out of scope for v1.
2. **Migration is the one decision not to fumble.** Adding `resolution_target` with
   `NOT NULL DEFAULT 'agent'` silently overwrites human-targeted old rows (§D).
   Ship nullable-first (or a real data backfill from anchor JSON). This is the
   single change where a careless bolt-on produces exactly the "robust-looking but
   inconsistent" outcome we're avoiding. (Ephemeral crops have no staleness problem
   precisely because nothing is cached — a side benefit of not persisting.)
3. **No `assignee_email` in v1** — `resolutionTarget` + `@mention` carry
   assignment; we lose cross-plan "assigned to me" SQL. Acceptable (plans are
   single-doc scoped). Purely additive to add later.
4. **Dual-write window** — writing both column and anchor JSON for one release is
   transient; backfill-on-read (column wins) keeps old rows working with no
   destructive migration. Drop the anchor-side write after one release.
5. **Clustering heuristics are guesses** (`IMAGE_CAP=10`, `CLUSTER_MAX_PX=1000`,
   `CLUSTER_RADIUS≈1140`, crop ~768–1024px). Validate on real dense-comment plans
   and tune. Very dense overlapping pins still degrade to `overflowVisual` coords.
6. **Edit-diff cost** — bounded by ≤600-char excerpts and human-patch-only gating.
7. **Working-tree collision** — `update-visual-plan.ts`, `get-plan-feedback.ts`,
   `PlansPage.tsx`, `comment-notifications.ts` already have uncommitted edits on
   this branch. Land phases as small commits; rebase carefully.
8. **Canvas capture timing** — reuse the existing double-`nextFrame()` wait so the
   pan/zoom world transform settles before `html2canvas`.
