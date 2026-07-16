# Select-and-Reprompt Implementation Plan

Status: approved plan, not yet implemented.
Scope: `templates/design` only. All paths below are relative to `templates/design/`.

## What this feature is

Let a user select a region of a design screen, type a short instruction
("make this hero darker, tighter spacing"), and get a **scoped, previewed,
accept/reject** regeneration of *just that subtree* — instead of today's only
option, which routes the instruction into the open agent chat where the agent
has full edit freedom and applies changes directly.

Three properties distinguish it from the existing comment→agent flow:

1. **Scope is enforced, not requested.** The agent's write surface for a
   reprompt is exactly the selected subtree, enforced by a new action's shape
   (it can only splice at the target node) — not by prompt wording.
2. **Output is a proposal, not an applied edit.** The user sees the change
   rendered in place on the canvas and clicks Accept or Reject. Applied edits
   land as one atomic content transaction so a single undo restores the
   prior structure.
3. **It is ephemeral.** No review comment is created; the pin and proposal
   disappear on resolve. It is direct manipulation (like inpainting), not a
   review workflow.

There are **two entry points converging on one flow**:

- The existing canvas comment pin gets a second submit button, **Regenerate**,
  shown when the pin is anchored to an element.
- The canvas right-click context menu gets a **"Regenerate…"** item that drops
  a pre-anchored pin at the click point with the composer open in regenerate
  mode.

## Existing machinery to reuse (read these files first)

| Piece | Where | What it gives us |
| --- | --- | --- |
| Comment pins + anchor capture | `app/components/visual-editor/CanvasCommentPins.tsx` | Click-to-pin composer; anchors via `targetSelector` / `targetAnchorId` / `targetText` (`getTargetAnchor`); anchor-drift check (`pinAnchorStillPresent`); capability classifier `derivePinStatus` (its "deterministic" status = anchored + direct-edit language) |
| Chat transport | `app/lib/agent-chat.ts` — `sendToDesignAgentChat`, `sendToDesignAgentChatAndConfirm` | Delivers messages into the design agent chat, opens the sidebar, works when embedded in Builder/Frame |
| Scoped write path | `actions/apply-visual-edit.ts` | Targets a code-layer `nodeId` / `selector` / `sourceAnchor`; writes inline (SQL-backed) screens through `writeInlineSourceFile` + Yjs; its `target` refinement pattern should be copied |
| Preview/apply contract | `actions/preview-source-edit.ts`, `actions/preview-component-prop-edit.ts` | Precedent for preview-only actions: no DB/Yjs writes, return `bridgeMessages` the client pushes into the screen iframe via the existing `postMessage` channel; `expectedVersionHash` stale-edit detection (`sourceContentHash` in `shared/source-workspace.ts`). See `DESIGN-STUDIO-PLAN.md` §6.1/§7 |
| Canvas context menu | `app/components/design/CanvasContextMenu.tsx` | Typed shared menu: action-id union → `DEFAULT_LABELS` → shortcuts → id→handler map → per-item `can*` gating; layer-under-cursor resolution via `CanvasLayerHitCandidate` and the "Select layer" submenu pattern |
| Whole-screen variants precedent | `actions/present-design-variants.ts` | How multi-option presentation + `application_state` bookkeeping is done at screen granularity (this feature is the node-granularity sibling) |
| Atomic-undo precedent | `AGENTS.md` "Suggested auto layout" section | The rule: preview first, never mutate until the user applies, apply as ONE `apply-visual-edit`-backed content transaction so undo restores the exact prior structure |

## Architecture constraints that shape the design

- **All AI work goes through the agent chat** (repo `CLAUDE.md`). The UI must
  NOT call an LLM. Regenerate therefore sends a structured chat message; the
  agent (instructed via skill) responds by calling the new propose action.
- **Actions are the single source of truth.** No new REST/Nitro routes. The
  UI calls the new actions through the shared action client
  (`callAction` / `useActionMutation`).
- **Application state lives in SQL `application_state`** so the agent can see
  pending reprompts and active proposals.
- **v1 targets inline/Alpine (SQL-backed HTML) screens only.** Localhost and
  Fusion sources cannot be server-spliced the same way; gate every entry
  point on `sourceType === "inline"`.
- TypeScript only, oxfmt on modified files, shadcn/ui + Tabler icons for any
  new chrome, i18n for all user-visible strings (`app/i18n/*` — note
  `CanvasCommentPins` already localizes via `t(...)`).

## Implementation

### A. New actions

#### `actions/propose-node-rewrite.ts` (agent-called; preview-only)

Input (zod), modeled on `apply-visual-edit`'s `source`/`target` shapes:

- `source`: `{ designId?, fileId?, filename? }` — must resolve to an inline
  design file; copy the resolution + `accessFilter`/`assertAccess` scoping
  from `apply-visual-edit.ts`.
- `target`: `{ nodeId?, selector? }` — at least one required (same zod
  refinement pattern as `apply-visual-edit`).
- `baseVersionHash`: required; must match the live content hash (reuse the
  `sourceContentHash` / `expectedVersionHash` mechanics from
  `preview-source-edit.ts`). Read live content through the collab layer first
  (`hasCollabState`/`getText`) with SQL fallback, as `preview-component-prop-edit.ts`
  does.
- `variants`: array of 1–3 `{ html, summary }` — replacement outerHTML for
  the target subtree plus a one-line human summary each.
- `repromptId`: the client-generated id from the pending-reprompt record
  (ties proposal to request).

Behavior:

1. Resolve the target node in the code-layer projection
   (`buildCodeLayerProjection` in `shared/code-layer.ts`). Fail with a clear
   message if the node no longer exists ("target missing — re-anchor").
2. Parse/validate each variant's HTML. Scope is enforced **by construction**:
   this action only ever splices at the target node, so out-of-scope edits
   are impossible regardless of what the agent sends.
3. Persist a proposal record to `application_state` (see section D) with a
   generated `proposalId`. No design-file write, no Yjs write.
4. Return `{ proposalId, bridgeMessages }` where `bridgeMessages` render
   variant 0 in the iframe non-persistently (new bridge message kind — see
   section B3).

Mark `readOnly: false` is wrong here — it writes app state but not user
content; follow whatever convention `present-design-variants.ts` uses for
state-only writes.

#### `actions/resolve-node-rewrite.ts` (UI- and agent-callable)

Input: `{ proposalId, resolution: "accept" | "reject", variantIndex? }`.

- `accept`: re-validate `baseVersionHash` against live content. On match,
  splice the chosen variant into the file through the same inline write path
  `apply-visual-edit` uses (`writeInlineSourceFile` + Yjs seed/update +
  `annotateScreenHtmlForPersist` if applicable) as **one atomic content
  transaction** — single undo must restore the prior structure. On hash
  mismatch, fail loudly with "screen changed since proposal — regenerate";
  never rebase silently.
- `reject`: clear the proposal from `application_state`.
- Both paths clear the paired pending-reprompt record.

Retry is NOT an action: the UI sends a new `[Reprompt selection]` chat
message referencing the prior `proposalId` plus the user's refinement text;
the agent calls `propose-node-rewrite` again for the same target.

Specs: add `.spec.ts` for both actions mirroring the structure of
`apply-visual-edit.spec.ts` / `preview-source-edit.spec.ts`, including an
interleave spec (`*.interleave.spec.ts` pattern) covering the
propose→collab-edit→accept hash-mismatch case.

### B. UI

#### B1. Pin composer — second submit path

In `app/components/visual-editor/CanvasCommentPins.tsx`:

- Add a **Regenerate** button beside the existing send-to-agent submit.
  Visibility gate: `Boolean(pin.targetSelector || pin.targetAnchorId)` AND
  the active screen's `sourceType === "inline"` (thread `sourceType` in as a
  prop from `DesignCanvas.tsx`, which already knows it).
- When `derivePinStatus(...)` returns `deterministic`, make Regenerate the
  primary button; otherwise send-to-agent stays primary.
- On Regenerate submit:
  1. Generate a `repromptId`; write the pending-reprompt record to
     `application_state` (section D) via the client action surface.
  2. Send a structured message through `sendToDesignAgentChat` (section C
     defines the format), `{ submit: true, openSidebar: true }`.
  3. Mark the pin as a regenerate pin (new field on `CanvasPin`, e.g.
     `mode: "comment" | "reprompt"`). Reprompt pins are removed on
     accept/reject and are never persisted as review comments.

#### B2. Context menu entry

In `app/components/design/CanvasContextMenu.tsx`, following the existing
pattern exactly (action-id union, `DEFAULT_LABELS`, handler map, `can*` prop):

- New action id `reprompt`, label "Regenerate…".
- Gating: `canReprompt` = at least one resolvable layer candidate under the
  cursor (the menu already computes `CanvasLayerHitCandidate[]`) or an
  existing selection, AND inline source.
- When multiple layers stack under the cursor, mirror the "Select layer"
  submenu: `Regenerate → <layer candidates>` so the user picks the subtree
  explicitly. With an active selection, the top-level item targets it.
- Handler (wired in `DesignCanvas.tsx` / `MultiScreenCanvas.tsx` where other
  menu handlers live): drop a pin at the click point pre-anchored to the
  chosen layer's selector/nodeId, with the composer open in regenerate mode.
  From there the flow is identical to B1 — one flow, two doors.

#### B3. Proposal overlay (new component)

New `app/components/visual-editor/NodeRewriteProposal.tsx`:

- Watches `application_state` for an active proposal on the current screen
  (arrives via the existing `useDbSync` polling/SSE — no new transport).
- On proposal: highlight the target node, push the proposal's
  `bridgeMessages` into the screen iframe over the existing `postMessage`
  bridge to render the variant in place **without persisting**. This needs a
  new bridge message kind, e.g. `node-html-preview` (swap target subtree's
  outerHTML in the iframe DOM), implemented next to the existing
  `style-change` / `tweak-values` handling (`app/components/design/design-canvas/iframe-events.ts`
  and the embedded-frame bridge; find the handler for `style-change` and add
  the sibling case). Must be reversible client-side (keep original outerHTML
  to restore on reject/variant-switch).
- Floating chrome anchored to the node (shadcn primitives, Tabler icons):
  - Variant dots when `variants.length > 1` (phase 2) — switching pushes the
    other variant's preview.
  - **Accept** → `resolve-node-rewrite { resolution: "accept", variantIndex }`,
    optimistic (apply immediately, roll back the UI on error).
  - **Reject** → `resolve-node-rewrite { resolution: "reject" }` and restore
    original DOM in the iframe.
  - Inline refine input → sends the retry chat message (prior `proposalId` +
    feedback), keeps the same anchor/selection.
- Remove the originating reprompt pin on accept/reject.

### C. Chat message + skill contract

#### Message format (built by the pin composer)

```
[Reprompt selection]
repromptId: <id>
fileId: <design_files.id>
target: <nodeId or selector>
priorProposalId: <id>            # retries only
--- selected subtree (outerHTML excerpt, truncated) ---
<div class="hero ...">…</div>
--- instruction ---
make this darker and tighten the spacing
```

The pending-reprompt `application_state` record is the ground truth; the
message body is a human/agent-readable projection of it.

#### Skill / instruction changes

- `AGENTS.md` (template root) and `.agents/skills/visual-edit/SKILL.md`: add
  a hard rule — *when a chat message begins with `[Reprompt selection]`, the
  ONLY mutation path is `propose-node-rewrite` against the given target.
  Never `apply-visual-edit`, never `write-source`/local-file writes, never
  edits to other nodes or screens. Clarifying questions are allowed, but the
  answer to "change this" is always a proposal. Produce 1 variant unless the
  instruction asks for options (then up to 3). On retry messages (they carry
  `priorProposalId`), re-propose for the same target incorporating the
  feedback.*
- Document the accept/reject/retry lifecycle so the agent can also resolve
  proposals conversationally ("apply the second one") via
  `resolve-node-rewrite`.

### D. Application state (SQL `application_state`)

Two keys, both scoped per design/screen (follow the key-naming conventions
used by existing design app state — grep `writeAppState` usages, e.g. in
`present-design-variants.ts`, before inventing a scheme):

- `design.reprompt.pending`: `{ repromptId, fileId, target, instruction,
  createdAt }` — written by the UI at submit; lets the agent see what is
  awaited and lets the UI show a busy state on the pin.
- `design.reprompt.proposal`: `{ proposalId, repromptId, fileId, target,
  baseVersionHash, variants: [{ html, summary }], chosenIndex }` — written by
  `propose-node-rewrite`, cleared by `resolve-node-rewrite`.

Variant HTML is bounded (subtree only, ≤3 variants), so `application_state`
is acceptable. If real-world subtrees get large, move variant bodies to a
`design_proposals` table (additive migration, `ownableColumns()` + scoped
access) and keep only ids in app state — do NOT start there; start with app
state.

## Phasing

1. **Phase 1 — core loop (ship this first):** both actions + skill rule +
   pin Regenerate button + context menu item + `node-html-preview` bridge
   kind + proposal overlay with single variant + Accept/Reject. This is the
   complete feel of the feature.
2. **Phase 2 — iteration:** refine input on the overlay (retry keeps
   anchor), 2–3 variants + variant dots.
3. **Phase 3 — later:** keyboard shortcut on an existing selection;
   component-instance awareness (if the target is a component instance,
   route to `preview-component-prop-edit` / `swap-component-instance`
   instead of raw HTML rewrite); localhost/Fusion sources.

## Edge cases that must have spec coverage

- Anchor element gone between pin-drop and propose → `propose-node-rewrite`
  fails with "target missing"; agent relays it; pin shows the existing
  stale-anchor treatment (`pinAnchorStillPresent`).
- Collab edit lands between propose and accept → `baseVersionHash` mismatch
  → `resolve-node-rewrite` fails cleanly; UI prompts to regenerate; never a
  blind splice.
- Agent ignores the skill rule and calls `apply-visual-edit` for a reprompt →
  cannot be fully prevented server-side, but add a spec asserting
  `resolve-node-rewrite` is the only path that clears a pending proposal,
  and keep the skill wording absolute.
- Reject restores the exact pre-preview DOM in the iframe (client-side
  original-outerHTML restore).
- Accept then undo (Cmd+Z) restores the exact prior structure — one content
  transaction.
- Regenerate entry points hidden/disabled for `localhost`/`fusion` screens
  and for unanchored pins.

## Definition of done

- All four areas touched: UI (B1–B3), actions (A), skills/instructions (C),
  application state (D) — per the `adding-a-feature` skill.
- New/changed user-visible strings localized across `app/i18n/*`.
- oxfmt run on modified files; specs added per the patterns above and green.
- User-facing changelog entry recorded from the design template app:
  `agent-native changelog add "Select any element and regenerate just that part with an instruction — preview the result in place and accept or reject it" --type added`.
- No new Nitro/REST routes; no direct LLM calls from the UI; no schema
  drops/renames (any new table is additive only).
