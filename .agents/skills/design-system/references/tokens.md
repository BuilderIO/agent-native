# Tokens

## Tiers

1. **Primitives** (`css/tokens.css`, generated). Color scales `--gray-*`,
   `--brand-*`, `--danger-*`, `--warning-*`, `--success-*`, `--info-*`, each
   12 solid steps, 12 alpha steps (`-a1..12`), `-contrast`, `-surface`, and for
   accents `-indicator` / `-track`, in sRGB with Display-P3 overrides. Base
   surfaces `--base-background|panel|field|overlay`, `--shadow-tint-a1..7`.
   Ramps: `--size-1..8`, `--radius-1..6` (times `--radius-factor`),
   `--font-size|line-height|letter-spacing-0..9`, `--font-weight-*`,
   `--font-family-*`, `--duration-*`, `--ease-*`, `--layer-*`. The UI sets
   text in steps 0–2 (10, 12 and 13px, each on a 16px line), with 12px for
   almost everything; steps 3 and up (16px and larger) are for content and
   titles only. There is no 14px step. Text styles
   (`text-styles.tokens.json`) name a step, a weight and a family together;
   set text by style (`textStyle="body"`, `type-label`) rather than by step,
   and add a style rather than combine a step and weight by hand twice.
2. **Roles** (`src/tokens/roles.ts`, mapped per theme). `--surface-*`, `--fg-*`,
   `--line-*`, `--fill-*`, `--status-<s>-{solid,subtle,fg,line}`,
   `--shadow-1..6`, `--gradient-*`; shape tokens `--shape-*`; focus ring.
3. **Parts** read tiers 1 and 2 at the control. Switch also accepts the styling
   inputs listed in its parts catalog entry. Set an input such as
   `--switch-soft-track-color` on a theme root to override its fallback.

Radix's step semantics hold: 1–2 backgrounds, 3–5 component fills
(rest/hover/pressed), 6–8 borders, 9–10 solid fills, 11–12 text.

## Token files and Figma

The values designers edit live in `src/tokens/files/` as W3C design token
(DTCG) JSON, the format Figma imports and exports as variables:
`foundations.tokens.json` (control and box sizes, radius steps, type ramp,
weights, families), `palette.tokens.json` (the default palette's inputs) and
`themes/<name>.<light|dark>.tokens.json`. Code reads them through
`src/tokens/source.ts`, which throws on a missing or mistyped token. Colors
carry their exact HSL text in `$extensions["com.agent-native"].hsl`, so an
unchanged color writes the same CSS after a trip through Figma.

```sh
pnpm --filter @agent-native/design-system tokens:export <dir>  # <collection>/<mode>.tokens.json
pnpm --filter @agent-native/design-system tokens:import <dir>  # a Figma export in the same layout
pnpm --filter @agent-native/design-system css                  # then regenerate and review
```

The Components collection holds the Switch defaults. Dimensions use pixels;
color swatches represent the default theme in light mode. Unchanged swatches
retain their runtime role or scale binding. Editing a swatch supplies a literal
color, including its alpha, in every appearance. The thumb shadow is a string
accepting `none` or a system elevation from `var(--shadow-1)` through
`var(--shadow-6)`. The Switch catalog describes each input and state.

Import each exported folder into Figma as a collection, one file per mode.
`tokens:import` takes any subset of collections, but every mode of one it
takes; it refuses an unknown collection, a token code does not read, a missing
token, a changed type, an alias, an alpha in an opaque-only collection, or a palette input
`createPalette` cannot build, and writes nothing unless every file passes.
Adding a token is a code change: add it to the file and to its reader.

## Scale names

"Brand", not Radix's "accent": shadcn's `accent` is the gray hover fill in
thousands of class names. Tailwind's `--font-sans` and `--radius-*` keys are
left alone because templates depend on their current values.

## Presets

| Attribute                                          | Effect                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `data-density` compact / default / comfortable     | control paddings, the in-control gap and `--space-1..9`, all multiples of 4. Control heights stay 20 and 24px (sm and md) at every density |
| `data-radius` none / small / medium / large / full | `--radius-factor` 0 / .75 / 1 / 1.5; `full` makes controls pills                                                                           |
| `data-corners` round / squircle                    | `corner-shape: superellipse(1.3)` with radii × 1.25 where supported                                                                        |

Presets out-rank the theme on the same element (one extra attribute of
specificity) and re-declare what they derive, so a nested preset works.

## Generating colors

`createPalette({ brand, gray?, background?, status? })` ports Radix's custom
palette generator; `src/tokens/color/__fixtures__/radix-golden.json` holds 100 upstream
outputs that the spec matches to the last digit. It throws on an unparseable
color. `paletteCss(palette, { id })` scopes the scales to `[data-palette="id"]`,
restyling roles that read the scales (the baseline theme's). It writes no
shadcn values: only themes write those, one way. A palette is data: store its
inputs like any setting and apply the CSS on the client; the SSR shell stays
impersonal.

## Tailwind

`css/main.css` maps roles and steps under `@theme inline`: `bg-surface-canvas`,
`text-fg-muted`, `border-line`, `bg-fill-hover`, `bg-brand-9`, `text-gray-11`,
`rounded-control`, `h-control-md`, `text-0..9`, `shadow-elevation-1..6`, and
the variants `compact:` and `comfortable:`.
