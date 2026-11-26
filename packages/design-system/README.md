# @agent-native/design-system

Tokens, color generation, themes and component CSS for Agent-Native apps.
Framework-free: no React, no Tailwind runtime. `@agent-native/toolkit` renders
the parts; this package decides how they look.

## Use it

Import the tokens, the Tailwind layer and the part styles after Tailwind, then
the app's theme. Toolkit's own stylesheet does not include them yet:

```css
@import "tailwindcss";
@import "@agent-native/toolkit/styles.css";
@import "@agent-native/design-system/tokens.css";
@import "@agent-native/design-system/main.css";
@import "@agent-native/design-system/styles.css";
@import "@agent-native/design-system/themes/mail.css";
```

Choose a look with attributes on `<html>` or any subtree:

```html
<html
  data-app-theme="mail"
  data-density="compact"
  data-radius="large"
  data-corners="squircle"
></html>
```

| Attribute          | Values                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `data-app-theme`   | an app's name (`mail`, `clips`, …) or `agent-native` (the default) |
| `data-density`     | `compact`, `default`, `comfortable`                                |
| `data-radius`      | `none`, `small`, `medium`, `large`, `full`                         |
| `data-corners`     | `round`, `squircle`                                                |
| `.dark` / `.light` | appearance                                                         |

A theme carries an app's palette, type, shape and part sizes, and owns its
values: nothing reads a variable the app defines. It also writes shadcn's
variables (`--primary`) one way, for components not yet migrated.

## Color scales

```ts
import { createPalette, paletteCss } from "@agent-native/design-system";

const palette = createPalette({ brand: "#5b5bd6", gray: "#8b8d98" });
const css = paletteCss(palette, { id: "acme" }); // applies under [data-palette="acme"]
```

`createPalette` ports Radix's custom palette generator: from one brand color it
builds 12-step solid and alpha scales for brand, gray and four status roles,
with contrast, surface, indicator and track colors, in sRGB and Display-P3.
It throws on a color it cannot parse.

## Tokens

- **Primitives**: `--gray-1..12`, `--gray-a1..12`, `--brand-*`, `--danger-*`,
  `--warning-*`, `--success-*`, `--info-*`, `--size-*`, `--radius-*`,
  `--font-size-*`, `--duration-*`, `--layer-*`.
- **Roles**: `--surface-*`, `--fg-*`, `--line-*`, `--fill-*`, `--status-*`,
  `--shape-*`, `--shadow-1..6`, `--gradient-*`.
- **Part inputs** are documented alongside props in the parts catalog. Switch
  resolves its inputs at the control so an unset input follows the current
  theme, appearance and props. For example, to change the unchecked soft
  track throughout one section:

  ```css
  [data-app-theme="design"] {
    --switch-soft-track-color: var(--gray-a6);
  }
  ```

  The Components token collection exports the Switch defaults for Figma.

With Tailwind, roles and steps are utilities: `bg-surface-canvas`,
`text-fg-muted`, `border-line`, `bg-fill-hover`, `bg-brand-9`,
`rounded-control`, `h-control-md`, `text-2`.

## Stylesheets

| Export              | Contents                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| `tokens.css`        | primitives, default color scales, density, radius and corner presets (generated) |
| `main.css`          | Tailwind v4 mapping of roles and scales to utilities and variants                |
| `styles.css`        | component CSS, one file per part                                                 |
| `themes/<name>.css` | one theme's roles and values (generated)                                         |

For a smaller bundle, import the component stylesheets used by your screen in place of `styles.css`. Focused entries are available for `announcement`, `autocomplete`, `button`, `combobox`, `design-file-panel`, `dialog`, `dock-workspace`, `icon-button`, `image-card`, `layer-tree`, `meter`, `progress`, `tabs`, and `toast`. Each includes its built-in parts, such as the dialog close button and the combobox chips. The dock workspace entry includes the tab strip, split handles, and Arrange menu. The design file panel entry includes its tabs, page list, and editable layer tree. Import styles for controls you place inside a panel separately. Load tokens and the app theme once.

```css
@import "@agent-native/design-system/tokens.css";
@import "@agent-native/design-system/components/dialog.css";
@import "@agent-native/design-system/components/combobox.css";
@import "@agent-native/design-system/themes/design.css";
```

## Developing

```sh
pnpm --filter @agent-native/design-system css        # regenerate css/ from src/
pnpm --filter @agent-native/design-system css:check  # fail on drift
pnpm --filter @agent-native/design-system tokens:export <dir>  # token files for Figma
pnpm --filter @agent-native/design-system tokens:import <dir>  # a Figma export back into src/tokens/files
pnpm --filter @agent-native/design-system test
```
