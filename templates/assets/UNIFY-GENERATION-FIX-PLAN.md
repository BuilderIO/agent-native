# Fix plan: addressing the unified-generation review

Companion to `UNIFY-GENERATION-REVIEW.md`. Groups the review's 13 checklist
items into five workstreams, in execution order, with the concrete change for
each. Three items are genuine product decisions — they're called out first so
they don't block the mechanical work.

## Decisions needed (default recommendations in bold)

1. **Free-form (review #5).** Recommendation: **require a brand kit.** Auto-select
   the last-used (or only) kit so there is always one; show "No brand kit" only
   when zero exist, and in that state the composer nudges to create one instead
   of generating. Drop "continue free-form" from agent instructions. (Alt:
   create a hidden "Scratch" library — more code, more concepts.)
2. **Tray scope (review #7).** Recommendation: **evict-with-warning now,
   multi-batch later.** Phase 1 warns before a new batch replaces unsaved
   candidates. Multi-batch (tray holds slots from several scopes) is the better
   end state but needs a backend change to `upsertVariantSlot`'s single-scope
   rule — do it as a follow-up.
3. **Tab scope (cleanup).** Recommendation: **tab-scope the active brand kit /
   preset, keep format prefs global.** Restores the old per-tab `navigation`
   behavior so two tabs don't clobber each other, while model/aspect/size/count
   stay sticky across tabs.

If you accept the three defaults, the whole plan is executable without further
input.

---

## Workstream A — Tray safety & UX (highest priority)

Covers review #1 (destructive close), no-minimize, inverted hierarchy, sidebar
collision.

1. **Make close non-destructive.** Replace the header X `dismissSlot({ scope:
   "all" })` with local `collapsed` UI state. The X becomes **minimize**.
2. **Collapse-to-pill.** When `collapsed`, render a small floating chip
   ("N generating… · M ready") that re-expands on click. Persist `collapsed` to
   `localStorage` so it survives navigation.
3. **Add a real "Clear all"** as a separate, de-emphasized control (small text
   button or overflow item), gated by a shadcn `AlertDialog`
   ("Delete N candidates? This can't be undone."). Only this path calls
   `dismiss-variant-slots({ scope: "all" })`.
4. **Re-rank actions.** Header: minimize is primary/top-right; clear-all is
   buried + confirmed. Per-item: Save is primary, Dismiss styled destructive
   (it deletes the asset) — keep it single-click but visually clearly
   destructive.
5. **Offset from the right sidebar.** Read the sidebar open state + width
   (already persisted for `AgentSidebar`) and shift the tray's `right` by that
   width when open, or dock it within the main content region instead of the
   viewport. No more overlap with the chat sidebar.

Files: `app/components/generation/GenerationTray.tsx` (+ a tiny
`localStorage` helper). No action/schema changes.

## Workstream B — Build & release hygiene (unblocks CI)

Covers review #2, #3, and the dead-code cleanup.

1. **Fix the type error.** In `app/routes/library.tsx`, either add
   `model?: string | null;` to the local `GenerationPreset` (`:122`) or import
   the shared `GenerationPresetSummary` and use it. Re-run `npm run typecheck`
   to green.
2. **Add the changeset.** Create `.changeset/*.md` (patch, `@agent-native/core`)
   describing "AgentSidebar forwards `composerToolbarSlot` to the composer
   toolbar."
3. **Delete dead code** in `app/routes/brand-kits.$id.tsx`: `CandidateStage`
   (`:2142`), `VariantPreview` (`:3949`), `useVariantState` (`:4761`), and any
   now-unused imports they pulled in. The app-wide `<GenerationTray>` replaces
   them.

## Workstream C — One generation entry path (consistency)

Covers review #4 (threading) and #6 (embedded), plus the "single source of
truth" tenet.

1. **Extract `startGeneration()`** into `app/lib/start-generation.ts`: writes
   `generation-context`, then either
   - **standalone** → `sendToAgentChat({ submit: true, newTab: true,
     openSidebar: true })`, or
   - **embedded** → calls `generate-image-batch` directly (the old picker path),
     since there is no sidebar inside a host iframe.
2. **Route all non-chat surfaces through it** — home starters, library "Open
   chat", and any brand-kit affordance. This fixes the missing `newTab: true` in
   `library.tsx` (#4) and the embedded regression (#6) in one place, and
   guarantees identical threading everywhere.
3. **Branch on `embedded`** inside the helper using the existing `embedded`
   flag in `library.tsx`.

Files: new `app/lib/start-generation.ts`; edits to `app/routes/library.tsx`,
`app/routes/_index.tsx`, and the brand-kit handoff call sites.

## Workstream D — Agent context: one canonical channel

Covers the 3-way context redundancy and the double-mounted write-effects.

1. **Pick one channel.** Keep the persistent `setAgentChatContextItem`
   ("Assets Generation Context") as the single always-on source of brand
   kit/preset/format. Drop the hand-built per-message context blocks in the
   `sendToAgentChat` calls (they duplicate it and add token noise). Keep
   `view-screen`'s `generationContext` for explicit screen reads.
2. **De-dupe the write-effects.** Move the `activeLibraryId`-sync, preset-cleanup,
   and `setAgentChatContextItem` effects out of `GenerationContextBar` into a
   single `useGenerationContextSync()` hook (or small provider) mounted once
   (Layout/root). `GenerationContextBar` becomes purely presentational: reads the
   query, writes on user action only.

Files: `app/components/generation/GenerationContextBar.tsx`, a new hook, and the
`sendToAgentChat` call sites.

## Workstream E — Bar styling unification (UI polish)

Covers all UI-review items about the bar.

1. **One treatment.** Drop the `compact` vs non-compact split. Render flat,
   borderless, toolbar-native chips (no card border/shadow) that match the
   composer's existing model/mode selectors. Use those as the visual reference.
2. **Single row, no reflow.** Remove `flex-wrap`; constrain to one row with
   truncation/overflow so the chips never change the composer's height.
3. **Clarify the format chip.** Replace the cryptic `… / 2K / 3x` tail with
   labeled values or distinct glyphs (e.g. a count badge), so "3 candidates" is
   legible.

Files: `app/components/generation/GenerationContextBar.tsx`; remove the
`compact` prop usage in `app/components/layout/Layout.tsx` and
`app/routes/_index.tsx`.

---

## Recommended execution order

1. **B** — green the build + changeset + delete dead code (fast, unblocks
   everything and CI).
2. **A** — tray safety (the user-facing danger; ship-blocking on its own).
3. **C** — one entry path (fixes two regressions together).
4. **D** — canonical context channel (correctness + cost).
5. **E** — bar styling (polish; safe to land last).

Decisions 1–3 should be confirmed before C/A respectively (free-form gates the
bar's empty state in A/E; tray scope gates A; tab scope gates D).

## Verification

- `npm run typecheck` green after B.
- Manual: generate on home with a kit selected → candidates appear in the tray;
  minimize → pill; expand → restored; Clear all → confirm dialog; close browser
  tab and reopen → collapsed state restored.
- Manual: library "Open chat" opens a **new** thread; embedded picker still
  generates without a sidebar.
- Manual: two tabs on two brand kits don't clobber each other's active kit
  (after decision 3).
- Confirm the agent receives generation context exactly once (inspect a request
  via context-xray).
