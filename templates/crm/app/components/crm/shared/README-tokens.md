# CRM surface tokens

The grid, record page, and board all style from this layer. Declared in
`app/global.css`; the JS-only half is `ui-tokens.ts` in this directory.

**Never hardcode a hex, a shadow, or a duration in a component.** If something
here has no token, add the token rather than the literal.

## Cheat sheet

| Need                     | Use                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Row height (36px, fixed) | `h-9`, or `var(--crm-row-h)` / `ROW_HEIGHT` for virtualizer math                                      |
| Header height (40px)     | `h-10`, or `var(--crm-header-h)` / `HEADER_HEIGHT`                                                    |
| Header cell padding      | `px-3` (12px), border-top **and** border-bottom                                                       |
| Body cell padding        | `px-3 pt-2` (`8px 12px 0`)                                                                            |
| Divider (both axes)      | `border-hairline` — near-invisible by design, do not reach for `border-border`                        |
| Hover overlay            | `overlayProps()` → `crm-overlay`                                                                      |
| Selection overlay        | `overlayProps({ selected })`; cells pass `soft: true`                                                 |
| Chip / record-ref        | `rounded-chip py-0.5 pr-1.5 pl-1 gap-1.5 self-start`                                                  |
| Status / select pill     | `rounded-badge` (4px), tinted fill, **no border**                                                     |
| Avatar                   | person `rounded-full`, company `rounded-avatar-company` (30%), both `ring-1 ring-inset ring-hairline` |
| Elevation                | `shadow-e1` resting · `shadow-e2` menu/popover/dragging card · `shadow-e3` dialog                     |
| Sticky-column shadow     | `var(--crm-shadow-sticky)`                                                                            |
| Motion                   | see below                                                                                             |

## Type

`letter-spacing: -0.02em` is the app default, already applied at `html`. Body
and caption sizes (`p`, `small`, `.text-sm`, `.text-xs`) relax to `-0.01em`
automatically. Both rules use `:where()`, so `tracking-ui` / `tracking-body`
override them wherever a surface needs to be explicit. **Do not add
`tracking-*` to routine text** — the default is already correct.

Weights are 400/500/600. `font-bold` is capped at 600 in the theme, so a stray
one is harmless, but write `font-semibold`.

Grid header labels are `text-sm font-medium text-content-secondary` — same size
as body, not uppercase, not smaller.

Numeric cells: `tabular-nums`.

## Content colors

Alpha over the surface, not solid greys, so they composite correctly on tinted
cells and under hover overlays.

- `text-foreground` — primary
- `text-content-secondary` (63%) — header labels, metadata
- `text-content-tertiary` (50%) — read-only cell values, placeholders
- `text-content-ghost` (38%) — disabled, empty-value hints

Prefer these over `text-muted-foreground` on grid/record/board surfaces.

## Radii

`rounded-badge` 4 · `rounded-lg` 8 (buttons, menu items) · `rounded-chip` 10 ·
`rounded-row` 11 · `rounded-card` 12 · `rounded-column` 16 · `rounded-panel` 20.

## Motion

| Token                  | Class          | ms                                                          |
| ---------------------- | -------------- | ----------------------------------------------------------- |
| `--motion-fast`        | `duration-80`  | 80 — popovers/dialogs, with `scale .97→1`                   |
| `--motion-comfortable` | `duration-140` | 140 — **the default; bare `transition-*` is already 140ms** |
| `--motion-breezy`      | `duration-200` | 200 — chip hover, sticky-shadow fade                        |
| `--motion-sluggish`    | `duration-300` | 300                                                         |
| `--motion-sloth`       | `duration-400` | 400                                                         |

Use `duration-[var(--motion-breezy)]` when the value must follow the token
(e.g. inline styles or JS-driven timing); `MOTION.breezy` for `setTimeout`.

Rules: animate only color, opacity, box-shadow and transform — **never
layout**. Never `transition-all`; list the properties. Nothing on an
interaction exceeds 200ms. `ease-drop` is the drop-confirm curve.
`prefers-reduced-motion` zeroes all of it globally — do not re-handle it.

## The overlay primitive

Hover and selection animate the **opacity of an overlay layer**. They are not
background-color swaps: a swap cannot composite over a tinted status cell and
cannot cross-fade.

```tsx
import { overlayProps } from "@/components/crm/shared/ui-tokens";

<div
  {...overlayProps({
    selected: isSelected,
    className: "flex h-9 items-stretch",
  })}
/>;
```

Content at 4% for hover, accent at 10% for selection; cells pass `soft: true`
for the 8% content variant. Nesting is intended — a hovered cell inside a
hovered row stacks to ~8%, which is the behavior we want.

`data-hovered="true"` forces the hover state for keyboard focus or drag-over.

Selection tint derives from `--crm-accent`, which currently points at
`--primary` because our skin has no brand hue. Repoint that one var if it gains
one; nothing else should reference an accent directly.
