# Export and Handoff

How to export designs and generate handoff documentation for developers converting prototypes to production code.

## Export Formats

### HTML Export

Bundles all design files into a single standalone HTML file with Tailwind CSS and Alpine.js CDN included.

```bash
pnpm action export-html --id <designId>
```

Returns:
- `html` — the complete HTML string
- `filename` — suggested filename (e.g., `SaaS-Landing-Page-1714500000.html`)
- `filePath` — saved to `data/exports/`
- `fileCount` — number of source files bundled

The exported HTML:
- Includes `@tailwindcss/browser@4` and `alpinejs@3.15.11` CDN links
- Combines all CSS files into a single `<style>` block
- Combines all HTML/JSX files into the `<body>`
- Works when double-clicked in any modern browser

### ZIP Export

Creates a ZIP archive with all design files organized by type plus metadata.

```bash
pnpm action export-zip --id <designId>
```

Returns:
- `zipBase64` — base64-encoded ZIP data
- `filename` — suggested filename
- `filePath` — saved to `data/exports/`
- `fileCount` — number of files included

ZIP structure:
```
project-name/
  README.md           # Project metadata
  html/               # HTML files
    index.html
    components.html
  css/                # CSS files
    styles.css
  jsx/                # JSX files (if any)
  assets/             # Asset files
  design-data.json    # Generation metadata
```

### PDF Export

Prepares design data for client-side PDF rendering. Returns the raw design data and files — the actual PDF generation happens in the browser.

```bash
pnpm action export-pdf --id <designId>
```

Returns all design data and files needed for the client to render a PDF.

## Claude Code Handoff

When a user wants to convert an Alpine.js + Tailwind prototype into production code, generate a detailed handoff prompt. This is not an action — it is a structured message you compose based on the design.

### Handoff Prompt Template

```markdown
## Design Handoff: [Project Title]

### Design Tokens

```css
:root {
  --color-primary: [value];
  --color-accent: [value];
  --color-surface: [value];
  --color-text: [value];
  --color-text-muted: [value];
  --font-heading: [value];
  --font-body: [value];
  --radius: [value];
}
```

### Typography

- **Heading font**: [Font Name] (Google Fonts)
- **Body font**: [Font Name] (Google Fonts)
- **Heading sizes**: H1=[value], H2=[value], H3=[value]
- **Body size**: [value]
- **Weight**: Heading=[value], Body=[value]

### Color Palette

| Token | Value | Usage |
| --- | --- | --- |
| Primary | [hex] | Page background |
| Accent | [hex] | CTAs, active states |
| Surface | [hex] | Cards, panels |
| Text | [hex] | Primary text |
| Text Muted | [hex] | Secondary text |

### Interactive States

List all Alpine.js state variables and what they control:

- `mobileNav: boolean` — Mobile navigation toggle
- `activeTab: string` — Tab switching ("overview" | "analytics" | "settings")
- `filter: string` — Filter control ("all" | "design" | "code")
- `modalOpen: boolean` — Modal visibility

### Responsive Breakpoints

| Breakpoint | Width | Key Changes |
| --- | --- | --- |
| Mobile | < 640px | Stacked layout, hamburger menu |
| Tablet | >= 768px | 2-column grid, sidebar hidden |
| Desktop | >= 1024px | Full layout with sidebar |
| Wide | >= 1280px | Expanded content area |

### Component Inventory

List every distinct component in the design:

1. **Navigation** — Fixed header with desktop links + mobile hamburger
2. **Hero Section** — Full-width, centered text, dual CTAs
3. **Feature Card** — Icon + title + description in a surface card
4. **Stat Card** — Metric value + change indicator
5. **Data Table** — Header + rows with status badges
6. **Footer** — Links + copyright

### Accessibility Notes

- All interactive elements have `cursor-pointer`
- Mobile touch targets >= 44x44px
- Color contrast meets WCAG AA
- Semantic HTML structure (nav, main, section, footer)
- ARIA labels on icon-only buttons

### Source Files

The prototype HTML is available via:
```bash
pnpm action export-html --id [designId]
```
```

### Generating the Handoff

When the user asks to "hand off" or "convert to production code":

1. Read the design: `get-design --id <designId>`
2. Extract all CSS custom properties from the HTML
3. Identify all Alpine.js state variables and their purposes
4. List all interactive components and their behaviors
5. Note responsive breakpoints and layout changes
6. Compose the handoff prompt using the template above
7. Optionally export the HTML: `export-html --id <designId>`

### Framework-Specific Recommendations

Include recommendations for the target framework:

**React / Next.js:**
- Replace `x-data` state with `useState` or Zustand
- Replace `x-show` with conditional rendering (`{condition && <Component />}`)
- Replace `x-for` with `.map()`
- Replace `@click` with `onClick`
- Replace CSS custom properties with CSS Modules or Tailwind config
- Replace Google Fonts CDN with `next/font`

**Vue:**
- Replace `x-data` with `ref()` / `reactive()` in `<script setup>`
- Replace `x-show` with `v-show`
- Replace `x-for` with `v-for`
- Replace `@click` stays the same (`@click`)
- Alpine.js and Vue share similar template syntax

**Svelte:**
- Replace `x-data` with `let` declarations
- Replace `x-show` with `{#if}` blocks
- Replace `x-for` with `{#each}` blocks
- Replace `@click` with `on:click`

## Duplicate for Iteration

Before exporting or handing off, the user may want to duplicate the design for further iteration:

```bash
pnpm action duplicate-design --id <designId> --title "Landing Page v2"
```

This creates a deep copy with new IDs for the design and all its files. The original stays untouched.
