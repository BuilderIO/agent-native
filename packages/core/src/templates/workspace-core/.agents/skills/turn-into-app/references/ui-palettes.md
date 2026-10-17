# UI palettes

## Contents

- How to apply a direction
- Shared block
- ledger
- control-room
- paper-desk
- studio-canvas
- tidepool
- signal-board

Six named directions. Pick one in section 4 of
[ui-direction.md](ui-direction.md). Read How to apply, the Shared block, and
the one direction you chose; skip the others.

## How to apply a direction

1. Install the direction's fonts: `pnpm add @fontsource-variable/<name>@latest`
   for each package it lists.
2. At the top of `app/global.css`, replace
   `@import "@fontsource-variable/inter";` with the direction's import lines.
   CSS `@import` rules must stay above every other rule.
3. Append the direction's end-of-file block, then the shared block, to the end
   of `app/global.css`. Later declarations win, so this replaces the
   scaffold's grey tokens in light and dark and keeps its layout variables
   (`--chat-sidebar-*`). Removing the scaffold's old color values and its Inter
   `font-family` line is optional tidying.
4. In the review metrics, `defaultTokens` and `neutralPrimary` must read
   false in light and dark.

Rules for the tokens:

- The scaffold's components read `hsl(var(--token))` (the toolkit maps
  `bg-primary` to `hsl(var(--primary))`), so every color variable is an HSL
  triplet with no color function around it. Never put `oklch()` or hex in them. The trailing
  comment is the oklch design value the triplet was converted from.
- Every text pair was checked in light and dark: foreground on background and
  card at 7:1 or better; muted text, button text, accent text, and status
  colors at 4.5:1; chart series at 3:1 against the card.
- A brand color from the source goes in `--primary` and `--ring`; keep the
  direction's neutrals. A branded app still appends a direction block and the
  shared block: the scaffold defines no `--chart-*`, `--ok`, `--warn`, or
  `--bad`, so without them `surface`, `bg-ok`, and chart colors do nothing.
- The shared block adds `ok`, `warn`, `bad`, and `chart-1` to `chart-4` as
  Tailwind colors (`text-bad`, `bg-ok/10`, `stroke-chart-1`), the `surface`
  utility (a shadow ring, used on cards and panels instead of a border;
  borders stay for dividers and inputs), and the `working` utility (the
  shimmer for a slot the agent is filling; it holds still under reduced
  motion).
  Nested radius = outer radius minus the padding between them.
- Chart series 4 is never the `--bad` hue, so a fourth series does not read
  as an error.

## Shared block

Append once, after the direction's end-of-file block.

```css
:root,
.dark {
  --secondary: var(--muted);
  --secondary-foreground: var(--foreground);
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --input: var(--border);
  --destructive: var(--bad);
  --destructive-foreground: var(--primary-foreground);
  --sidebar-background: var(--muted);
  --sidebar-foreground: var(--muted-foreground);
  --sidebar-primary: var(--primary);
  --sidebar-primary-foreground: var(--primary-foreground);
  --sidebar-accent: var(--accent);
  --sidebar-accent-foreground: var(--accent-foreground);
  --sidebar-border: var(--border);
  --sidebar-ring: var(--ring);
}
:root {
  --shadow-ring:
    0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.06),
    0 2px 4px oklch(0 0 0 / 0.04);
  --shadow-pop:
    0 8px 24px -8px oklch(0 0 0 / 0.18), 0 0 0 1px oklch(0 0 0 / 0.06);
}
.dark {
  --shadow-ring: 0 0 0 1px oklch(1 0 0 / 0.08);
  --shadow-pop:
    0 8px 24px -8px oklch(0 0 0 / 0.5), 0 0 0 1px oklch(1 0 0 / 0.1);
}
@theme inline {
  --color-ok: hsl(var(--ok));
  --color-warn: hsl(var(--warn));
  --color-bad: hsl(var(--bad));
  --color-chart-1: hsl(var(--chart-1));
  --color-chart-2: hsl(var(--chart-2));
  --color-chart-3: hsl(var(--chart-3));
  --color-chart-4: hsl(var(--chart-4));
}
@utility surface {
  background: hsl(var(--card));
  border-radius: var(--radius);
  box-shadow: var(--shadow-ring);
}
@keyframes an-shimmer {
  to {
    background-position: -200% 0;
  }
}
@utility working {
  background: linear-gradient(
      90deg,
      hsl(var(--muted)) 25%,
      hsl(var(--accent)) 50%,
      hsl(var(--muted)) 75%
    )
    0 0 / 200% 100%;
  animation: an-shimmer 1.4s linear infinite;
  border-radius: calc(var(--radius) - 2px);
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
}
@layer base {
  body {
    -webkit-font-smoothing: antialiased;
    font-synthesis: none;
  }
  h1,
  h2,
  h3 {
    text-wrap: balance;
    letter-spacing: -0.01em;
  }
  p {
    text-wrap: pretty;
  }
  table,
  .tabular {
    font-variant-numeric: tabular-nums;
  }
}
```

## ledger

Numbers you can trust at a glance.

- Fonts: `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`
- Type scale: body 14/20, table 13/18, pane title 15/20 600 (-0.01em), hero number 32/36 600 tabular-nums.
- Density: Compact. Controls 32px, rows 32px, panel padding 16-20px, gaps 12px.
- Radius and depth: `--radius: 0.375rem`. Hairline ring only; shadows only on popovers. Chart grid dotted, 1px, `--border`.
- Motion: Almost none. Numbers tween 300ms ease-out-strong when an input changes; the chart draws once in 400ms; nothing animates on navigation.
- Discipline: Pine is the accent, not a wash: primary actions, selected rows, the main series.

Top of `app/global.css`, in place of the Inter import:

```css
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";
```

End of `app/global.css`:

```css
body {
  font-family: "Geist Variable", system-ui, sans-serif;
}
.font-data {
  font-family: "Geist Mono Variable", ui-monospace, monospace;
} /* cell addresses and ids only */
:root {
  --radius: 0.375rem;
  --background: 144 21% 97.9%; /* oklch(0.985 0.003 160) */
  --foreground: 154 31% 9.8%; /* oklch(0.23 0.025 165) */
  --card: 0 0% 100%; /* oklch(1 0 0) */
  --muted: 144 14% 93.8%; /* oklch(0.955 0.006 160) */
  --muted-foreground: 151 8% 37.5%; /* oklch(0.5 0.022 165) */
  --border: 144 10% 87.8%; /* oklch(0.91 0.008 160) */
  --primary: 161 83% 19.6%; /* oklch(0.42 0.085 165) */
  --primary-foreground: 144 33% 97.7%; /* oklch(0.985 0.005 160) */
  --accent: 151 56% 91.4%; /* oklch(0.95 0.03 165) */
  --accent-foreground: 161 100% 12%; /* oklch(0.32 0.07 165) */
  --ring: 158 53% 33.7%; /* oklch(0.55 0.1 165) */
  --ok: 141 64% 26.8%; /* oklch(0.48 0.12 150) */
  --warn: 35 99% 27.9%; /* oklch(0.5 0.12 65) */
  --bad: 356 77% 40.6%; /* oklch(0.5 0.19 25) */
  --chart-1: 161 76% 22.4%; /* oklch(0.45 0.09 165) */
  --chart-2: 40 96% 35.8%; /* oklch(0.62 0.13 75) */
  --chart-3: 209 56% 45.2%; /* oklch(0.55 0.12 250) */
  --chart-4: 289 35% 48.3%; /* oklch(0.55 0.15 320) */
}
.dark {
  --background: 152 17% 8%; /* oklch(0.2 0.012 165) */
  --foreground: 144 14% 91.7%; /* oklch(0.94 0.008 160) */
  --card: 152 15% 11%; /* oklch(0.235 0.014 165) */
  --muted: 152 12% 14.3%; /* oklch(0.27 0.014 165) */
  --muted-foreground: 145 8% 63.4%; /* oklch(0.72 0.02 160) */
  --border: 151 10% 20%; /* oklch(0.33 0.016 165) */
  --primary: 156 54% 59.9%; /* oklch(0.78 0.12 165) */
  --primary-foreground: 156 57% 6.6%; /* oklch(0.2 0.03 165) */
  --accent: 155 36% 15.1%; /* oklch(0.3 0.04 165) */
  --accent-foreground: 152 57% 86%; /* oklch(0.92 0.05 165) */
  --ring: 157 45% 49.3%; /* oklch(0.7 0.12 165) */
  --ok: 135 54% 61.4%; /* oklch(0.78 0.15 150) */
  --warn: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --bad: 3 100% 73.3%; /* oklch(0.74 0.17 25) */
  --chart-1: 156 54% 59.9%; /* oklch(0.78 0.12 165) */
  --chart-2: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --chart-3: 210 85% 69.1%; /* oklch(0.74 0.12 250) */
  --chart-4: 289 60% 74%; /* oklch(0.76 0.13 320) */
}
```

## control-room

Calm until something needs you.

- Fonts: `@fontsource-variable/inter-tight`, `@fontsource-variable/jetbrains-mono`
- Type scale: body 13/18, labels 12/16 500, pane title 14/20 600.
- Density: Tightest. Rows 28px, controls 28-32px, panel gap 8px. 1px hairlines are fine here.
- Radius and depth: `--radius: 0.25rem`. Elevation by lightness steps, not shadows. Status is a solid 8px dot plus text, never a glow.
- Motion: 120ms ease-out. A row that changes flashes a background tint that fades over 600ms. No entrance animation.
- Discipline: Amber is the accent for selection, focus, and, in dark, the primary action; in light the primary action is navy ink. Attention state uses `--warn`. Never use amber as decoration. Design the dark palette first; light must still pass the rubric.

Top of `app/global.css`, in place of the Inter import:

```css
@import "@fontsource-variable/inter-tight";
@import "@fontsource-variable/jetbrains-mono";
```

End of `app/global.css`:

```css
body {
  font-family: "Inter Tight Variable", system-ui, sans-serif;
}
.font-data {
  font-family: "JetBrains Mono Variable", ui-monospace, monospace;
} /* ids, timestamps, log lines */
:root {
  --radius: 0.25rem;
  --background: 211 24% 96.2%; /* oklch(0.97 0.004 250) */
  --foreground: 211 26% 8.9%; /* oklch(0.2 0.015 250) */
  --card: 0 0% 100%; /* oklch(1 0 0) */
  --muted: 211 18% 92.4%; /* oklch(0.94 0.006 250) */
  --muted-foreground: 211 10% 37.3%; /* oklch(0.48 0.02 250) */
  --border: 211 13% 86%; /* oklch(0.89 0.008 250) */
  --primary: 213 62% 19.4%; /* oklch(0.3 0.07 255) */
  --primary-foreground: 211 37% 97.5%; /* oklch(0.98 0.004 250) */
  --accent: 40 97% 89.2%; /* oklch(0.95 0.05 85) */
  --accent-foreground: 37 99% 18.4%; /* oklch(0.38 0.09 70) */
  --ring: 40 96% 35.8%; /* oklch(0.62 0.14 75) */
  --ok: 141 64% 26.8%; /* oklch(0.48 0.12 150) */
  --warn: 35 99% 27.9%; /* oklch(0.5 0.12 65) */
  --bad: 356 77% 40.6%; /* oklch(0.5 0.19 25) */
  --chart-1: 40 96% 35.8%; /* oklch(0.62 0.15 75) */
  --chart-2: 195 100% 28.4%; /* oklch(0.5 0.1 230) */
  --chart-3: 159 100% 24.5%; /* oklch(0.52 0.12 160) */
  --chart-4: 264 42% 54%; /* oklch(0.55 0.15 300) */
}
.dark {
  --background: 211 22% 5.4%; /* oklch(0.16 0.008 250) */
  --foreground: 211 13% 91.1%; /* oklch(0.93 0.005 250) */
  --card: 211 17% 8.9%; /* oklch(0.2 0.01 250) */
  --muted: 211 15% 12.5%; /* oklch(0.24 0.012 250) */
  --muted-foreground: 211 8% 62.6%; /* oklch(0.7 0.015 250) */
  --border: 211 14% 18.3%; /* oklch(0.3 0.015 250) */
  --primary: 40 92% 60.4%; /* oklch(0.82 0.15 80) */
  --primary-foreground: 38 68% 6.8%; /* oklch(0.2 0.03 80) */
  --accent: 38 55% 12.3%; /* oklch(0.27 0.04 80) */
  --accent-foreground: 41 96% 77.7%; /* oklch(0.9 0.1 85) */
  --ring: 40 71% 52.7%; /* oklch(0.75 0.14 80) */
  --ok: 135 54% 61.4%; /* oklch(0.78 0.15 150) */
  --warn: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --bad: 3 100% 71%; /* oklch(0.72 0.18 25) */
  --chart-1: 40 92% 60.4%; /* oklch(0.82 0.15 80) */
  --chart-2: 199 65% 62.6%; /* oklch(0.74 0.1 230) */
  --chart-3: 151 51% 57.3%; /* oklch(0.76 0.13 160) */
  --chart-4: 262 75% 76.8%; /* oklch(0.74 0.13 300) */
}
```

## paper-desk

A document that thinks with you.

- Fonts: `@fontsource-variable/figtree`, `@fontsource-variable/source-serif-4`
- Type scale: UI 14/20; document body 17/28 at 66ch; section titles Figtree 22/28 650 balanced; no all-caps labels.
- Density: Airy reading column (68ch, 40px padding) beside dense rails (13px text, 28px rows).
- Radius and depth: `--radius: 0.5rem`. The page is a sheet: `--card` on a `--muted` ground with `--shadow-pop`; citation chips 4px radius.
- Motion: 150ms. Hovering a citation crossfades the matching source highlight. Nothing else moves.
- Discipline: Plum is links, citations, and the primary action. `--mark` highlights cited text only.

Top of `app/global.css`, in place of the Inter import:

```css
@import "@fontsource-variable/figtree";
@import "@fontsource-variable/source-serif-4";
```

End of `app/global.css`:

```css
body {
  font-family: "Figtree Variable", system-ui, sans-serif;
}
.prose-doc {
  font-family: "Source Serif 4 Variable", Georgia, serif;
  font-size: 17px;
  line-height: 28px;
  max-width: 66ch;
}
@theme inline {
  --color-mark: hsl(var(--mark));
} /* class: bg-mark */
:root {
  --radius: 0.5rem;
  --background: 258 19% 97.7%; /* oklch(0.98 0.003 300) */
  --foreground: 273 15% 13.2%; /* oklch(0.24 0.02 310) */
  --card: 258 62% 99.5%; /* oklch(0.995 0.002 300) */
  --muted: 265 16% 94.6%; /* oklch(0.955 0.006 305) */
  --muted-foreground: 266 6% 40.2%; /* oklch(0.5 0.02 305) */
  --border: 265 13% 89.1%; /* oklch(0.91 0.01 305) */
  --primary: 311 42% 31.7%; /* oklch(0.42 0.12 335) */
  --primary-foreground: 308 36% 98.2%; /* oklch(0.985 0.005 330) */
  --accent: 316 75% 93.7%; /* oklch(0.94 0.035 335) */
  --accent-foreground: 310 51% 20.8%; /* oklch(0.32 0.1 335) */
  --ring: 311 35% 46.8%; /* oklch(0.55 0.14 335) */
  --ok: 141 64% 26.8%; /* oklch(0.48 0.12 150) */
  --warn: 35 99% 27.9%; /* oklch(0.5 0.12 65) */
  --bad: 356 77% 40.6%; /* oklch(0.5 0.19 25) */
  --chart-1: 311 38% 35.2%; /* oklch(0.45 0.12 335) */
  --chart-2: 44 86% 33.9%; /* oklch(0.6 0.12 85) */
  --chart-3: 196 83% 32.4%; /* oklch(0.52 0.1 230) */
  --chart-4: 157 78% 29.7%; /* oklch(0.55 0.12 160) */
  --mark: 51 92% 75.9%; /* oklch(0.93 0.12 100) */
}
.dark {
  --background: 273 12% 9.2%; /* oklch(0.2 0.012 310) */
  --foreground: 272 11% 92.6%; /* oklch(0.94 0.006 310) */
  --card: 273 11% 12.4%; /* oklch(0.235 0.014 310) */
  --muted: 273 9% 15.8%; /* oklch(0.27 0.015 310) */
  --muted-foreground: 273 7% 65.8%; /* oklch(0.72 0.02 310) */
  --border: 273 9% 21.8%; /* oklch(0.33 0.018 310) */
  --primary: 313 60% 72.9%; /* oklch(0.76 0.13 335) */
  --primary-foreground: 312 39% 9.3%; /* oklch(0.2 0.04 335) */
  --accent: 313 26% 19%; /* oklch(0.3 0.05 335) */
  --accent-foreground: 315 80% 91.6%; /* oklch(0.92 0.05 335) */
  --ring: 313 46% 65.4%; /* oklch(0.7 0.13 335) */
  --ok: 135 54% 61.4%; /* oklch(0.78 0.15 150) */
  --warn: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --bad: 3 100% 73.3%; /* oklch(0.74 0.17 25) */
  --chart-1: 313 60% 72.9%; /* oklch(0.76 0.13 335) */
  --chart-2: 44 74% 66.2%; /* oklch(0.84 0.12 90) */
  --chart-3: 199 65% 62.6%; /* oklch(0.74 0.1 230) */
  --chart-4: 151 51% 57.3%; /* oklch(0.76 0.13 160) */
  --mark: 49 90% 20.9%; /* oklch(0.45 0.09 95) */
}
```

## studio-canvas

The work is the interface.

- Fonts: `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/hanken-grotesk`
- Type scale: UI 14/20; artifact titles Bricolage 600 20/24; stage heading 28/32.
- Density: Roomy stage. Tile gaps 8-16px; toolbars float with 12px radius and `--shadow-pop`.
- Radius and depth: `--radius: 0.75rem`. Tiles 14px radius around 6px-inset media (concentric: 14 = 8 + 6). Media gets a 1px outline, pure `oklch(0 0 0 / 0.1)` light and `oklch(1 0 0 / 0.1)` dark.
- Motion: A tile expands into the stage in 300ms with a native view transition (`view-transition-name`), no motion library. No entrance stagger.
- Discipline: Lime marks selection and focus (dark: also the primary action); in light the primary action is violet ink and hover is the pale lime wash. The art carries the color; dark stage first.

Top of `app/global.css`, in place of the Inter import:

```css
@import "@fontsource-variable/bricolage-grotesque";
@import "@fontsource-variable/hanken-grotesk";
```

End of `app/global.css`:

```css
body {
  font-family: "Hanken Grotesk Variable", system-ui, sans-serif;
}
.font-display {
  font-family: "Bricolage Grotesque Variable", system-ui, sans-serif;
} /* artifact titles, stage heading */
:root {
  --radius: 0.75rem;
  --background: 224 12% 95%; /* oklch(0.96 0.003 270) */
  --foreground: 224 14% 9.2%; /* oklch(0.2 0.01 270) */
  --card: 0 0% 100%; /* oklch(1 0 0) */
  --muted: 224 9% 91.2%; /* oklch(0.93 0.004 270) */
  --muted-foreground: 224 4% 39.6%; /* oklch(0.5 0.01 270) */
  --border: 224 6% 84.9%; /* oklch(0.88 0.005 270) */
  --primary: 249 50% 22.8%; /* oklch(0.28 0.1 285) */
  --primary-foreground: 224 25% 97.6%; /* oklch(0.98 0.003 270) */
  --accent: 83 82% 86%; /* oklch(0.95 0.08 125) */
  --accent-foreground: 78 91% 7.8%; /* oklch(0.25 0.06 125) */
  --ring: 75 99% 24.9%; /* oklch(0.55 0.15 125) */
  --ok: 141 64% 26.8%; /* oklch(0.48 0.12 150) */
  --warn: 35 99% 27.9%; /* oklch(0.5 0.12 65) */
  --bad: 356 77% 40.6%; /* oklch(0.5 0.19 25) */
  --chart-1: 75 99% 24.9%; /* oklch(0.55 0.17 125) */
  --chart-2: 247 39% 51.2%; /* oklch(0.5 0.15 285) */
  --chart-3: 29 88% 41.7%; /* oklch(0.62 0.15 55) */
  --chart-4: 183 88% 28%; /* oklch(0.55 0.1 200) */
}
.dark {
  --background: 224 11% 4.6%; /* oklch(0.15 0.004 270) */
  --foreground: 224 9% 93.7%; /* oklch(0.95 0.003 270) */
  --card: 224 7% 8.9%; /* oklch(0.2 0.005 270) */
  --muted: 224 6% 13.5%; /* oklch(0.25 0.006 270) */
  --muted-foreground: 224 5% 65.3%; /* oklch(0.72 0.01 270) */
  --border: 224 6% 18.4%; /* oklch(0.3 0.008 270) */
  --primary: 79 87% 64.2%; /* oklch(0.9 0.19 125) */
  --primary-foreground: 80 85% 6.4%; /* oklch(0.22 0.05 125) */
  --accent: 78 83% 11%; /* oklch(0.3 0.07 125) */
  --accent-foreground: 82 84% 79%; /* oklch(0.93 0.12 125) */
  --ring: 79 71% 59.3%; /* oklch(0.85 0.18 125) */
  --ok: 135 54% 61.4%; /* oklch(0.78 0.15 150) */
  --warn: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --bad: 3 100% 73.3%; /* oklch(0.74 0.17 25) */
  --chart-1: 79 87% 64.2%; /* oklch(0.9 0.19 125) */
  --chart-2: 243 98% 80.6%; /* oklch(0.74 0.14 285) */
  --chart-3: 25 98% 70.1%; /* oklch(0.8 0.13 55) */
  --chart-4: 183 59% 61.9%; /* oklch(0.8 0.1 200) */
}
```

## tidepool

Friendly operations for people work.

- Fonts: `@fontsource-variable/onest`
- Type scale: body 14/21, titles 16/22 650, hero 28/32; tabular-nums on every time and count.
- Density: Comfortable. Controls 36-40px, rows 44px, padding 24px, gaps 16px.
- Radius and depth: `--radius: 0.75rem`; avatars full-round. Layered soft shadow tinted teal: `0 1px 2px oklch(0.3 0.05 215 / 0.08), 0 4px 12px oklch(0.3 0.05 215 / 0.06)`.
- Motion: 200ms ease-out. Accept or drop settles scale 1 to 0.98 to 1 in 160ms. No bounce.
- Discipline: Coral (`--chart-2`) is the warm secondary for people; attention state uses `--warn`. Never weight teal and coral equally.

Top of `app/global.css`, in place of the Inter import:

```css
@import "@fontsource-variable/onest";
```

End of `app/global.css`:

```css
body {
  font-family: "Onest Variable", system-ui, sans-serif;
}
:root {
  --radius: 0.75rem;
  --background: 182 46% 97.5%; /* oklch(0.985 0.006 200) */
  --foreground: 194 47% 11.6%; /* oklch(0.25 0.03 220) */
  --card: 0 0% 100%; /* oklch(1 0 0) */
  --muted: 182 31% 93.9%; /* oklch(0.96 0.01 200) */
  --muted-foreground: 192 16% 37.2%; /* oklch(0.5 0.03 215) */
  --border: 182 20% 88.5%; /* oklch(0.92 0.012 200) */
  --primary: 183 93% 24%; /* oklch(0.5 0.1 200) */
  --primary-foreground: 182 46% 98.3%; /* oklch(0.99 0.004 200) */
  --accent: 183 64% 90.7%; /* oklch(0.95 0.03 200) */
  --accent-foreground: 185 100% 14.4%; /* oklch(0.35 0.08 205) */
  --ring: 183 84% 32.3%; /* oklch(0.6 0.1 200) */
  --ok: 141 64% 26.8%; /* oklch(0.48 0.12 150) */
  --warn: 35 99% 27.9%; /* oklch(0.5 0.12 65) */
  --bad: 356 77% 40.6%; /* oklch(0.5 0.19 25) */
  --chart-1: 183 93% 24%; /* oklch(0.5 0.1 200) */
  --chart-2: 12 78% 61.4%; /* oklch(0.68 0.16 35) */
  --chart-3: 232 42% 55.1%; /* oklch(0.55 0.13 275) */
  --chart-4: 50 93% 32.1%; /* oklch(0.62 0.13 95) */
}
.dark {
  --background: 194 43% 7.8%; /* oklch(0.2 0.02 220) */
  --foreground: 189 20% 91.7%; /* oklch(0.94 0.008 210) */
  --card: 195 35% 10.8%; /* oklch(0.235 0.022 220) */
  --muted: 195 30% 14%; /* oklch(0.27 0.024 220) */
  --muted-foreground: 189 16% 62.5%; /* oklch(0.72 0.03 210) */
  --border: 195 24% 19.8%; /* oklch(0.33 0.026 220) */
  --primary: 183 60% 56.7%; /* oklch(0.78 0.11 200) */
  --primary-foreground: 192 100% 6.3%; /* oklch(0.2 0.04 215) */
  --accent: 185 93% 11.7%; /* oklch(0.3 0.05 205) */
  --accent-foreground: 183 66% 84.7%; /* oklch(0.92 0.05 200) */
  --ring: 183 62% 44.8%; /* oklch(0.7 0.11 200) */
  --ok: 135 54% 61.4%; /* oklch(0.78 0.15 150) */
  --warn: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --bad: 3 100% 73.3%; /* oklch(0.74 0.17 25) */
  --chart-1: 183 60% 56.7%; /* oklch(0.78 0.11 200) */
  --chart-2: 12 96% 72%; /* oklch(0.76 0.14 35) */
  --chart-3: 231 85% 77.5%; /* oklch(0.74 0.12 275) */
  --chart-4: 48 64% 62.6%; /* oklch(0.82 0.12 95) */
}
```

## signal-board

Status you can read across the room.

- Fonts: `@fontsource-variable/schibsted-grotesk`
- Type scale: body 14/20, card title 14/20 600, lane header 13/16 600 with tabular count.
- Density: Medium. Card padding 12px, lane gap 12px; a lane is a `--muted` tint with 12px radius that fits its cards (`h-fit`), never stretched to the pane height.
- Radius and depth: `--radius: 0.5rem`. Cards use the ring shadow and lift 1px on hover; the dragged card gets `--shadow-pop`.
- Motion: 150ms ease-out. dnd-kit's drop animation (200ms) settles the card; sortable transitions handle reorder.
- Discipline: Lane identity is a dot plus header text from ok/warn/bad/primary, never a colored side border.

Top of `app/global.css`, in place of the Inter import:

```css
@import "@fontsource-variable/schibsted-grotesk";
```

End of `app/global.css`:

```css
body {
  font-family: "Schibsted Grotesk Variable", system-ui, sans-serif;
}
:root {
  --radius: 0.5rem;
  --background: 214 45% 97%; /* oklch(0.975 0.006 255) */
  --foreground: 217 38% 11.5%; /* oklch(0.22 0.03 260) */
  --card: 0 0% 100%; /* oklch(1 0 0) */
  --muted: 214 45% 94.1%; /* oklch(0.95 0.012 255) */
  --muted-foreground: 216 14% 40.3%; /* oklch(0.5 0.03 258) */
  --border: 214 21% 87.6%; /* oklch(0.9 0.012 255) */
  --primary: 220 74% 46.1%; /* oklch(0.5 0.19 262) */
  --primary-foreground: 214 81% 98.9%; /* oklch(0.99 0.004 255) */
  --accent: 216 96% 93.8%; /* oklch(0.94 0.04 258) */
  --accent-foreground: 220 82% 31.1%; /* oklch(0.38 0.15 262) */
  --ring: 220 80% 58.5%; /* oklch(0.6 0.18 262) */
  --ok: 141 64% 26.8%; /* oklch(0.48 0.12 150) */
  --warn: 35 99% 27.9%; /* oklch(0.5 0.12 65) */
  --bad: 356 77% 40.6%; /* oklch(0.5 0.19 25) */
  --chart-1: 220 74% 46.1%; /* oklch(0.5 0.19 262) */
  --chart-2: 40 96% 35.8%; /* oklch(0.62 0.15 75) */
  --chart-3: 159 97% 26.8%; /* oklch(0.55 0.13 160) */
  --chart-4: 304 42% 45.8%; /* oklch(0.55 0.17 330) */
}
.dark {
  --background: 219 32% 8.6%; /* oklch(0.19 0.02 262) */
  --foreground: 214 24% 92.6%; /* oklch(0.94 0.008 255) */
  --card: 219 29% 12.4%; /* oklch(0.23 0.025 262) */
  --muted: 219 26% 16.3%; /* oklch(0.27 0.028 262) */
  --muted-foreground: 214 18% 65.9%; /* oklch(0.72 0.03 255) */
  --border: 219 21% 22.4%; /* oklch(0.33 0.03 262) */
  --primary: 219 99% 72.2%; /* oklch(0.72 0.15 262) */
  --primary-foreground: 219 64% 8.4%; /* oklch(0.18 0.04 262) */
  --accent: 219 52% 20.8%; /* oklch(0.3 0.07 262) */
  --accent-foreground: 214 97% 91.4%; /* oklch(0.92 0.05 255) */
  --ring: 219 95% 69.9%; /* oklch(0.7 0.15 262) */
  --ok: 135 54% 61.4%; /* oklch(0.78 0.15 150) */
  --warn: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --bad: 3 100% 73.3%; /* oklch(0.74 0.17 25) */
  --chart-1: 219 99% 72.2%; /* oklch(0.72 0.15 262) */
  --chart-2: 39 88% 62.6%; /* oklch(0.82 0.14 80) */
  --chart-3: 151 51% 57.3%; /* oklch(0.76 0.13 160) */
  --chart-4: 305 59% 72.4%; /* oklch(0.76 0.14 330) */
}
```
