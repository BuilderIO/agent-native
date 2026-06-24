# Fold "Library" into the Brand Kits surface (master/detail)

## The decision

Brand Kits is the keeper. The brand-kit detail (`brand-kits.$id.tsx`) already
has everything the Library page has and more — a richer asset browser
(`AssetSwimlaneBoard`: scope all/references, search, media filter, folders,
multi-select), references board, runs, sessions, presets, style brief, palette,
share, archive. So we **do not build a new shell and we do not move the detail.**
Instead the Brand Kits route grows a master rail on its left, and the two things
the Library page still owns — cross-kit browsing and the embedded picker — are
brought *into* the Brand Kits surface. Then `/library` is retired for humans.

## Today's reality (why this is safe)

Three nav destinations operate on the **same `asset-library` table**:

- **Brand Kit detail** (`/brand-kits/:id`) — the heavy, complete management view.
- **Brand Kits list** (`/brand-kits`) — kit grid + preset templates.
- **Library** (`/library`, `library.tsx`) — a flat asset browser (pick a kit,
  browse, search, preview, select/copy, small create pane). Its only unique
  human capability is **cross-kit browsing** ("all my assets across kits") plus
  standalone select/copy.

A "library" *is* a "brand kit." Keeping the brand-kit design means we inherit the
strong surface and only need to *add* the cross-kit view and *preserve* the embed
path — not re-port a feature set.

### The hidden constraint

`/library` is **also the embedded asset picker** that other apps (Slides,
Design, external MCP hosts) load in an iframe: a large URL host-config
(`libraryId`, `libraryHint`, `prompt`, `presetId`, `count`, `tier`,
`styleStrength`, `includeLogo`, `callerAppId`, `autoGenerate`,
`candidateRunIds`), two-way `createEmbeddedAppBridge` (`chooseAsset` /
`chooseImage`), `notifyMcpHost` (base64 image into model context), and direct
`generate-image-batch`. **This contract cannot regress** and is handled as a
preserved surface, not folded into the human chrome.

## The design: Brand Kits becomes master/detail

`/brand-kits` gains a persistent master rail; `/brand-kits/:id` is the detail —
the existing view, unchanged. The Brand Kits list page is absorbed into the rail.

```
┌──────────────────────────────────────────────────────────────┐
│  Brand Kits                                       [ + New kit ]│
├───────────────┬──────────────────────────────────────────────┤
│ MASTER (rail) │ DETAIL                                         │
│               │                                                │
│ ▸ All assets  │   ── /brand-kits  (no kit selected) ──         │
│ ───────────── │   Cross-kit flat browser (the Library logic):  │
│ 🔍 search     │   tabs (All / Generated / References),         │
│ ◆ Soft Travel │   search, grid, preview dialog, select/copy,   │
│ ◆ Clay Studio │   each card chipped + deep-linked to its kit   │
│ ◆ Storybook   │                                                │
│   …           │   ── /brand-kits/:id  (kit selected) ──         │
│               │   The EXISTING brand-kit detail, untouched:    │
│ (empty → the  │   Assets · Runs · Settings, references board,  │
│  preset grid) │   folders, presets, sessions, style brief,     │
│               │   palette, share, archive, upload              │
└───────────────┴──────────────────────────────────────────────┘
```

### Master rail (left) — absorbs `brand-kits._index.tsx`

- **"All assets"** pinned entry → the cross-kit browser in the detail pane.
- **Kit list** — `LibraryCard`-style rows (title, visibility badge, asset
  count), search across kits, sorted by usage.
- **Create / Duplicate / Archive** — `+ New kit` (`CreateLibraryDialog`),
  per-row duplicate/archive (`create-library-from-preset`, `duplicate-library`,
  `archive-library`).
- **Empty state** — no kits → `LibraryPresetGrid` (Soft Travel 3D, Clay Studio,
  …) to seed the first kit.
- **Mobile** — rail collapses to a back-stack: list full-screen, tap a kit to
  push the detail, back returns to the list.

### Detail pane (right) — two modes

**Kit selected (`/brand-kits/:id`)** — the existing `brand-kits.$id.tsx` view
**as-is**. Nothing about it changes; we only render it inside the master/detail
layout. Every capability survives by construction: references board, generated
gallery, live candidates (save/dismiss/promote), folders, multi-select + bulk
delete/reference, drag-drop upload, runs + rerun + handoff sessions,
generation-preset CRUD, style brief + palette + `analyze-collection-style`,
custom instructions, share, archive/duplicate, A2A brand-kit-ID callout, nav
app-state sync.

**No kit / "All assets" (`/brand-kits`)** — the cross-kit browser, built by
lifting the human half of `library.tsx`: the tabbed grid (All / Generated /
References), search, the preview dialog (arrow-key nav, link to `/asset/:id`),
and standalone select/copy. Each card shows its kit as a chip and deep-links into
`/brand-kits/:kitId`. This is the only genuinely new view and the only new
backend need (below).

## Preserving the embedded picker

Extract the embed/picker half of `library.tsx` into a lean
`<AssetPickerSurface>` component (host-config parsing, bridge, `notifyMcpHost`,
direct `generate-image-batch`, `chooseAsset`/`chooseImage`, candidate-run
filtering, starter-library fallback, auto-create-from-preset, configure-message
reactivity). It belongs to the Assets/Brand Kits surface conceptually, and reuses
the same leaf components (asset card, preview, generation pane) as the human
browser — but keeps its own lean chrome.

`/library` survives **only as the embed entry**:
- **Embedded** (`isEmbeddedWindow() || isEmbedAuthActive()` / MCP bridge) →
  render `<AssetPickerSurface>` exactly as today. Same URL, same params, same
  bridge messages → **zero contract change** for Slides/Design/MCP.
- **Not embedded** → redirect to `/brand-kits` (humans never see `/library`).

This is the crux of "bring in the embed case": the picker shares the Brand Kits
component library and lives alongside it, while the external embed URL stays
byte-compatible.

## URLs & redirects

Canonical surface stays **`/brand-kits`** (master) and **`/brand-kits/:id`**
(detail) — no churn to the established kit URLs, A2A IDs, or skills.

- `/brand-kits` → master rail + "All assets" detail.
- `/brand-kits/:id` → master rail + that kit's detail (unchanged view).
- `/library` → embedded picker when embedded; otherwise redirect to
  `/brand-kits`.
- `/libraries`, `/picker`, `/library/:id` → keep existing redirects into
  `/brand-kits(/:id)`.
- `asset.$id.tsx` "back" target already points to `/brand-kits/:libraryId` —
  unchanged.

Nav: drop the separate **Library** item; keep one **Brand Kits** entry. (Rename
to "Library" later if desired — purely a label, no route change.) "Create" (`/`)
stays.

## Backend additions (additive only)

- **Cross-kit asset listing** for the "All assets" view: extend `list-assets` to
  accept *no* `libraryId` and return assets across every kit the caller can
  access, scoped through `accessFilter`/`resolveAccess`, projecting up
  `libraryId` + kit title for the card chip. Indexed, column-projected, paginated
  per the `performance` skill. No schema change, no new tables.
- Everything else reuses existing actions.

## Synergy with generation context

The master selection *is* the generation `libraryId`. Selecting a kit in the
rail writes the same `generation-context` the `GenerationContextBar` reads (via
`writeClientGenerationContext`), and `useGenerationContextSync`'s
`activeLibraryId` becomes "the kit selected in master." One selection drives
navigation, the agent's context, and the next generation's target. "All assets"
maps to "no kit selected → choose a kit before generating," matching the
require-a-kit decision already shipped.

## Four-area touch

- **UI** — `brand-kits.tsx` (or a small `<BrandKitsWorkspace>`) becomes the
  master/detail shell hosting the **unchanged** detail and a new
  `<AllAssetsBrowser>`; `<AssetPickerSurface>` extracted for embed. Shared leaf
  components.
- **Actions** — additive cross-kit `list-assets` mode; all existing actions
  unchanged.
- **Application state** — one `navigation` shape:
  `{ view: "brand-kits", selection: kitId | "all", tab, scope, folderId, search }`
  feeding agent context + generation context.
- **Skills/instructions** — update `library-management`, `asset-generation`,
  AGENTS to describe one Brand Kits surface; A2A keeps brand-kit IDs. Changelog:
  "Library and Brand Kits are now one place."

## What survives (parity checklist)

Kit detail (untouched): references board, generated gallery, live candidates
(save/dismiss/promote), folders, multi-select + bulk delete/reference, drag-drop
upload + progress, optimistic cache helpers, runs + rerun + refresh, handoff
sessions (create/continue), generation-preset CRUD, style brief, custom
instructions, palette + analyze brand, share, archive, duplicate, A2A callout.
List (→ rail): kit grid, search, create blank, create-from-preset, duplicate,
preset templates, empty state. Flat browser (→ "All assets"): cross-kit grid,
all/generated/references tabs, search, preview dialog + keyboard nav,
select/copy/open. Picker (embedded, preserved): full host-config, bridge
messages, `notifyMcpHost`, direct batch generate, candidate-run filtering,
starter fallback, auto-create-from-preset, configure reactivity. Detail/embed
routes (`/asset/:id`, `/asset/:id/embed`, `/run/:id/embed`, `/image/:id`)
unchanged.

## Risks & how the design handles them

- **Embedded picker regression** → isolated into `<AssetPickerSurface>` on the
  same `/library` URL; human merge can't touch it.
- **Touching the 5k-line detail** → we don't. It renders unchanged inside the
  shell; only its container changes.
- **Cross-kit query cost** → projection + indexes + pagination; the one new
  query.
- **Deep links / external callers** → redirects cover old URLs; A2A uses IDs.

## Execution order

1. **Master rail on Brand Kits.** Turn `/brand-kits` into master/detail: build
   the rail (absorbing `brand-kits._index.tsx`), render the existing detail
   unchanged for `/brand-kits/:id`. No detail rewrite. Ship — kits now have a
   persistent rail.
2. **All-assets mode.** Add the cross-kit `list-assets` mode and
   `<AllAssetsBrowser>` as the no-kit detail pane.
3. **Extract + preserve the picker.** Pull the embed half of `library.tsx` into
   `<AssetPickerSurface>`; make `/library` render it when embedded and redirect
   to `/brand-kits` otherwise. Verify Slides/Design embeds still pick + generate.
4. **Collapse nav + redirects + back-links.** One Brand Kits entry; repoint
   `/library`, `/libraries`, `/picker`.
5. **State + generation synergy + skills + changelog.**

Step 1 leaves the detail untouched and is independently shippable; step 3 is the
one to test hardest because it touches the external embed contract.
