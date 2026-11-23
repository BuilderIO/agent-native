# Themes

A theme is everything an app picks with `data-app-theme`: palette, type, shape and
part sizes. There is one per app, named for the app (`mail`, `clips`,
`analytics`, …), plus `agent-native`, the umbrella look any app can switch to
and the default with no attribute. A `ThemeDefinition` in `src/themes/` is:

- `base`, `dark`, `light`: every role, plus the theme's own values, declared
  at the theme root and under `.dark` and `.light`. Each is a complete set, so
  a nested appearance resolves on its own.
- `tokens`: appearance-independent values at the theme root: `--shape-*`, the
  focus ring, part sizes.
- `readsScales`: the roles read the generated color scales, so they are
  re-declared on `.light`, `.dark` and `[data-palette]` (the baseline theme).

## App themes

An app theme is `shadcnTheme({ name, label, values })` with the app's values
in two token files, `src/tokens/files/themes/<name>.light.tokens.json` and
`.dark.tokens.json`: the shadcn slots as `color.<slot>` and `radius` in px.
`base` is the appearance the app renders with no class (light, or dark for
analytics and slides); the other appearance keeps only what differs. The theme writes each slot under its
own name (`--theme-primary`), points its roles at those, and writes the shadcn
name as a one-way alias (`--primary: var(--theme-primary)`) for components not
yet migrated. Nothing in a theme reads a variable an app defines, and a
reference to a slot the theme lacks fails the build. Every part reads roles
and scale tokens only; a theme sets no part's values.

An app loads its theme after toolkit's styles and sets the attribute on its
root:

```css
@import "tailwindcss";
@import "@agent-native/toolkit/styles.css";
@import "@agent-native/design-system/themes/mail.css";
```

```html
<html data-app-theme="mail"></html>
```

Values stay variables, not literals: a CSS minifier rounds literal colors to
8-bit hex, which would paint migrated parts a hair off the shadcn classes
reading the same value.

## Adding one

Add the two token files, the name to `THEME_NAMES` and `TOKEN_FILES` in
`src/tokens/source.ts`, the app to `APPS` in `src/themes/index.ts`, run
`pnpm --filter @agent-native/design-system css`, and import the generated
`css/themes/<name>.css` in the app. `baseline` is the 24px look on the
generated scales, a preview of where `agent-native` goes; apps do not pick it.

## Designing one

Start from roles, then shape, density and radius; stop as soon as the look
holds. A theme never writes selectors against a part or sets a part's values:
if a role mapping cannot reach the look, the part's own design changes, for
every theme. Keep semantic states
accessible: danger stays red-family and destructive-only, warnings amber, focus
visible at 3:1 against every surface the theme defines.
