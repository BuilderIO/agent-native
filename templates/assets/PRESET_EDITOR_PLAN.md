# Plan: UI Preset Editor

A better, simpler UI for editing generation presets. Today presets can only be
**created** and **deleted** from the UI; changing an existing preset relies on
the agent. This plan adds a dedicated **single-preset editor page** per kit.

## Current state

**Data & actions are already complete — no backend work is needed.**

The `image_generation_presets` table (`server/db/schema.ts:53`) and all four
actions exist:

- `actions/create-generation-preset.ts` — full field set
- `actions/update-generation-preset.ts` — **every field is already updatable**
  (title, description, category, promptTemplate, aspectRatio, imageSize, model,
  textPolicy, referencePolicy, includeLogo, collectionId, sortOrder)
- `actions/delete-generation-preset.ts` — guards against presets used by an
  existing handoff session
- `actions/list-generation-presets.ts` — by `libraryId` (+ optional
  `collectionId`)

**The UI is the only gap.** Presets are surfaced today only in
`GenerationPresetsPanel` inside the Settings tab of
`app/routes/brand-kits.$id.tsx:2032`. That panel:

- **already lists** presets (title, aspectRatio badge, logo badge, one-line
  policy/description preview)
- has a **create-only** dialog exposing a _subset_ of fields (title, category,
  aspectRatio, promptTemplate, textPolicy, includeLogo) — `imageSize` is
  hardcoded `2K`, and `model` / `referencePolicy` fall back to defaults
- offers delete, but **no edit** — so model, size, reference policy,
  description, and sort order can only be changed by the agent via
  `update-generation-preset`

So this is a pure frontend/route task on top of the existing action surface.

## Scope decisions

- **Per-kit** (confirmed) — presets belong to a library and are access-scoped
  per library.
- **No master list route.** The settings panel already lists a kit's presets;
  we do not need a `/brand-kits/:id/presets` index page. We only need a page to
  view/edit **one** preset.

## Plan

### 1. Route (UI) — single preset page

Routing is filesystem-based (`flatRoutes()` in `app/routes.ts`). Use the
trailing-underscore opt-out convention (as with `asset.$id_.embed.tsx` /
`run.$id_.embed.tsx`) so the page does **not** nest inside the tabbed detail
layout:

**`app/routes/brand-kits.$id_.presets.$presetId.tsx`**
→ `/brand-kits/:id/presets/:presetId`

The page:

- reads `:id` + `:presetId`, loads the preset from
  `useActionQuery("list-generation-presets", { libraryId })` and finds it by id
  (or add a lightweight `get-generation-preset` read action if a direct fetch is
  cleaner — optional, not required)
- header: kit name + preset title + back link to the kit's Settings tab
- a full edit form with the **complete field set** (see §2), saving via
  `update-generation-preset`
- a Delete button (with the existing confirm dialog) → on success navigate back
- loading skeleton + not-found state (bad/stale `presetId`)
- gate editing behind the library's editor access (the actions already
  `assertAccess("...", "editor")`; mirror it in the UI so viewers see read-only
  — reuse whatever access/role signal the detail page already has)

Creation stays where it is (the existing create dialog in the settings panel).
Optionally the same page can serve `presetId === "new"` to create, but that's a
follow-up, not required.

### 2. Full field set + shared form body

The editor exposes every field the current create dialog omits:

- title, description, category
- `model` (with aspect-ratio options constrained via
  `supportedAspectRatiosForModel` from `shared/api.ts:56` — `gpt-image-2` only
  allows 3 ratios)
- `aspectRatio`, `imageSize` (`512`/`1K`/`2K`/`4K`)
- `referencePolicy` (`auto`/`collection`/`explicit`)
- `promptTemplate`, `textPolicy`, `includeLogo`, `sortOrder`

Keep it progressively disclosed (advanced fields under a collapsible) so it
stays simple per the template UX rules. Optimistic mutation + invalidate
`list-generation-presets`.

**Recommended (optional):** extract the form body into a shared `PresetFields`
component reused by both this page and the existing create dialog, so the create
dialog can grow the same full field set without duplication.

### 3. Entry point (UI wiring)

- In `GenerationPresetsPanel`, add an **Edit** button per listed preset →
  navigates to `/brand-kits/:id/presets/:presetId` (the row's title can also be
  the link).
- Navigate with react-router `Link` / `useNavigate` (client-side, no shell
  remount) per the `client-side-routing` skill.

### 4. Application state (agent parity — required by CLAUDE.md)

Add a `navigation` application-state entry for the new view, e.g.
`{ view: "preset", libraryId, presetId }`, written on mount the same way the
detail page writes navigation (see the `application-state/navigation` effect
around `brand-kits.$id.tsx:800`), and teach the `navigate` action to route to
`/brand-kits/:id/presets/:presetId`. Check the `context-awareness` skill for the
exact shape.

### 5. i18n

Add the route title in `routeTitles` and new copy strings (under
`brandKitDetail` or a `preset` namespace) in `messagesByLocale`, mirrored across
all locales per the CLAUDE.md translation rule.

### 6. Skill + changelog

- Note the human preset-editing page in the `asset-generation` skill (so the
  agent knows a UI now exists and can deep-link users to it).
- Record a user-facing entry:
  `agent-native changelog add "Edit generation presets in a dedicated page" --type added`.

## Four-area checklist (CLAUDE.md)

| Area                  | Change                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| UI                    | New `/brand-kits/:id/presets/:presetId` editor page + Edit affordance in the settings panel        |
| Actions               | None required — rides on existing `update`/`delete`/`list` (optional `get-generation-preset` read) |
| Skills / instructions | Note the editor page in the `asset-generation` skill                                               |
| Application state     | Add `{ view: "preset", libraryId, presetId }` navigation state; wire `navigate`                    |

## Notes

- **No schema or action changes are required** — the whole feature rides on the
  existing `update-generation-preset`, keeping this a low-risk, UI-only change.
- Full preset field reference lives in `shared/api.ts`: `IMAGE_CATEGORIES`,
  `ASPECT_RATIOS`, `IMAGE_SIZES`, `IMAGE_MODELS`,
  `GENERATION_PRESET_REFERENCE_POLICIES`, and
  `supportedAspectRatiosForModel(model)`.
