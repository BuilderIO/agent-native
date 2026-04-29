# Design Generation

How to generate complete, interactive HTML prototypes using Alpine.js + Tailwind CSS (via CDN). This is the core skill for the design agent.

## Technology Stack

Every generated design uses:
- **Tailwind CSS v4** — via `@tailwindcss/browser@4` CDN (NOT the old v3 CDN)
- **Alpine.js 3.x** — via `alpinejs@3.15.11` CDN with `defer` attribute
- **Google Fonts** — for distinctive typography (never Inter/Roboto/Arial)
- **CSS Custom Properties** — for theming and tweaks panel integration

## Generation Workflow — the canonical 4-phase flow

This flow mirrors Claude Design's UX: ask → show variants → user picks → refine. Don't skip phases for new designs.

### Phase 1 — Create the project + ask before generating

```bash
pnpm action create-design --title "Project Name" --projectType prototype
pnpm action navigate --view editor --designId <returned-id>
```

Then, for any non-trivial first prompt, write `application-state/show-questions` BEFORE generating. The editor renders a full-canvas overlay; answers come back as a chat message. Skip the questions only when the prompt is unambiguous ("re-skin this with my brand colors") or the user said "decide for me".

```bash
# Write structured questions to the application_state table.
# (Use whatever app-state writer your shell has; design-generation typically
#  uses the framework's `db-exec` to upsert into application_state.)
```

### Phase 2 — Generate three side-by-side variations

For new designs, default to **three** variations. Write candidates to `application-state/design-variants`:

```json
{
  "designId": "<the design id>",
  "prompt": "Pick a direction",
  "variants": [
    { "id": "a", "label": "Editorial Serif", "content": "<!DOCTYPE html>...full self-contained HTML..." },
    { "id": "b", "label": "Bold Brutalist", "content": "<!DOCTYPE html>..." },
    { "id": "c", "label": "Soft & Spacious", "content": "<!DOCTYPE html>..." }
  ]
}
```

Each `content` is a complete, self-contained document (Alpine.js + Tailwind via CDN, full `<head>`, CSS variables in `:root`). Variations should be **stylistically/structurally distinct** — different typography schools, layout grammars, color moods — never just color swaps. Label them with concrete style names ("Editorial Serif", not "Variant A").

The framework persists the chosen content as `index.html` automatically when the user clicks "Use this one" — do NOT call `generate-design` while the picker is open.

### Phase 3 — Save with `generate-design` (when not using variants)

Skip variants and call `generate-design` directly for: refinements to an already-picked design, multi-screen additions to an existing design, or one-shot prompts where the direction is unambiguous.

```bash
pnpm action generate-design \
  --designId "<id>" \
  --prompt "Description of the design" \
  --files '[{"filename":"index.html","content":"<full HTML>","fileType":"html"}]' \
  --tweaks '[{"id":"accent","label":"Accent","type":"color-swatch","options":[...],"defaultValue":"#0EA5E9","cssVar":"--color-accent"}]'
```

### Phase 4 — Always ship tweaks with the design

`generate-design` accepts a `--tweaks` array — pass 3-6 of the most impactful knobs bound to CSS custom properties the design's `:root` block actually defines. Surface controls users will actually want to adjust (accent color, density, radius, dark-mode toggle, font choice). Don't ship a generic preset; let the design's structure pick the knobs.

## HTML Structure Requirements

### Mandatory Elements

Every `index.html` must include:

```html
<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><!-- Design title --></title>

  <!-- Tailwind v4 browser runtime -->
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>

  <!-- Alpine.js — MUST be deferred -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>

  <!-- Google Fonts — pick distinctive fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=...&display=swap" rel="stylesheet">

  <style>
    /* Required: hide elements until Alpine initializes */
    [x-cloak] { display: none !important; }

    /* Required: CSS custom properties for theming */
    :root {
      --color-primary: #0F172A;
      --color-accent: #0EA5E9;
      --color-surface: #1E293B;
      --color-text: #F8FAFC;
      --color-text-muted: #94A3B8;
      --font-heading: 'Space Grotesk', sans-serif;
      --font-body: 'DM Sans', sans-serif;
      --radius: 12px;
    }

    /* Base styles */
    body { font-family: var(--font-body); }
    h1, h2, h3, h4, h5, h6 {
      font-family: var(--font-heading);
      text-wrap: balance;
    }
    p { text-wrap: pretty; }
  </style>
</head>
<body class="bg-[var(--color-primary)] text-[var(--color-text)]">
  <!-- All interactive state goes on a root x-data -->
  <div x-data="{ /* component state */ }">
    <!-- Content -->
  </div>
</body>
</html>
```

### Alpine.js Patterns

**State management** — use `x-data` on the highest-level container:

```html
<div x-data="{
  currentPage: 'home',
  mobileNav: false,
  theme: 'dark',
  items: [
    { id: 1, title: 'Item 1', active: false },
    { id: 2, title: 'Item 2', active: true }
  ]
}">
```

**Conditional rendering** — use `x-show` with transitions (not `x-if` for simple toggles):

```html
<div x-show="mobileNav" x-cloak x-transition:enter="transition ease-out duration-200"
     x-transition:enter-start="opacity-0 -translate-y-2"
     x-transition:enter-end="opacity-100 translate-y-0"
     x-transition:leave="transition ease-in duration-150"
     x-transition:leave-start="opacity-100"
     x-transition:leave-end="opacity-0">
  <!-- Mobile nav content -->
</div>
```

**Lists** — always use `<template x-for>`:

```html
<template x-for="item in items" :key="item.id">
  <div class="p-4 rounded-lg bg-[var(--color-surface)]">
    <h3 x-text="item.title" class="font-semibold"></h3>
  </div>
</template>
```

**Two-way binding** — use `x-model` for form elements:

```html
<input x-model="searchQuery" type="text" placeholder="Search..."
       class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius)] px-4 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]">
```

**Click outside** — use `@click.outside`:

```html
<div x-show="dropdownOpen" @click.outside="dropdownOpen = false" x-cloak>
  <!-- Dropdown content -->
</div>
```

## Responsive Design Patterns

### Breakpoint Strategy

| Breakpoint | Width | Target |
| --- | --- | --- |
| (default) | < 640px | Mobile phones |
| `sm:` | >= 640px | Large phones / small tablets |
| `md:` | >= 768px | Tablets |
| `lg:` | >= 1024px | Laptops |
| `xl:` | >= 1280px | Desktops |
| `2xl:` | >= 1536px | Wide screens |

### Mobile-First Layout Patterns

```html
<!-- Stacked on mobile, side-by-side on desktop -->
<div class="flex flex-col lg:flex-row gap-6">
  <aside class="w-full lg:w-64 shrink-0"><!-- Sidebar --></aside>
  <main class="flex-1"><!-- Main content --></main>
</div>

<!-- 1 col -> 2 col -> 3 col grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- Cards -->
</div>

<!-- Hide on mobile, show on desktop -->
<div class="hidden md:block">Desktop-only content</div>
<div class="md:hidden">Mobile-only content</div>
```

### Mobile Navigation Pattern

```html
<nav class="fixed top-0 inset-x-0 z-50 border-b border-white/5 backdrop-blur-xl bg-[var(--color-primary)]/80">
  <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
    <a href="#" class="font-bold">Brand</a>

    <!-- Desktop nav -->
    <div class="hidden md:flex items-center gap-8">
      <a href="#" class="text-sm text-[var(--color-text-muted)]">Link</a>
      <a href="#" class="text-sm px-4 py-2 rounded-[var(--radius)] bg-[var(--color-accent)]">CTA</a>
    </div>

    <!-- Mobile hamburger -->
    <button @click="mobileNav = !mobileNav" class="md:hidden p-2 cursor-pointer" aria-label="Menu">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              :d="mobileNav ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'"/>
      </svg>
    </button>
  </div>

  <!-- Mobile menu -->
  <div x-show="mobileNav" x-cloak x-transition
       class="md:hidden border-t border-white/5 bg-[var(--color-primary)] px-6 py-4 space-y-3">
    <a href="#" class="block text-sm text-[var(--color-text-muted)]">Link</a>
  </div>
</nav>
```

## Common Component Patterns

### Stat Cards

```html
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <div class="p-4 rounded-[var(--radius)] bg-[var(--color-surface)] border border-white/5">
    <p class="text-xs text-[var(--color-text-muted)] mb-1">Label</p>
    <p class="text-2xl font-bold tracking-tight" style="font-family: var(--font-heading)">$12,345</p>
    <p class="text-xs text-emerald-400 mt-1">+12.5%</p>
  </div>
</div>
```

### Tab Navigation

```html
<div x-data="{ tab: 'overview' }">
  <div class="flex gap-1 border-b border-white/5 mb-6">
    <template x-for="t in ['overview', 'analytics', 'settings']" :key="t">
      <button @click="tab = t"
        :class="tab === t ? 'text-[var(--color-text)] border-[var(--color-accent)]' : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)]'"
        class="px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize cursor-pointer"
        x-text="t">
      </button>
    </template>
  </div>
  <div x-show="tab === 'overview'"><!-- Overview content --></div>
  <div x-show="tab === 'analytics'" x-cloak><!-- Analytics content --></div>
  <div x-show="tab === 'settings'" x-cloak><!-- Settings content --></div>
</div>
```

### Modal/Dialog

```html
<div x-data="{ modalOpen: false }">
  <button @click="modalOpen = true" class="cursor-pointer">Open</button>

  <!-- Backdrop + modal -->
  <div x-show="modalOpen" x-cloak class="fixed inset-0 z-50 flex items-center justify-center p-4"
       @keydown.escape.window="modalOpen = false">
    <div x-show="modalOpen" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0"
         x-transition:enter-end="opacity-100" x-transition:leave="transition ease-in duration-150"
         x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0"
         class="fixed inset-0 bg-black/60" @click="modalOpen = false"></div>
    <div x-show="modalOpen" x-transition:enter="transition ease-out duration-200"
         x-transition:enter-start="opacity-0 scale-95" x-transition:enter-end="opacity-100 scale-100"
         class="relative bg-[var(--color-surface)] rounded-[var(--radius)] border border-white/10 p-6 w-full max-w-md shadow-2xl">
      <h3 class="font-semibold mb-4" style="font-family: var(--font-heading)">Modal Title</h3>
      <p class="text-sm text-[var(--color-text-muted)] mb-6">Modal content goes here.</p>
      <div class="flex justify-end gap-3">
        <button @click="modalOpen = false" class="px-4 py-2 text-sm rounded-[var(--radius)] border border-white/10 cursor-pointer">Cancel</button>
        <button @click="modalOpen = false" class="px-4 py-2 text-sm rounded-[var(--radius)] bg-[var(--color-accent)] font-medium cursor-pointer">Confirm</button>
      </div>
    </div>
  </div>
</div>
```

### Toast/Notification

```html
<div x-data="{ show: false, message: '' }"
     @notify.window="message = $event.detail; show = true; setTimeout(() => show = false, 3000)">
  <div x-show="show" x-cloak
       x-transition:enter="transition ease-out duration-300 transform"
       x-transition:enter-start="opacity-0 translate-y-4"
       x-transition:enter-end="opacity-100 translate-y-0"
       x-transition:leave="transition ease-in duration-200"
       x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0"
       class="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-[var(--radius)] bg-[var(--color-surface)] border border-white/10 shadow-xl text-sm">
    <span x-text="message"></span>
  </div>
</div>
```

## Font Recommendations

Good distinctive font pairings (heading / body):

| Heading | Body | Mood |
| --- | --- | --- |
| Space Grotesk | DM Sans | Modern tech |
| Playfair Display | Source Sans 3 | Editorial luxury |
| Sora | Outfit | Clean geometric |
| Cabinet Grotesk | Satoshi | Contemporary startup |
| Fraunces | Work Sans | Warm editorial |
| JetBrains Mono | IBM Plex Sans | Developer tool |
| Clash Display | General Sans | Bold statement |
| Archivo | Nunito Sans | Friendly SaaS |

## What NOT to Do

- Never use `<script>` blocks with raw DOM manipulation — use Alpine.js directives
- Never inline `onclick="..."` handlers — use `@click`
- Never use `!important` except in `[x-cloak]`
- Never hardcode colors — always use CSS custom properties
- Never use position: fixed for modals — wrap in a portal-like pattern with Alpine.js
- Never forget `cursor-pointer` on interactive elements
- Never use `<img>` with placeholder URLs — use colored divs or gradients
- Never set font-size below 14px for body text or 12px for labels
