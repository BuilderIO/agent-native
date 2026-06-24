# Review: unified image generation implementation

Review of the working-tree changes that implement
`UNIFY-GENERATION-PLAN.md`. Scope: the new generation-context spine, the
`<GenerationContextBar>` and `<GenerationTray>` components, the action-layer
changes, the route rewrites, and the one `packages/core` change.

## Verdict

The architecture is right and the plan was executed faithfully. The shared
`generation-context` application-state spine is clean, the three old surfaces
were genuinely collapsed (the popover, the home image-model menu, and the
direct picker call are gone), and the core change is minimal. But it is **not
shippable as-is**: the build is red, the tray's "close" silently deletes user
data, the composer bar isn't toolbar-native, and there are two threading/flow
regressions.

Priority order to fix: (1) tray close is destructive, (2) build break, (3)
threading + free-form flow bugs, (4) embedded picker regression, (5) bar
styling unification, (6) dead code + changeset + redundancy cleanup.

---

## 🔴 Must fix (blocking)

### 1. Closing the generation tray deletes every candidate

The tray header X calls `dismissSlot.mutate({ scope: "all" })`
(`app/components/generation/GenerationTray.tsx`). `dismiss-variant-slots` with
`scope: "all"` runs `db.delete(schema.assets)` for every slot
(`actions/dismiss-variant-slots.ts:48-55`). So the control that looks like
"close this panel" actually **permanently deletes all candidates** — one click,
no confirmation. This violates the project rule that destructive/irreversible
actions must not be one-click and must use a shadcn dialog.

Fix: separate the two concepts.
- **Hide / Minimize** — local React state, non-destructive; this is the default
  header control.
- **Clear all** — the destructive path, behind an `AlertDialog` confirm and
  visually de-emphasized.

The per-item **Dismiss** has the same delete effect; that is at least implied by
the word, but it should also read as destructive (it currently sits as an
equal-weight sibling of Save).

### 2. The build is broken (type error)

`npm run typecheck` fails:

```
app/routes/library.tsx(1025,32): error TS2339: Property 'model' does not exist on type 'GenerationPreset'.
```

The local `GenerationPreset` type (`app/routes/library.tsx:122`) has no `model`
field, but the new code reads `selectedPreset?.model`
(`app/routes/library.tsx:1025`). Fix: add `model?: string | null;` to that
local type, or import the shared `GenerationPresetSummary`.

### 3. Missing changeset for the core package change

`packages/core/src/client/AgentPanel.tsx` was modified (forwarding
`composerToolbarSlot` through `AgentSidebar`). Project rule: any `packages/core`
source change needs a `.changeset/*.md`. None exists for this work. CI will
flag it.

---

## 🟡 Should fix (regressions / correctness)

### 4. Library "Open chat" appends to the current thread instead of a new one

The library generate path calls `sendToAgentChat({ submit: true, openSidebar:
true })` with no `newTab` (`app/routes/library.tsx:1031-1053`). The brand-kit
flow used `newTab: true` (`app/routes/brand-kits.$id.tsx:761`). A button labeled
"Open chat" should start a fresh thread, and it now dumps the request into
whatever thread is open. Add `newTab: true` (and reconcile the two paths so they
behave identically).

### 5. "Free-form" is offered but impossible

On home with "No brand kit," the injected prompt block tells the agent it may
"continue free-form," but `generate-image` / `generate-image-batch` now
hard-throw `"No brand kit selected"` when no `libraryId` resolves
(`actions/generate-image-batch.ts`, `actions/generate-image.ts`). The agent
offers a path the backend rejects — a dead end. Either support free-form
generation (a default/scratch library) or stop offering it and have the bar
require a brand kit before the user generates.

### 6. Embedded picker generation routes to a chat that isn't there

The picker (`app/routes/library.tsx`) runs embedded in other apps over the MCP
bridge (`embedded`, `showCreatePane` defaults to `embedded`, ~line 924). The old
code called `generate-image-batch` directly precisely because there is no Assets
agent sidebar inside a host iframe. The new code unconditionally does
`sendToAgentChat({ openSidebar: true })`, which has nothing to open when
embedded. This is the one place the direct path was correct. Branch on
`embedded`: embedded → keep a direct/bridge generation path; standalone →
composer/chat.

### 7. The "unified" tray holds only one generation at a time

`asset-variants` keeps a single scope (`upsertVariantSlot` enforces one batch
per library/collection/preset/session). Generate in Kit A, then generate in Kit
B — now trivial because the composer is everywhere — and Kit A's unsaved
candidates are replaced and lost. This was tolerable when generation was
page-local; with a global composer and a global tray, users will hit it
routinely. The tray must either represent multiple concurrent batches or warn
before a new batch evicts unsaved candidates.

---

## UI review

### Bar renders two different ways from one slot
Home passes `<GenerationContextBar />` (non-compact → `rounded-lg border
shadow-sm` card); the sidebar passes `compact` (→ `border-t` full-width strip).
One component, two visual identities — this is the "different sizes / design"
feel. Pick a single treatment.

### The non-compact card looks foreign in the composer toolbar
The composer toolbar is a thin control strip (`agent-composer-toolbar … px-2
py-1.5`, ghost icon buttons, a round send button). A bordered, shadowed, rounded
*card* dropped into that row reads as a panel-in-a-toolbar. The chips should be
flat, borderless, toolbar-native controls inline with the attach/send buttons.
The `compact` variant is closer; neither is fully "part of the toolbar." Use the
existing model/mode selectors already in the toolbar as the styling reference.

### Chips can wrap and reflow the composer
`flex-wrap` with three popover chips in a ~380px sidebar composer wraps to a
second line at smaller widths, changing the composer's height. Toolbar controls
should not reflow the composer. Constrain to one row with truncation/overflow.

### The format chip label is cryptic
It shows `generationContextSummary(...).split(" / ").slice(-3)` → e.g. `16:9 /
2K / 3x` with only an `IconAdjustmentsHorizontal` for context. Nothing signals
that "3x" is the candidate count. Add a label or clearer affordances.

### Visual weight mismatch
The chips are `ghost h-7 text-xs` with chevrons next to a solid primary send
button and the plus menu — they read as a different control family bolted on.
Match the composer's native control styling.

### Tray collides with the right sidebar
The agent sidebar is `position="right"` (~380px); the tray is `fixed right-4 …
w-[min(380px…)] z-40`. With the sidebar open the tray overlaps or hides behind
it. Offset the tray when the sidebar is open, or dock it opposite.

### No minimize / collapse
Once candidates exist, the only ways to reclaim the screen are Save-each or
Dismiss-each (delete) or the destructive header X. Add a collapse-to-pill state
(e.g. "3 generating…") that re-expands, and persist it locally.

### Destructive/reversible hierarchy is inverted
Save (keep) and Dismiss (delete) are equal-weight siblings, and the most
destructive control (Clear all) is the top-right X where users reflexively click
to close. The safe action (hide) doesn't exist; the nuclear one is most
prominent. Re-rank: hide is primary/top-right, clear-all is buried + confirmed,
dismiss reads destructive.

---

## Flow review

- **Generate → result is fragmented across surfaces.** Home/library hand off to
  chat; the tray shows progress; saving invalidates `get-library`. The happy
  path works, but "where did my image go?" depends on which surface launched it.
  The tray is the right unifier — it just needs to be non-destructive,
  minimizable, and multi-batch (see above).
- **Threading is inconsistent** (item 4): brand-kit opens a new thread, library
  appends to the current one. Pick one rule for "generate from a non-chat
  surface" and apply it everywhere.
- **Free-form dead end** (item 5): the first thing a new user sees is the home
  box with no brand kit, and that is exactly the state where generation fails or
  stalls on "pick a kit." The default state should either work or guide clearly.
- **Context is delivered to the agent three ways** (see redundancy below) — the
  flow works but spends tokens and invites drift between the channels.

---

## Cleanup / lower priority

### Dead code in brand-kits.$id.tsx
`CandidateStage` (`:2142`), its child `VariantPreview` (`:3949`), and
`useVariantState` (`:4761`) are defined but no longer rendered/called — the tray
replaced them. A few hundred lines of cruft; passes typecheck only because
`noUnusedLocals` is off. Delete it. Leaving a second candidate-display
implementation is the exact divergence the plan set out to remove.

### Generation context is surfaced to the agent three times
`GenerationContextBar` pushes a persistent `setAgentChatContextItem`, AND
`view-screen` returns `generationContext`, AND the picker/brand-kit hand-build
context blocks in their `sendToAgentChat` calls. Choose one canonical channel
(the persistent context item is cleanest) and drop the per-message prompt block
to cut token noise and avoid drift.

### generation-context is user-global, not tab-scoped
The old `navigation` state used `readAppStateForCurrentTab`; this key is global.
Two tabs on two brand kits clobber each other's active context. May be the
intended "sticky preference," but it's a behavior change worth a conscious
decision (and possibly tab-scoping the active library).

### GenerationContextBar mounts twice and both run write-effects
It is rendered in the sidebar (Layout, always) and in the page composer
(`_index`). Both instances run the `activeLibraryId`-sync and preset-cleanup
effects against the same global state. Functionally convergent, but two
instances racing `writeClientAppState` cause extra invalidations/flicker. Hoist
the write-effects out of the presentational component (e.g. a single
provider/hook).

---

## What's genuinely good

- `app/lib/generation-context.ts` and `actions/_generation-context.ts` are a
  clean, mirrored client/server normalization of the same shape, with the legacy
  `imageGenerationModel` key folded in as a fallback — no data migration needed.
- The action-layer change is the right shape: `libraryId` became optional and
  resolves from context, with an explicit, actionable error when nothing is
  selected.
- `view-screen` now exposes `generationContext`, so the agent's context
  awareness includes the active brand kit/preset.
- The core change is minimal and additive — just forwarding an existing prop.
- A user-facing changelog entry was added, per project convention.

---

## Fix checklist

- [ ] Tray header X → non-destructive hide/minimize; add `AlertDialog`-gated
      "Clear all"; make per-item Dismiss read destructive.
- [ ] Add collapse-to-pill state for the tray; persist locally.
- [ ] Fix `GenerationPreset` type in `library.tsx` (add `model`) — unblock build.
- [ ] Add `.changeset/*.md` for the `AgentPanel.tsx` core change.
- [ ] Library "Open chat" → `newTab: true`; reconcile with brand-kit flow.
- [ ] Resolve free-form contradiction (support it, or require a brand kit).
- [ ] Branch embedded picker generation back to a direct/bridge path.
- [ ] Decide multi-batch vs. evict-with-warning for the tray.
- [ ] Unify the context bar to one flat, toolbar-native, single-row treatment.
- [ ] Offset the tray from the right sidebar.
- [ ] Delete dead `CandidateStage` / `VariantPreview` / `useVariantState`.
- [ ] Collapse the 3-way context delivery to one canonical channel.
- [ ] Decide tab-scoping for the active brand kit; de-dupe the bar's
      write-effects.
