# Part anatomy

## DOM contract

One root class named after the catalog part, one class per sub-part
(`menu.item` renders `.menu-item`), and data attributes for everything else:

- Props are Radix Themes', written as data attributes by `splitProps`:
  `data-variant` (solid, soft, surface, outline, ghost), `data-color`
  (accent, gray, danger, warning, success, info), `data-size` (sm or md, only on
  controls that need a dense size; md the standard), `data-radius`, and booleans as empty attributes
  (`data-high-contrast`). The attributes come from the catalog definitions;
  never write one by hand.
- State comes from Base UI's own attributes: `data-open`, `data-highlighted`,
  `data-disabled`, `data-checked`, `data-side`, `data-starting-style`,
  `data-ending-style`. Do not invent class names for state.
- Keep `data-slot` where the shadcn component had one; other CSS selects on it.

The catalog (`src/catalog/parts.ts`) lists every part, its sub-parts, the Base UI
module, its props (`src/catalog/components/<name>.ts`) and any other attributes
the CSS reads. Reserved class names come from it.

## CSS contract

```css
@layer components {
  .part {
    height: var(--control-height-3);
  }
  .part[data-size="sm"] {
    height: var(--control-height-2);
  }
  .part[data-variant="solid"] {
    background-color: var(--accent-solid);
    color: var(--accent-contrast);
  }
  .part[data-variant="soft"] {
    background-color: var(--accent-a3);
    color: var(--accent-text);
  }
}
```

- Plain CSS in `@layer components`; no Tailwind, no `@apply`.
- Parts normally read roles and scale steps in flat variant and state rules.
  Switch pilots cataloged `--switch-*` inputs. Its rules resolve each input
  into a private value with the local role, scale step or dimension as the
  fallback. This preserves inherited theme overrides and local prop choices.
- Private `--_*` values can share computations and resolved inputs. Never
  `--_x: var(--y, var(--_x))`.
- A colored variant reads only `--accent-*`, which `[data-color]` binds to a
  scale, so no rule names a color. Solid fills are `--accent-solid` (hover
  `--accent-solid-hover`) under `--accent-contrast`; text on a tint is
  `--accent-text`. Neutral chrome reads roles (`--fg-muted`, `--line-subtle`).
  No literals (`no-raw-colors` covers `css/parts/`). Use `transparent`, not
  `#0000`.
- Radius as `calc(var(--shape-control) * var(--corner-scale, 1))` with
  `corner-shape: var(--corner-shape, round)` so squircle corners work.
- Hover inside `@media (hover: hover)`; press scale and motion behind
  `prefers-reduced-motion`.
- Enter/exit animations on `[data-starting-style]` / `[data-ending-style]` with
  transitions, matching the durations the shadcn component used.
- Set `outline-style: none` rather than the `outline` shorthand if the shadcn
  component used `outline-none`; the shorthand resets width and color too.

## Themes and patterns

Parts take their look from the system's own scale and roles; `src/themes/`
holds no part-specific files.

A pattern (Sidebar, Settings) places and spaces parts; it never sets a
part's values or writes selectors against it. When a pattern needs a part to
look different, it uses a component built for that case instead: a sidebar
row is a Navigation Menu link or an Item rendered as a button, not a
stretched Button. A component grows a prop only when Radix Themes has one.
