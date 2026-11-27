# Themable design system on Base UI

One design system and a flexible frontend pipeline for every Agent-Native app:
existing screens map from their current markup onto a model, and part sets
render that model. Components move from shadcn/ui (Radix + CVA + Tailwind class
strings) to Base UI with semantic CSS. A theme is a set of token values plus
optional component CSS, so the same markup can look like anything from a dense
editor to a soft consumer app.

## Decisions

| Decision | Choice |
| --- | --- |
| First look | Today's look ships as the first theme, `classic`. Switching the default to the new baseline (24px controls, 16/20/24/32 ramp) is its own PR. |
| What a theme can change | Two layers. A **theme** changes tokens and component CSS over our parts (`classic`, `agent-native`, presets). A **part set** swaps the markup of each part behind one headless model, so a screen maps from its source markup to any target part set. A theme alone changes values, not structure. |
| App code | Components keep today's props (`variant`, `size`, `asChild`). A codemod moves call sites to the new API once the component set is complete. |
| Class names | Unprefixed, one class per part: `.button`, `.menu-popup`, `.menu-item`. |
| Package | New framework-free `@agent-native/design-system`. Toolkit's React components depend on it. |
| Stress tests | Every template in `templates/*`. |

## Package layout

```
packages/design-system/
  src/
    tokens/      primitives, semantic roles, presets, the Radix generator,
                 createTheme(): brand inputs -> every token, as data or CSS
    themes/       theme definitions; classic/<part>.ts holds each part's inputs
    catalog/     part catalog: names, sub-parts, Base UI primitive, status
    css.ts       emitters for the generated stylesheets and runtime themes
  css/
    tokens.css              generated: primitives, default scales, presets
    main.css                Tailwind v4 mapping of roles and scales to utilities
    styles.css              imports parts/*.css: plain component CSS, no Tailwind
    parts/<part>.css        one file per part
    themes/<theme>.css        imports the theme's generated roles.css
  scripts/build-css.ts      writes the generated files; `css:check` fails on drift
```

`@agent-native/toolkit/styles.css` imports the design-system CSS, so apps keep
one import line. Toolkit's `ui/*` components render the classes; the package
itself has no React dependency, so prototypes, docs, Figma sync and the MCP
server can read it.

## Cascade

Tailwind v4 owns the layer order `theme, base, components, utilities`.

- Tokens are plain custom properties outside the layers, scoped by selector.
- Component CSS lives in `@layer components`. Themes never write selectors
  against parts: they set the part's public inputs (`--switch-soft-track-color`),
  which the part reads with a role fallback. A part therefore paints correctly
  with no theme at all, and a theme is pure data.
- Utilities always beat components. A template's `className="h-8"` on a
  Button overrides the part's height exactly as `tailwind-merge` does today,
  which is what makes the compat props safe.
- Each theme's roles are declared unscoped for the default theme and inside
  `@scope ([data-app-theme="<name>"])` for every theme, so the nearest theme wins by
  scope proximity. Every theme also resets the inputs other themes set
  (`initial`), so a nested theme never inherits the outer one's values.

## Tokens

Three tiers. Components read only the second and third.

**1. Primitives**: raw values, named by scale step.

| Family | Names | Source |
| --- | --- | --- |
| Neutral | `--gray-1..12`, `--gray-a1..12`, `--gray-contrast`, `--gray-surface` | generated from the brand's gray |
| Brand | `--brand-1..12`, `--brand-a1..12`, `--brand-contrast`, `--brand-surface`, `--brand-indicator`, `--brand-track` | generated from one brand color |
| Status | `--danger-*`, `--warning-*`, `--success-*`, `--info-*` (same 12 + alpha shape) | Radix scales, red / amber / green / blue by default |
| Space | `--space-1..9` | per density, every step a multiple of 4 |
| Control | `--control-height-{xs,sm,md,lg}` 16/20/24/32 | fixed at every density; 28 and 36 are not on it |
| Size | `--size-1..8` (16, 20, 24, 32, 40, 48, 56, 64) | fixed ramp |
| Radius | `--radius-1..6`, `--radius-full`, `--radius-factor` | step times factor |
| Type | `--font-size-0..9`, `--line-height-0..9`, `--letter-spacing-0..9`, `--font-weight-*`, `--font-family-sans/mono/heading/wordmark` | fixed ramp; not Tailwind's `--font-sans`, which templates rely on |
| Elevation | `--shadow-1..6` | per appearance |
| Motion | `--duration-1..4`, `--ease-standard/enter/exit` | fixed |

"Brand" replaces Radix's "accent" because shadcn's `accent` already means the
gray hover fill in thousands of class names (`bg-accent`).

**2. Semantic roles**: what a color or size is for. These names never collide
with shadcn's Tailwind colors.

| Group | Tokens |
| --- | --- |
| Surface | `--surface-app`, `--surface-nav`, `--surface-canvas`, `--surface-raised`, `--surface-sunken`, `--surface-overlay`, `--surface-inverse` |
| Text | `--fg-default`, `--fg-muted`, `--fg-subtle`, `--fg-disabled`, `--fg-on-brand`, `--fg-brand`, `--fg-danger`, `--fg-inverse` |
| Line | `--line-default`, `--line-subtle`, `--line-strong`, `--line-focus` |
| Fill | `--fill-hover`, `--fill-pressed`, `--fill-selected`, `--fill-brand`, `--fill-brand-hover`, `--fill-brand-subtle`, `--fill-danger`, `--fill-danger-hover`, `--fill-danger-subtle` |
| Status | `--status-{danger,warning,success,info}-{solid,subtle,fg,line}` |
| Shape | `--shape-control`, `--shape-popup`, `--shape-card`, `--shape-panel`, `--shape-dialog`, `--shape-pill` (declared at the theme root, not per appearance; `--radius-card` is taken by CRM) |
| Elevation | `--shadow-1..6` |
| Gradient | `--gradient-brand`, `--gradient-surface`, `--gradient-glow` |
| Layer | `--layer-dialog-backdrop` 270, `--layer-dialog` 280, `--layer-popup` 290, `--layer-alert-dialog-backdrop` 340, `--layer-alert-dialog` 350, `--layer-tooltip` 500 (primitives; toolkit's existing stack) |

`main.css` exposes the roles to Tailwind under `@theme inline`, which gives
`bg-surface-canvas`, `text-fg-muted`, `border-line`, `bg-fill-hover`,
`rounded-control`, `h-control-md`, `text-0..9`, `shadow-elevation-1..6` and
the scale steps (`bg-gray-3`, `text-brand-11`), plus `theme-*:`, `compact:`
and `comfortable:` variants.

**3. Component tokens** are opt-in, cataloged inputs. Switch pilots this
contract. For example, a theme can set `--switch-soft-track-color` on a
container to change the unchecked soft track. With the input unset, the
switch resolves `--gray-a4` at the control, including inside nested themes.
Props still choose the variant, color, radius and contrast.

### Scopes

Every scope attribute can sit on `:root` or any subtree, and they compose.

| Attribute | Values | Effect |
| --- | --- | --- |
| `.dark` / `.light` | (class) | appearance; existing next-themes strategy stays |
| `data-app-theme` | `classic`, then more | token values and theme CSS |
| `data-density` | `compact`, `default`, `comfortable` | control paddings, the in-control gap and `--space-1..9`; control heights stay 16/20/24/32, and Tailwind's `--spacing` stays 4px |
| `data-radius` | `none`, `small`, `medium`, `large`, `full` | `--radius-factor`; `full` makes controls pills |
| `data-corners` | `round`, `squircle` | `corner-shape: superellipse()` with radius compensation where supported |

Role tokens are re-declared on every appearance and brand scope, so a `.dark`
subtree recomputes them instead of inheriting values resolved at `:root`.
Presets carry one extra attribute of specificity
(`[data-radius][data-radius="full"]`), so an explicit preset beats the theme on
the same element.

### Color generation

`createTheme({ brand, gray?, background?, status? })` ports Radix's custom
palette generator (MIT, radix-ui/website): it finds the two nearest Radix
scales to the brand color in OKLCH, mixes them, re-hues and re-chromas the
result, eases lightness toward the chosen background, and derives step 9,
hover, contrast text, alpha steps against the background, surface, and P3
wide-gamut values. The same function returns data (for the agent, Figma sync
and tests) or CSS (for a build step or a runtime `<style>`).

The theme is data, so the agent can change it: an app stores theme inputs in
SQL like any other setting and the provider applies the generated CSS on the
client. The SSR shell stays impersonal.

### Token files (built 2026-11-18)

The values designers edit live in `packages/design-system/src/tokens/files/`
as W3C design token JSON: foundations, the default palette's inputs, and each
theme's light and dark values. `tokens:export` writes them one file per mode
of a Figma collection; `tokens:import` takes a Figma export back, refuses
anything code cannot read, and keeps each unchanged color's exact HSL text, so
a trip through Figma with no edits changes no CSS. The contractor's foundations
work lands through `tokens:import`, then `css` and a reviewed diff. The
Components collection contains one token per Switch styling input. Motion,
layers and density spacing remain in code.

### Legacy styling paths go (decided 2026-11-18)

The design system is a professional, Material-style system that can theme any
platform, device or app. Its output depends only on its own tokens and parts.

Why: `packages/toolkit/src/app/styles/theme-families.css` defines shadcn's HSL
variables under `:root[data-theme-family="agent-native"]`, and the classic theme
points roles back at them (`hsl(var(--border))`). So a part's paint depends on
app CSS plus a global root attribute: themes are not portable, cannot nest, work
only at the root, and the palette has two sources of truth. Storybook's preview
drew black and missing borders until the attribute was set.

End state: no shadcn variables, no `data-theme-family`, no compat props.
Everything is on our tokens and parts.

Removed outright, with no compat period:

- The `data-theme-family` opt-in and `theme-families.css`. Its palette becomes
  the `agent-native` theme's values, and apps switch to `data-app-theme` in the
  same change. (Themes are one per app, named for the app, carrying palette,
  type, shape and sizes; `data-theme` stays core's color mode.)
- Roles reading shadcn variables. Each theme owns its values; today's palette
  becomes the classic theme's reference values from the color pipeline.

Temporary bridges, which only shrink:

- Themes emit the shadcn variables one way, from our tokens, for call sites not
  yet migrated.
- A shrink-only guard counts the files still using them; the bridge is deleted
  at zero.
- Compat props, `SettingsRow` and the Radix pieces get the same counted
  baselines, which the codemod drains.
- A guard fails when theme or part CSS reads a legacy shadcn variable.

Order:

1. Foundations: themes own their values, the theme family is removed, and the
   legacy variables become one-way. This lands before the contractor's tokens
   round-trip through Figma, so they target one path.
2. The remaining parts.
3. App by app onto parts and tokens.
4. Delete the bridges.

## Components

Each part is one class plus data attributes, in the design-system contract's
own vocabulary rather than shadcn's:

```html
<button class="button" data-intent="neutral" data-emphasis="outline" data-size="sm">Share</button>
<div class="menu-popup" data-side="bottom" data-open>
  <div class="menu-item" data-highlighted>Rename</div>
</div>
```

- Variants are `data-intent` (primary, neutral, danger) and `data-emphasis`
  (solid, outline, ghost, link), plus `data-inset`; sizes are `data-size`
  (xs, sm, md, lg) plus `data-icon-only`. Compat maps shadcn's `variant` and
  `size` onto them (`outline` is neutral/outline, `icon-sm` is sm/icon-only).
- State comes from Base UI's own attributes (`data-open`, `data-highlighted`,
  `data-disabled`, `data-starting-style`, `data-ending-style`, `data-side`),
  never from classes.
- Sub-parts follow the catalog's `part.sub-part` names as `part-sub-part`
  classes: `menu.item` is `.menu-item`, `dialog.popup` is `.dialog-popup`.
- Component CSS uses tokens only. `guard:no-raw-colors` covers
  `css/parts/` and the hand-written theme files.
- Each public styling input uses `--<part>-*` and has a catalog entry with its
  purpose and default. Switch reads these inputs with local fallbacks in the
  relevant base, variant or state rule. Its private values use `--_*` and
  never reference themselves (CSS invalidates a self-reference even through a
  `var()` fallback, so size rules write `--_size-*` and the base reads them).

### Compat API

Templates keep calling `<Button variant="outline" size="sm" asChild>`.

| shadcn / Radix | Base UI |
| --- | --- |
| `asChild` + child | `Slot` on Base UI's `useRender` (no role or tabIndex is added, so a link stays a link) |
| `Button` with no `type` (submits in a form) | `type` passed through, even undefined, because Base UI defaults to `type="button"` |
| `DropdownMenuItem onSelect(e)` with `e.preventDefault()` to stay open | `Menu.Item onClick`, with the root cancelling the close (`eventDetails.cancel()`) when the handler prevented it |
| `onCloseAutoFocus(e)` + `preventDefault()` | `finalFocus` |
| `onOpenAutoFocus` | `initialFocus` |
| `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside` | `onOpenChange(open, { reason, event, cancel })` |
| `DropdownMenuContent side/align/sideOffset/alignOffset/collisionPadding` | `Menu.Positioner` props |
| `TooltipProvider delayDuration` | `Tooltip.Provider delay` |

Every mapping gets a spec before the swap, and the existing focus-return,
modal-layer and body-lock specs must pass unchanged.

Accepted differences, recorded while the shadcn parity runner existed (deleted 2026-11-18):

- A menu item whose color comes from a utility keeps that color while
  highlighted. shadcn's `focus:text-accent-foreground` used to override it; a
  part's state styles sit below utilities, so the call site now wins.
  Destructive items use `variant="destructive"` instead, which stays red when
  highlighted like the ~70 items written `text-destructive
  focus:text-destructive`; the 7 items that had only `text-destructive` moved
  to it, as did the three tinted ones (Mail's two `text-destructive/80` and
  Calendar's `text-red-400/80`), which now use the full destructive color.
- Radix nudged an overflowing submenu inward with `translate`; Base UI's
  collision handling places it instead.

## Headless model, part sets and the two checks

The pipeline maps from a source to a target. The source is an existing
rendering, mapped onto row ids; the target is a part set that renders the
model.

- **Headless model.** Each surface is described once as rows: a stable dotted
  id (`settings.notifications.email`), the catalog part it is
  (`settings.row`), its label, state and effect. No layout and no styling.
  Types live in `@agent-native/design-system` (`src/model/`), so they are
  framework-free and readable by the MCP server.
- **Part sets.** A part set implements every catalog part as a component that
  draws model rows. The Agent-Native part set is toolkit's parts, styled by a
  theme. The seam is toolkit's existing `defineDesignSystem` /
  `ToolkitProvider`, which already swaps the markup of 17 semantic components,
  extended to the part catalog.
- **Row ids.** Every part renders `data-rid` from its row. It is the join
  key between a source rendering and a target part set.
- **Equivalence check:** `checkPartSetEquivalence({ model, target })`.
  Structural, never visual: the target renders the same row ids, names,
  states and actions the model declares.
- **Row style check:** `compareRowStyles(source, target)` returns a
  `RowStyleReport` of the rows whose computed styles differ, keyed by row id,
  so a migration shows exactly what changed.
- **Three depths per surface.** Swap the shell (sidebar, menus, settings) to
  parts, re-token lists and grids with role utilities, and leave the
  app-defining canvas alone.

Themes still apply inside our part set: `classic` and `agent-native`, density,
radius, corners and brand themes work exactly as above.

## Open items before each swap

Found while building the parts; each is checked in its swap PR.

- **Menu**
  - `forceMount` hides a closed popup where Radix left that to the caller; only `RunsTray.spec` uses it.
  - `checked="indeterminate"` is unsupported; no menu call site uses it.
  - An `asChild` trigger whose child is a component is assumed to render a native button.
- **Dialog**
  - An `asChild` trigger or close whose child component renders an `<a>` is treated as a native button.
  - A Radix popup already open when a Base UI dialog opens gets `aria-hidden`; one opened afterwards does not.
  - Base UI moves focus into a new dialog on the next frame, so a dialog that opens a nested one within that frame loses focus to the first. Real input can't do this; a programmatic flow can.
  - The stale-lock and focus-return helpers re-exported from `ui/dialog.tsx` move to a neutral module.
  - 11 files import `@radix-ui/react-dialog` directly (sheet, command, Content's media blocks, docs, code-agents-ui, Clips desktop).
  - Two deliberate changes: reduced-motion users get no enter or exit animation, and the close button is named by `aria-label` instead of a hidden span.
- **Tooltip**
  - An open within the provider's skip window reports `data-state="delayed-open"`, not `instant-open`.
  - Radix closed a tooltip when the page scrolled under its trigger; not yet checked on Base UI.
  - The enter animation has not been checked visually, and 10 call sites that spread props are unchecked.
- **Popover** (built 2026-11-18)
  - A modal popover locks scroll and blocks presses behind it, but Base UI does not aria-hide the page behind as Radix did.
  - Inside a Radix dialog, the dialog's scroll lock may still swallow the wheel over a portalled Base UI popover; check the 4 `modal` call sites and the in-dialog default in a browser.
  - The positioner carries `data-radix-popper-content-wrapper` for app code that ignores presses inside popups; the Base UI menu does not, so those checks miss it today.
  - `portalled={false}` portals into an inline `display: contents` host, mounting one frame after the host.
- **Native Button** (2026-11-18): `ui/base-ui/button.tsx` takes the design system's vocabulary (`intent`, `emphasis`, `size`, `iconOnly`, `block`, `align`, `leading`, `trailing`, `detail`) on Base UI's Button. `ui/button.tsx` keeps its compat API for the existing call sites (140 files) until a codemod moves them; 9 files still import its Tailwind `buttonVariants` recipe. Parts are never adjusted with Tailwind utilities; a composition that needs a different look gets a prop or a region's `--part-*` inputs.
- **Danger fill contrast** (fixed 2026-11-18): the app themes map `--fill-danger` a quarter of the way from their destructive color toward black, so white danger text holds 4.5:1 in every theme and appearance (lowest 4.87:1, Docs dark). The destructive color itself is unchanged; it is also danger text on dark surfaces.
- **Muted text** (2026-11-18): the app themes map `--fg-muted` a fifth of the way from shadcn's muted gray toward the text color, so it holds 4.5:1 on the nav surface, sunken tracks and selected rows as well as the canvas.
- **Native parts** (decided 2026-11-18): parts take Base UI's own API and the design system's own look; no Radix-shaped props, no shadcn-matching theme inputs, no shadcn parity stories. Tabs, switch, slider, input, textarea, field, fieldset, checkbox, radio, accordion, collapsible, toggle, toggle group, scroll area, separator, avatar, progress, meter, badge, keycap, spinner, skeleton, app shell, sidebar, navigation menu, page header and toolbar are built this way; the sidebar is a layout filled with real parts (NavigationMenu, Collapsible, Separator, Badge, Button, Menu), not a family of its own; Base UI has no textarea, so ours is its field control rendered as one. The popover and select above are compat-shaped and move to the native overlay run with the dialog family.
- **One part per Base UI component** (decided 2026-11-18): parts follow base-ui.com/react/components one to one, each with its own module, CSS file, catalog entry (`kind: "component"`) and story under `Components/<Base UI name>`. Static parts Base UI has no component for (Badge, Keycap, Spinner, Skeleton, Item, Banner, Textarea) are additions; layouts of parts (Sidebar, Settings, Page header) are patterns.
- **Flat part CSS** (2026-11-18, updated for the Switch pilot): parts resolve roles and scale steps in their own CSS. Switch exposes cataloged styling inputs through local fallbacks in those same rules. Themes may set an input on a container. The original flattening (`ac292414a9`, before PR #9575 was squashed) removed the per-theme Button maps used for shadcn parity and moved the sidebar’s row and solid-field treatments into props. The pilot keeps those props and the flat stylesheets.
- **Select** (built 2026-11-18)
  - Typing on a closed trigger does not change the value, as it did in Radix.
  - The selected item's children render twice while the list is open (once in the detached label source); item children with side effects would run them twice.
- **Base UI popups inside a Radix modal dialog** (checked in a browser 2026-11-18, menu, popover and select)
  - Radix sets the body to `pointer-events: none`; the menu, popover and select positioners now set `auto`, so presses work and the dialog stays open.
  - Keyboard use fails: Radix's focus trap pulls focus back out of a Base UI popup, so arrow keys and Enter never reach it. Escape closes the dialog along with the popup.
  - So the dialog family swaps before, or with, menus, selects and popovers inside dialogs. The Base UI dialog lets focus into Base UI popups.

## Part catalog

The part vocabulary, mapped to Base UI and to the
toolkit file it replaces. `src/catalog/` holds this as data; the MCP server
and the skills read it.

| Group | Parts |
| --- | --- |
| Primitives | button, icon-button, input, textarea, checkbox, radio, switch, slider, badge, avatar, keycap, spinner, skeleton, separator |
| Shell and navigation | app-shell, sidebar, page-header, toolbar, filter-bar, tabs, search, command-palette, shortcuts-panel, settings |
| Overlays and controls | menu, context-menu, popover, picker, select, combobox, date-picker, dialog, alert-dialog, drawer, toast, tooltip, banner, form, field, file-upload, empty-state |
| Content | list, card, table, data-grid, board, timeline, calendar-view, chart, inspector, property-list, activity-feed, rich-text-editor |
| Agent | chat-thread, composer, agent-panel |

Base UI covers the behavior of every overlay and control (Menu, ContextMenu,
Menubar, Popover, PreviewCard, Select, Combobox, Autocomplete, Dialog,
AlertDialog, Drawer, Toast, Tooltip, Tabs, Accordion, Collapsible, Field,
Fieldset, Form, Checkbox, Radio, Switch, Slider, NumberField, OTPField,
ScrollArea, Toolbar, NavigationMenu). Parts with no Base UI primitive (cards,
lists, shell) are plain markup with the same class contract.

## Migration sequence

Each PR ships live with no flag. Every swap proves parity first.

1. **Foundation** (this PR): package, token tiers, generator, `tokens.css` /
   `main.css` / `styles.css`, the `classic` theme with the legacy bridge, the
   `agent-native` theme (selectable, not default), the part catalog, Base UI
   Button swapped in place, Base UI Menu, Dialog and Tooltip built under
   `toolkit/ui/base-ui/` with the compat API, the gallery, the parity runner,
   and `guard:no-part-class-redefinition`.
2. **Headless model and part sets** (`claude/design-system-headless-model`,
   stacked on the foundation; built): model types and row ids in the design
   system, the part-set seam in toolkit, `data-rid` on every part, the
   equivalence check, and the row style check keyed by row id.
3. **Settings, the first pattern** (MVP, Dec 14; `claude/design-system-settings`,
   stacked on step 2. Built: the shared nav for every app, the group, row,
   content and button parts, row regions and hidden group labels in the
   model, Analytics' and Clips' meeting settings, and toolkit's core
   settings pages (account, organization, integrations, models, infrastructure,
   usage, API keys, labs, audit) on the model, and SettingsPanel's 20
   collapsible sections on a `settings.section` part, with nested surfaces
   declared through `hosts` and refused otherwise, and Usage's load errors
   as `settings.notice` rows and its groups as `settings.report`. No
   settings page in toolkit draws the legacy `SettingsRow`, `SettingsGroup`
   or `SettingsSection` any more; templates still can): settings parts
   (`settings.nav`, `settings.page`, `settings.group`, `settings.row`) drawn
   from the model in Tasks, Analytics and Clips' meeting notes, in our part
   set.
4. **Foundations: legacy styling paths out** (see "Legacy styling paths go").
   Built: a theme per app (`data-app-theme="mail"`) plus `agent-native` and the
   `baseline` preview, each owning its values under `--theme-*` with the shadcn
   names as one-way aliases; every template, docs and the desktop shell on
   their theme; theme-families.css gone, with the theme family re-pointed to
   switch `data-app-theme`; the appearance tints moved into the design system
   as overlays on the theme's values; `guard:no-new-legacy-styling` (shrink-only
   per file, and no shadcn reads in design-system CSS; report at the time:
   24,165 shadcn variable uses in 1,468 files, 4,263 compat props in 730,
   220 legacy settings components in 30, 97 Radix imports in 94). Open: a
   card surface role, so the settings parts can drop shadcn's card utilities;
   an `intent` prop on menu items in place of `variant="destructive"`; then
   the guard joins the default run. And a way for apps outside this repo (and
   core's default template) to own a theme, with an upgrade path for their
   `global.css` palettes.
5. **Shell**: app shell, sidebar, page header and toolbar (native, built 2026-11-18; filter bar, search, command palette and shortcuts panel remain) and the menu swap, on the model;
   `agent-native.css` and `blocks.css` shrink into `main.css`.
6. **Dialog family**: dialog, alert-dialog, drawer (vaul goes; sheet is a side of drawer).
7. **Tooltip and popover family**: tooltip, popover, preview-card (formerly hover-card).
8. **Form controls**: input, textarea, checkbox, radio, switch, slider, field, fieldset (native), select,
   combobox (cmdk goes), label, field.
9. **Remaining primitives** (native, built 2026-11-18 except menubar, navigation-menu and toast): tabs, accordion, collapsible, toggle, toggle-group,
   scroll-area, separator, avatar, badge, progress, menubar, navigation-menu,
   toast (sonner stays behind a toolkit `toast()` adapter).
10. **Local forks**: dispatch's 50-file shadcn fork, Clips desktop's 16
    copies, docs and code-agents-ui, and the 63 direct `@radix-ui/*` imports.
11. **New baseline theme**: the Agent-Native baseline (24px controls) becomes
    the default; `classic` stays selectable.
12. **Codemod**: call sites move to the new API, draining the counted
    baselines; the one-way shadcn bridge, the compat props, `SettingsRow` and
    the Radix, CVA and tailwind-merge dependencies are removed at zero.
13. **Agent tooling**: MCP server and CLI (below). Can run in parallel from
    step 2.

## Verification

- **Part review** (replaced the shadcn parity runner, deleted 2026-11-18):
  each part's Storybook story shows every state; it is reviewed across themes
  and appearances, and axe reports nothing on it. Parts no longer match shadcn.
- **Behavior specs**: keyboard, focus return, dismissal, nesting and portal
  layering per component, plus the existing toolkit specs.
- **Theme snapshots**: each template's main screens render under each theme; a
  theme change may only differ in the properties its definition lists.
- **Generator goldens**: generating from each Radix step 9 reproduces that
  Radix scale within ΔE(OK) 0.02; contrast text meets APCA 60 on step 9.
- **Guards**: `no-raw-colors` on part and theme CSS;
  `no-part-class-redefinition` fails added app CSS that targets a catalog
  class (`.button {}`, `.sidebar .button {}`), since names are unprefixed.
- **Generated files**: `css:check` and a spec fail when `tokens.css` or a
  theme's `roles.css` drifts from `src/`.

## Agent guidance

- **`design-system` skill**: token tiers, which tier to touch, how to build a
  new part from Base UI (class contract, component tokens, data attributes),
  and what never to do (raw colors, Tailwind inside parts, new variants
  without catalog entries).
- **`translating-source-ui` skill**: turning a source product's screen into
  our parts: inventory the screen as rows (name, state, action), map each row
  to a catalog part, express the source's look as a theme, and only then write
  a new part for what is left.
- **MCP server** (`@agent-native/design-system/mcp`): `list-parts`,
  `get-part` (anatomy, props, tokens, examples), `get-tokens`,
  `create-theme` (brand inputs to tokens or CSS), `map-source-element`
  (catalog match for a described or captured element), `lint-markup`
  (catalog classes, token usage, accessibility contract), `theme-diff`.

## Risks

- **Behavior drift in overlays.** Radix and Base UI differ in focus, dismissal
  and event order. Mitigation: one family per PR, call-site audit, specs.
- **Unprefixed names.** App CSS can restyle parts by accident. Mitigation: the
  redefinition guard and the catalog as the reserved-name list.
- **Two token vocabularies during migration.** Mitigation: the bridge runs one
  direction per theme and is deleted at the end.
- **Bundle size.** Base UI replaces 30 Radix packages, vaul and cmdk; measure
  per swap.
