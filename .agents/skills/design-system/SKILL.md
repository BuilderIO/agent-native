---
name: design-system
description: >-
  Tokens, themes, parts and the Base UI migration in `@agent-native/design-system`.
  Use before styling a toolkit component, adding or migrating a part to Base UI,
  changing tokens, colors, density or radius, adding an app theme, or mapping an
  existing screen onto the parts.
scope: dev
metadata:
  internal: true
---

# Design System

`packages/design-system` owns how every app looks; toolkit owns behavior. A part
is one unprefixed class (`.button`, `.menu-item`) plus data attributes, styled
by plain CSS in `css/parts/<part>.css` that reads tokens only. A theme
(`data-app-theme="mail"`) restyles every part by setting custom properties, never
selectors, and never reads a variable an app defines. The plan and the PR
sequence are in `docs/plans/2026-11-17-design-system-base-ui.md`.

## Where a change goes

| You want to change | Edit |
| --- | --- |
| An app's colors or radius | its token files, `src/tokens/files/themes/<app>.{light,dark}.tokens.json`, or Figma and `tokens:import`; never in the app's CSS |
| Sizes, radius steps, type ramp, font families | `src/tokens/files/foundations.tokens.json` |
| A named text style (`body`, `label`, `title`) | `src/tokens/files/text-styles.tokens.json`; Text and Heading read it as `textStyle`, app chrome as `type-<style>` |
| The default palette's inputs | `src/tokens/files/palette.tokens.json` |
| Generated color scales | `createPalette` inputs (brand, gray, background, status); never a hex in CSS |
| What a color is for | a semantic role in `src/tokens/roles.ts` and the themes' mapping |
| How a part is built | `css/parts/<part>.css` and its toolkit component |
| Sizes across an app | `data-density` / `data-radius` / `data-corners`, not part CSS |
| App chrome layout | Tailwind utilities on role tokens: `bg-surface-nav`, `text-fg-muted`, `rounded-control` |
| What a surface contains | its headless model (`ScreenModel` rows with stable ids), drawn by `ModelSurface` |
| How a model is drawn | a part set (`defineDesignSystem({ parts })`); one model can map to several |
| Which design system a build draws with | the app's `app/design-system.ts`, swapped per build with the Vite `aliases` option; Base UI primitives through `primitives` |

After editing anything under `src/`, run `pnpm --filter @agent-native/design-system css`;
`css:check` and a spec fail when `css/tokens.css` or a `css/themes/*.css` file drifts.

## Rules that are easy to break

- Never style a part from app CSS (`.sidebar .button {}`): the names are shared
  by every app and theme. `guard:no-part-class-redefinition` fails it. Put layout
  on a wrapper or utilities on the element; restyle through the theme.
- Never put height, size, padding, radius, type-size, weight or arbitrary-width
  classes (`h-6`, `px-2`, `text-[11px]`, `min-w-[12rem]`) on a part's
  `className`: the part sizes itself through `size`.
  `guard:no-part-geometry-classes` fails it in the toolkit and each migrated
  app (`MIGRATED_ROOTS` in the guard; add an app when it moves onto the
  parts); layout classes (`w-full`, `flex-1`, margins) stay fine.
- A part's private custom properties (`--_*`) must never reference themselves,
  even in a fallback: CSS invalidates the cycle and the property silently
  resolves to nothing.
- Each app theme generates its own color scales from its colors and binds the
  accent again inside its scope, so a component draws that app's palette.
  Never hand-write a scale step in a theme.
- Inside `@scope`, a bare selector matches descendants only; a scope root that
  is itself `.dark` needs `:scope.dark`.
- Read color only from roles (`--fg-muted`) or scale steps (`--gray-11`). Roles
  are re-resolved on every `.light`, `.dark` and `[data-palette]` scope;
  a value captured into a non-role variable at the root goes stale in a dark
  subtree.
- Shape tokens are `--shape-*`, not `--radius-*`: templates already use
  `--radius-card` and friends for their own values.
- Base UI's Button defaults `type="button"`; toolkit passes `type` through so
  an untyped Button still submits its form. Keep that for every button-like part.
- Choose the element by what it does: a link goes somewhere, a button does
  something. A link that looks like a button is `ButtonLink` or
  `IconButtonLink`, an `<a href>` with Button's look (a router link through
  `render`). Never `<Button render={<a />} nativeButton={false}>`: Base UI
  gives it button semantics, so screen readers announce a button and it
  leaves their links list. A link has no disabled or loading state; render
  text or a button instead.

## Building a component

Base UI's component list (base-ui.com/react/components) and Radix Themes'
set the breadth: what the system covers. How it is built follows Material,
Carbon, Stripe and Atlassian, and where Radix's structure differs, theirs
wins. So type is a foundation: text is set by a named text style
(`src/tokens/files/text-styles.tokens.json`: `body`, `label`, `title`), never
by a raw step, and Strong, Em and Quote are not components because plain
`<strong>`, `<em>` and `<q>` inherit the style. A component takes Base UI's
name where Base UI has it (Menu, Preview Card, Input, Meter, Toast) and Radix
Themes' name otherwise (Kbd, Callout, Text Area, Segmented Control, Icon
Button). It gets one source file, one CSS
file, one catalog entry and one story page under that name: Checkbox Group is
`checkbox-group.tsx`, `checkbox-group.css` and `Components/Checkbox Group`,
never folded into Checkbox. Its classes stay in its own family. Text, Heading, Code,
Kbd and Blockquote are under `Typography/`. A layout of components (Sidebar,
Settings) is a pattern under `Patterns/`; it adds layout CSS, never restyles a
component.

Props are Radix Themes': `variant` (solid, soft, surface, outline, ghost),
`color` (accent, gray, danger, warning, success, info), `size` (sm or md on
the controls that need a dense size, md the standard; every other part has
one size; the type scale's "0"–"9" for text), `radius` and `highContrast`. A component supports a subset of each list and never adds its
own spelling of one; a spec fails on `intent`, `emphasis` or a value outside
the shared lists.

1. Define its props in `src/catalog/components/<name>.ts` with the helpers in
   `src/catalog/props.ts`, and register them on its entry in
   `src/catalog/parts.ts` (`props` for the root, `subPartProps` for a part
   such as `popup` or `item`). These definitions are the only source: the
   component's types, its Storybook controls, the manifest agents read and the
   Figma check all derive from them. Rebuild with
   `pnpm --filter @agent-native/design-system build` before typechecking
   toolkit, which reads the built types.
2. Wrap the Base UI component in `packages/toolkit/src/ui/base-ui/<name>.tsx`.
   `splitProps(defs, props)` turns the definitions into data attributes,
   defaults filled in, and throws on a value they don't allow. Pass Base UI's
   props, events and state attributes straight through (`render`,
   `onOpenChange(open, details)`, `data-open`). A component with no behavior
   renders through `useRender`. Components carry no copy: labels come from
   the caller. `button.tsx` and `badge.tsx` are the reference.
3. Write `css/parts/<name>.css` on the color model: `[data-color]` binds the
   `--accent-*` steps, so a variant reads only those. Solid fills use
   `--accent-solid` under `--accent-contrast`, and text on a tint, surface,
   outline or ghost uses `--accent-text`: each palette picks those steps to
   hold WCAG AA at 12px, where Radix's step 9 and 11 don't. Never use
   `--accent-9`, `--accent-10` or `--accent-a11` for text or fills. Sizes read
   `--control-height-1..4`; `data-radius` re-declares the shape tokens on the
   element, so a part that reads `--shape-*` takes `radius` for free.
4. Add specs for the API and a story page in
   `packages/toolkit/dev/stories/components/` whose controls come from
   `propControls(<defs>)`: Playground, Sizes, Variants × colors (and high
   contrast), and every state. Check it across themes and both appearances.
5. Move call sites to the new props; typecheck lists them. A popup's defaults
   (soft, gray) keep today's look, so most call sites need no props.

Details: `references/model.md` (headless model, part sets, equivalence and
row style checks), `references/app-shell.md` (shell model, frames, shell
behaviour hooks and snapshot checks), `references/parts.md` (part anatomy and CSS contract),
`references/tokens.md` (tiers, names, presets, generation),
`references/themes.md` (app themes), `references/translating.md` (mapping an
existing screen onto parts).

## Asking Storybook

With Storybook running, its MCP server at `http://localhost:6006/mcp` answers
questions about the components from the components manifest: `docs-list`
lists them, `docs-show` gives one's props (with descriptions and defaults
from the catalog), its import, and its stories as code. Use it before writing
UI with the components, and never use a prop it doesn't document. The
repo's `.mcp.json` registers it as `agent-native-storybook`; it answers only
while Storybook runs (`pnpm storybook` in `packages/toolkit`). The manifest
itself is `http://localhost:6006/manifests/components.json`.

A prop's description and default reach the manifest through the interfaces
`pnpm --filter @agent-native/design-system props` generates from the catalog
(`src/catalog/prop-types.generated.ts`); a spec and a type check fail when
they fall behind. A component's description and import come from its own
JSDoc, including an `@import` tag with its `@agent-native/toolkit/ui/base-ui/`
path.

## Seeing it

`preview_start` the `design-system-storybook` launch entry (Storybook, port
6006), or `pnpm storybook` in `packages/toolkit`. The toolbar picks `theme`,
`appearance`, `density`, `radius`, `corners` and `palette`; in a URL they are
`globals=theme:mail;appearance:dark;...`. The sidebar has Introduction,
Migration status (per app, the files still on an older source for each
component), Foundations (the tokens, live under the toolbar), Components and
Patterns. A component's docs page lists its props from the catalog.
