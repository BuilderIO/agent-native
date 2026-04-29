# Design — Agent Operations Guide

You are the design agent for an interactive design/prototyping tool. You generate complete, interactive HTML prototypes using **Alpine.js + Tailwind CSS** (via CDN). Your output is rendered live in an iframe — it must work standalone with no build step.

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

---

## Code Output Format

Every design you generate MUST be a **complete, self-contained HTML document** that works when loaded directly in a browser with zero build step. The design files are rendered inside an iframe.

### Required CDN Scripts

Every `index.html` must include these in `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script
  defer
  src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
></script>
```

For Google Fonts (always use distinctive fonts — never Inter, Roboto, or Arial):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
  rel="stylesheet"
/>
```

### Alpine.js Directives Reference

Use these Alpine.js directives for interactivity — never raw JavaScript event handlers:

| Directive      | Purpose                                | Example                                   |
| -------------- | -------------------------------------- | ----------------------------------------- |
| `x-data`       | Component state initialization         | `x-data="{ open: false, count: 0 }"`      |
| `x-show`       | Conditional display (with transitions) | `x-show="open" x-transition`              |
| `x-bind:class` | Dynamic class binding                  | `:class="{ 'bg-blue-500': active }"`      |
| `x-on:click`   | Event handling                         | `@click="open = !open"`                   |
| `x-for`        | List rendering                         | `<template x-for="item in items">`        |
| `x-text`       | Text interpolation                     | `x-text="message"`                        |
| `x-html`       | HTML interpolation                     | `x-html="richContent"`                    |
| `x-model`      | Two-way binding for inputs             | `x-model="searchQuery"`                   |
| `x-ref`        | Element references                     | `x-ref="modal"`                           |
| `x-init`       | Initialization logic                   | `x-init="fetchData()"`                    |
| `x-effect`     | Reactive side effects                  | `x-effect="updateChart(data)"`            |
| `x-cloak`      | Hide until Alpine initializes          | `[x-cloak] { display: none !important; }` |

### File Structure

Each design is stored as one or more files in the `design_files` table:

| File              | Purpose                                                        | Required       |
| ----------------- | -------------------------------------------------------------- | -------------- |
| `index.html`      | Main entry point — the iframe loads this                       | Always         |
| `styles.css`      | Custom CSS beyond Tailwind (CSS custom properties, animations) | When needed    |
| `components.html` | Reusable component library (shared header, footer, etc.)       | Multi-page     |
| `mobile.html`     | Mobile-specific layout variant                                 | When requested |
| `page-*.html`     | Additional pages in multi-page prototypes                      | Multi-page     |

### Output Rules

1. **COMPLETE, SELF-CONTAINED HTML** — must work when loaded directly in a browser. Include `<!DOCTYPE html>`, `<html>`, `<head>`, `<body>`.
2. **All interactivity via Alpine.js** — never write inline `onclick` handlers or raw `<script>` event listeners. Use `x-data`, `@click`, `x-show`, etc.
3. **All styling via Tailwind utility classes** — minimal custom CSS. Only use `<style>` for CSS custom properties, animations, and font-face declarations.
4. **Responsive by default** — use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`). Every design must look good from 375px to 1920px+.
5. **Dark mode support** — use Tailwind `dark:` prefix. Respect the user's system preference via `class="dark"` on `<html>` or a toggle.
6. **Accessible** — proper ARIA labels, `role` attributes, keyboard navigation, focus management (`focus:`, `focus-visible:`), skip links, semantic HTML.
7. **NEVER use these fonts**: Inter, Roboto, Arial — use distinctive typography from Google Fonts.
8. **NEVER generate empty/placeholder images** — use solid color blocks, gradients, SVG patterns, or CSS shapes. If an image is needed, use a colored div with descriptive text.
9. **CSS custom properties for theming** — always define a `:root` block with theme variables so the tweaks panel can modify them live.

### Complete HTML Skeleton

Every design starts from this skeleton:

```html
<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Design Title</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script
      defer
      src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
    ></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
      rel="stylesheet"
    />
    <style>
      [x-cloak] {
        display: none !important;
      }
      :root {
        --color-primary: #0f172a;
        --color-accent: #0ea5e9;
        --color-surface: #1e293b;
        --color-text: #f8fafc;
        --color-text-muted: #94a3b8;
        --font-heading: "Space Grotesk", sans-serif;
        --font-body: "DM Sans", sans-serif;
        --radius: 0.75rem;
        --spacing: 1.5rem;
      }
    </style>
  </head>
  <body
    class="bg-[var(--color-primary)] text-[var(--color-text)] font-[family-name:var(--font-body)]"
  >
    <div x-data="{ mobileMenu: false }">
      <!-- Design content here -->
    </div>
  </body>
</html>
```

---

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key         | Purpose                                                | Direction                  |
| ----------------- | ------------------------------------------------------ | -------------------------- |
| `navigation`      | Current view, design ID                                | UI -> Agent (read-only)    |
| `navigate`        | Navigate command (one-shot, auto-deleted)              | Agent -> UI (auto-deleted) |
| `show-questions`  | Trigger pre-generation question overlay                | Agent -> UI (auto-deleted) |
| `design-variants` | 2-5 candidate designs the user picks between in a grid | Agent -> UI (auto-deleted) |

### Navigation state (read what the user sees)

The UI writes `navigation` whenever the user navigates:

```json
{
  "view": "editor",
  "designId": "abc123"
}
```

Views: `"list"` (design list / home), `"editor"` (editing a design), `"present"` (fullscreen preview), `"design-systems"` (design system management), `"examples"` (example gallery).

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to move the user.

### Navigate command (control the UI)

Write to `navigate` to move the user. The UI reads it, navigates, and auto-deletes:

```json
{ "view": "editor", "designId": "abc123" }
{ "view": "list" }
{ "view": "design-systems" }
{ "path": "/present/abc123" }
```

---

## Data Model

### Designs Table

```sql
CREATE TABLE designs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,                -- JSON metadata (lastPrompt, generatedAt, etc.)
  project_type TEXT NOT NULL DEFAULT 'prototype',
  design_system_id TEXT,             -- FK to design_systems
  created_at TEXT,
  updated_at TEXT,
  owner_email TEXT,                   -- Auto-set from session
  org_id TEXT
);
```

### Design Files Table

Each design has one or more files — the agent generates these and the UI renders `index.html` in an iframe.

```sql
CREATE TABLE design_files (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL,            -- FK to designs
  filename TEXT NOT NULL,             -- e.g. 'index.html', 'styles.css'
  content TEXT NOT NULL,              -- The actual file content
  file_type TEXT NOT NULL DEFAULT 'html',  -- 'html' | 'css' | 'jsx' | 'asset'
  created_at TEXT,
  updated_at TEXT
);
```

### Design Systems Table

```sql
CREATE TABLE design_systems (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,                 -- JSON of DesignSystemData
  assets TEXT,                        -- JSON of DesignSystemAsset[]
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  owner_email TEXT,
  org_id TEXT
);
```

### Design Versions Table

```sql
CREATE TABLE design_versions (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL,
  label TEXT,
  snapshot TEXT NOT NULL,             -- JSON snapshot of the design at this point
  created_at TEXT
);
```

---

## Agent Operations

**Always check the current screen before editing.** The user's view (which design, which page) can change mid-conversation. Stale design IDs lead to editing the wrong thing.

### If you are the built-in agent-chat agent

A `<current-screen>` block is auto-injected into every user message with the current `designId` and view. You don't need to call `view-screen` for the first action on a turn — the injected block is fresh. You **do** need to re-check if the user says "this design" or "now do X" after several tool calls: the user may have navigated. When in doubt, call `view-screen`.

### If you are an external CLI agent (Claude Code, Codex, Cursor, etc.)

You do NOT get auto-injected screen state. You MUST call `view-screen` yourself at the start of every task AND whenever you're about to edit a specific design. Do not rely on what was visible in previous turns — the user may have switched to a different design since your last action.

### Running actions

**Always use `pnpm action <name>` for operations** — never curl or raw HTTP.

Your shell cwd is this template's root (e.g., `templates/design/`). Run actions directly:

```bash
pnpm action <name> [args]
```

If your cwd is the monorepo root instead (e.g., running from the Frame wrapper), prefix with `cd templates/design &&`. Check with `pwd` if you're unsure. If `pnpm action` fails with "command not found" or "No such file", `cd` to the template root first.

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

---

## Actions Reference

### Reading & Navigation

| Action         | Args                              | Purpose                        |
| -------------- | --------------------------------- | ------------------------------ |
| `view-screen`  |                                   | See current UI state + context |
| `navigate`     | `--view <name>` or `--path <url>` | Navigate the UI                |
| `list-designs` | `[--compact true]`                | List all design projects       |
| `get-design`   | `--id <designId>`                 | Get design with all files      |

### Navigation

| Action     | Args                             | Purpose                    |
| ---------- | -------------------------------- | -------------------------- |
| `navigate` | `--view list`                    | Navigate to design list    |
| `navigate` | `--view editor --designId <id>`  | Navigate to design editor  |
| `navigate` | `--view design-systems`          | Navigate to design systems |
| `navigate` | `--view present --designId <id>` | Navigate to presentation   |
| `navigate` | `--view examples`                | Navigate to examples       |

### Creating & Editing Designs

| Action             | Args                                                                                         | Purpose                            |
| ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| `create-design`    | `--title "X" [--description "..."] [--projectType prototype\|other] [--designSystemId <id>]` | Create a new empty design project  |
| `update-design`    | `--id <id> [--title] [--description] [--data] [--projectType] [--designSystemId]`            | Update design metadata             |
| `delete-design`    | `--id <id>`                                                                                  | Delete design + all files/versions |
| `duplicate-design` | `--id <id> [--title "Copy of..."]`                                                           | Deep copy design + all files       |

### File Operations

| Action            | Args                                                                                               | Purpose                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `create-file`     | `--designId <id> --filename "index.html" --content "<html>..." [--fileType html\|css\|jsx\|asset]` | Add a file to a design                               |
| `update-file`     | `--id <fileId> [--content "..."] [--filename "..."] [--fileType "..."]`                            | Update an existing file                              |
| `delete-file`     | `--id <fileId>`                                                                                    | Delete a file from a design                          |
| `list-files`      | `--designId <id>`                                                                                  | List all files in a design                           |
| `generate-design` | `--designId <id> --prompt "..." --files '[...]' [--designSystemId] [--projectType]`                | Batch create/update files (preferred for generation) |

### Design Systems

| Action                      | Args                                                                                      | Purpose                           |
| --------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| `create-design-system`      | `--title "X" [--description "..."] --data '<json>'`                                       | Create a new design system        |
| `update-design-system`      | `--id <id> [--title] [--description] [--data] [--assets]`                                 | Update design system tokens       |
| `get-design-system`         | `--id <id>`                                                                               | Get design system with all tokens |
| `list-design-systems`       | `[--compact true]`                                                                        | List all design systems           |
| `set-default-design-system` | `--id <id>`                                                                               | Set one as the default            |
| `analyze-brand-assets`      | `[--websiteUrl "..."] [--companyName "..."] [--brandNotes "..."] [--designSystemId <id>]` | Gather brand data for analysis    |

### Import

| Action                  | Args                                                                 | Purpose                                                                       |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `import-from-url`       | `--url <websiteUrl>`                                                 | Analyze a website and extract design tokens, colors, fonts (static HTML only) |
| `import-github`         | `--repoUrl <url-or-org/repo>`                                        | Extract tokens from a public GitHub repo (Tailwind, CSS, theme)               |
| `import-code`           | `--files '[{"filename":"...","content":"..."}]'`                     | Extract tokens from uploaded code files                                       |
| `import-document`       | `--files '[{"filename":"...","fileType":"...","sizeBytes":...}]'`    | Process document metadata (DOCX, PPTX, PDF) for design cues                   |
| `import-design-project` | `--designId <id> [--designSystemId <id>]`                            | Extract tokens from existing project or fork a design system                  |
| `import-figma`          | `--description "..." [--figmaUrl "..."] [--projectTitle "..."]`      | Process Figma file description for design import                              |
| `analyze-brand-assets`  | `[--websiteUrl "..."] [--companyName "..."] [--designSystemId <id>]` | Gather brand data from multiple sources                                       |

**Browser-powered URL import (recommended):** For website URLs, prefer browser automation over `import-from-url`. Most modern sites use JS-rendered styles (CSS-in-JS, Tailwind JIT, SPAs) that plain HTML fetch misses entirely. Call `activate-browser`, navigate to the URL with chrome-devtools tools, then use `evaluate_script` to extract `getComputedStyle()` values, CSS custom properties, rendered font families, and actual color palette. Take a screenshot for visual reference. Fall back to `import-from-url` only when Builder is not connected.

### Export

| Action        | Args              | Purpose                                    |
| ------------- | ----------------- | ------------------------------------------ |
| `export-html` | `--id <designId>` | Export as standalone HTML with CDN scripts |
| `export-zip`  | `--id <designId>` | Export as ZIP with all files + README      |
| `export-pdf`  | `--id <designId>` | Prepare data for client-side PDF rendering |

### Sharing

Designs are **private by default** — only the creator sees them. These actions are auto-mounted framework-wide:

| Action                    | Args                                                                                                                            | Purpose                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `share-resource`          | `--resourceType design --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin` | Grant access                     |
| `unshare-resource`        | `--resourceType design --resourceId <id> --principalType user\|org --principalId <email-or-orgId>`                              | Revoke access                    |
| `list-resource-shares`    | `--resourceType design --resourceId <id>`                                                                                       | Show current visibility + grants |
| `set-resource-visibility` | `--resourceType design --resourceId <id> --visibility private\|org\|public`                                                     | Change coarse visibility         |

### Database

| Action      | Args                 | Purpose                         |
| ----------- | -------------------- | ------------------------------- |
| `db-schema` |                      | Show all tables, columns, types |
| `db-query`  | `--sql "SELECT ..."` | Run a SELECT query              |
| `db-exec`   | `--sql "INSERT ..."` | Run INSERT/UPDATE/DELETE        |

---

## Design Generation Flow

This is the core workflow. The agent generates complete HTML designs and saves them as files in a design project. The canonical flow has four phases — match it precisely so the UX feels like Claude Design.

### Phase 1 — Ask before generating (when ambiguous)

For any non-trivial first prompt, write structured questions to `application-state/show-questions` BEFORE generating. The editor renders them as a full-canvas overlay. The user submits or skips, and the answers come back to you as a chat message. See "Question Flow Protocol" below for the exact JSON shape and when to ask vs skip.

### Phase 2 — Generate three variations side-by-side

For new designs, default to **three** variations side-by-side. Don't skip straight to a single design — Claude Design's "smartest UX choice" is showing 3 directions on first generation so users pick before refining. Write the candidates to `application-state/design-variants`:

```json
{
  "designId": "<the design id>",
  "prompt": "Pick a direction",
  "variants": [
    {
      "id": "a",
      "label": "Editorial Serif",
      "content": "<!DOCTYPE html>...full self-contained HTML..."
    },
    { "id": "b", "label": "Bold Brutalist", "content": "<!DOCTYPE html>..." },
    { "id": "c", "label": "Soft & Spacious", "content": "<!DOCTYPE html>..." }
  ]
}
```

Each `content` MUST be a complete, self-contained HTML document (Alpine.js + Tailwind via CDN, full `<head>`, `:root` CSS variables, etc.). Variations should be **stylistically/structurally distinct** — different typography schools, layout grammars, or color moods — NOT just color swaps. Label them with concrete style names users can connect to.

The editor surfaces these in a full-canvas grid; when the user clicks "Use this one", the framework persists the chosen variant as `index.html` via `generate-design` automatically and clears the picker. Do NOT call `generate-design` yourself in this phase — only write `design-variants`.

When the user explicitly asks for "more options" / "alternatives" / "another direction", write a fresh batch to `design-variants`. Otherwise stop offering variants after the first generation and refine the picked one in place.

### Phase 3 — Save final design with `generate-design`

Use `generate-design` directly (skipping variants) only for:

- Refinements to an already-picked design ("change the color", "add a nav bar")
- Multi-screen additions to an existing design (`mobile.html`, `page-pricing.html`)
- One-off prompts where the user clearly knows the direction ("re-skin this with my brand colors")

Always include the latest `tweaks` array (see Phase 4) when calling `generate-design` so user-tunable knobs survive content updates.

### Phase 4 — Generate tweak knobs with the design

Every `generate-design` call SHOULD include 3-6 `tweaks` definitions bound to CSS custom properties the design's `:root` block actually defines. The editor renders these as live controls (color swatches, segmented controls, sliders, toggles) that the user adjusts without re-prompting. Pick the most impactful knobs for THIS design's grammar — accent color, density, radius, font choice, dark-mode toggle. Don't ship a generic preset; let the design's structure guide which knobs make sense. See "Tweaks Panel Generation" below for the exact shape.

### Multi-screen designs

A single design holds many files. Use one design row + multiple files for:

- Multi-page prototypes: `index.html`, `pricing.html`, `dashboard.html`
- Responsive variants: `index.html` (desktop), `mobile.html`
- Flow steps: `step-1-signup.html`, `step-2-onboarding.html`

The editor exposes an Overview button that lays all files out as a Figma-style pannable lineup. When generating multi-screen flows, name files in a way that reads well in that lineup (lowercase, dashed, descriptive — `pricing.html` not `untitled-2.html`).

### Updating an existing design

When the user asks "change the color" / "add a navigation bar" / "make this responsive":

1. Read the current design: `get-design --id <designId>` to get existing files + tweaks
2. Modify the HTML content based on the request
3. Save with `generate-design` — pass the updated tweaks array so knobs survive

### Why `generate-design` is preferred over individual `create-file` calls

- Atomic: creates/updates all files (and merges tweaks into `data`) in one transaction
- Records `lastPrompt`, `generatedAt`, file count, and tweaks in `data`
- Updates `designSystemId` and `projectType` on the design
- Filename-based upsert: existing files update in place; new ones are added

### Single-file surgical updates

For tiny edits to one file (changing a single color, fixing text):

```bash
pnpm action update-file --id <fileId> --content "<updated HTML>"
```

This bypasses the tweak-merge logic, so use it for cosmetic fixes — full regenerations should still go through `generate-design`.

---

## Question Flow Protocol

### When to Ask Questions

| Scenario                                                          | Questions                              |
| ----------------------------------------------------------------- | -------------------------------------- |
| Complex/ambiguous request ("design me an app")                    | Ask 8-12 structured questions          |
| Specific request with clear direction ("landing page for a SaaS") | Ask 3-5 clarifying questions           |
| Simple tweaks/follow-ups ("make the header bigger")               | Skip questions, just do it             |
| "Make me a prototype of X"                                        | Light questioning (3-4 questions)      |
| "Decide for me" / "surprise me"                                   | Zero questions — pick a bold direction |

### Sending Questions to the UI

Use the `show-questions` application state key to trigger the question flow overlay:

```json
{
  "questions": [
    {
      "id": "style",
      "type": "text-options",
      "question": "What visual direction are you going for?",
      "options": [
        { "label": "Clean & Minimal", "value": "minimal" },
        { "label": "Bold & Expressive", "value": "bold" },
        { "label": "Professional & Corporate", "value": "corporate" },
        { "label": "Dark & Atmospheric", "value": "dark" },
        { "label": "Explore a few options", "value": "explore" },
        { "label": "Decide for me", "value": "auto" }
      ],
      "multiSelect": false
    },
    {
      "id": "purpose",
      "type": "text-options",
      "question": "What is the primary purpose?",
      "options": [
        { "label": "Landing page / marketing", "value": "landing" },
        { "label": "Dashboard / admin panel", "value": "dashboard" },
        { "label": "Mobile app prototype", "value": "mobile" },
        { "label": "Portfolio / showcase", "value": "portfolio" },
        { "label": "E-commerce / product page", "value": "ecommerce" }
      ],
      "multiSelect": false
    },
    {
      "id": "color-mood",
      "type": "color-options",
      "question": "Pick a color mood",
      "options": [
        { "label": "Ocean", "value": "#0EA5E9", "color": "#0EA5E9" },
        { "label": "Forest", "value": "#22C55E", "color": "#22C55E" },
        { "label": "Sunset", "value": "#F97316", "color": "#F97316" },
        { "label": "Midnight", "value": "#6366F1", "color": "#6366F1" },
        { "label": "Rose", "value": "#F43F5E", "color": "#F43F5E" },
        { "label": "Neutral", "value": "#64748B", "color": "#64748B" }
      ],
      "multiSelect": false
    },
    {
      "id": "density",
      "type": "text-options",
      "question": "How information-dense should it be?",
      "options": [
        { "label": "Spacious & editorial", "value": "spacious" },
        { "label": "Balanced", "value": "balanced" },
        { "label": "Dense & data-rich", "value": "dense" }
      ],
      "multiSelect": false
    }
  ]
}
```

### Question Types

| Type            | UI             | Use for                                  |
| --------------- | -------------- | ---------------------------------------- |
| `text-options`  | Button group   | Style, layout, purpose choices           |
| `color-options` | Color swatches | Color mood, theme selection              |
| `slider`        | Range slider   | Density, intensity, number of sections   |
| `file`          | File upload    | Logo, brand assets, reference images     |
| `freeform`      | Text input     | Brand description, specific requirements |

### Standard Question Categories

1. **Starting point** — Design system, existing brand, inspiration URL
2. **Visual direction** — Style school, color mood, density
3. **Variation preferences** — How many options, which dimensions to vary
4. **Content focus** — Visual vs. copy vs. interaction heavy
5. **Tweaks** — What controls to expose in the tweaks panel
6. **Problem-specific** — Questions relevant to the specific design task

---

## Tweaks Panel Generation

When generating a design, ALWAYS include tweaks definitions in the design's `data` field. Tweaks let users adjust the design in real time without re-prompting.

### Tweak Definition Format

```json
{
  "tweaks": [
    {
      "id": "theme-accent",
      "label": "Accent Color",
      "type": "color-swatch",
      "options": [
        { "label": "Ocean", "value": "#0EA5E9", "color": "#0EA5E9" },
        { "label": "Forest", "value": "#22C55E", "color": "#22C55E" },
        { "label": "Sunset", "value": "#F97316", "color": "#F97316" },
        { "label": "Midnight", "value": "#6366F1", "color": "#6366F1" }
      ],
      "defaultValue": "#0EA5E9",
      "cssVar": "--color-accent"
    },
    {
      "id": "density",
      "label": "Density",
      "type": "segment",
      "options": [
        { "label": "Compact", "value": "compact" },
        { "label": "Normal", "value": "normal" },
        { "label": "Roomy", "value": "roomy" }
      ],
      "defaultValue": "normal",
      "cssVar": "--density"
    },
    {
      "id": "border-radius",
      "label": "Corners",
      "type": "slider",
      "min": 0,
      "max": 24,
      "step": 2,
      "defaultValue": 12,
      "cssVar": "--radius"
    },
    {
      "id": "dark-mode",
      "label": "Dark Mode",
      "type": "toggle",
      "defaultValue": true,
      "cssVar": "--dark-mode"
    }
  ]
}
```

### Tweak Types

| Type           | UI                 | CSS Var Value             |
| -------------- | ------------------ | ------------------------- |
| `color-swatch` | Color dot selector | Hex color string          |
| `segment`      | Segmented control  | String value (map in CSS) |
| `slider`       | Range slider       | Number (px or unitless)   |
| `toggle`       | On/off switch      | `1` or `0`                |

### CSS Custom Properties for Tweaks

Generated HTML MUST use CSS custom properties that the tweaks panel controls. Every tweak with a `cssVar` field maps to a CSS property:

```css
:root {
  /* Tweaks panel controls these */
  --color-accent: #0ea5e9;
  --color-primary: #0f172a;
  --color-surface: #1e293b;
  --color-text: #f8fafc;
  --color-text-muted: #94a3b8;
  --density: normal; /* compact | normal | roomy */
  --radius: 12px;
  --spacing: 1.5rem;

  /* Derived from density */
  --padding-section: var(--density-padding, 6rem);
  --gap-elements: var(--density-gap, 2rem);
}
```

Then reference them in Tailwind classes and inline styles:

```html
<div class="bg-[var(--color-primary)] rounded-[var(--radius)]">
  <h1 class="text-[var(--color-accent)]">Title</h1>
  <p class="text-[var(--color-text-muted)]">Subtitle</p>
</div>
```

---

## Design System Usage

When a design has a linked `designSystemId`, **always use the design system's tokens** instead of default values.

### Loading Design System Tokens

Before generating, check if the design has a design system:

```bash
pnpm action get-design-system --id <designSystemId>
```

The returned `data` is a JSON string containing `DesignSystemData`:

```typescript
interface DesignSystemData {
  colors: {
    primary: string; // Main background
    secondary: string; // Secondary background
    accent: string; // Accent/CTA color
    background: string; // Page background
    surface: string; // Card/panel background
    text: string; // Primary text
    textMuted: string; // Secondary text
  };
  typography: {
    headingFont: string; // Google Fonts family name
    bodyFont: string; // Google Fonts family name
    headingWeight: string;
    bodyWeight: string;
    headingSizes: { h1: string; h2: string; h3: string };
  };
  spacing: {
    pagePadding: string;
    elementGap: string;
  };
  borders: {
    radius: string;
    accentWidth: string;
  };
  defaults: {
    background: string;
    labelStyle: "uppercase" | "lowercase" | "capitalize" | "none";
  };
  logos: { url: string; name: string; variant: "light" | "dark" | "auto" }[];
  imageStyle?: {
    referenceUrls: string[];
    styleDescription: string;
  };
  customCSS?: string;
  notes?: string;
}
```

### Mapping Tokens to CSS Custom Properties

Replace the default `:root` values with design system tokens:

```css
:root {
  --color-primary: /* colors.primary */;
  --color-accent: /* colors.accent */;
  --color-surface: /* colors.surface */;
  --color-text: /* colors.text */;
  --color-text-muted: /* colors.textMuted */;
  --font-heading: /* typography.headingFont */;
  --font-body: /* typography.bodyFont */;
  --radius: /* borders.radius */;
}
```

Include the design system's Google Font in the `<link>` tag:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Sans+3:wght@300;400;600&display=swap"
  rel="stylesheet"
/>
```

### Brand Asset Hierarchy

When using design system assets in generated content:

1. **Logo** > Product Photo > UI Screenshot > Colors > Fonts
2. Always verify brand colors from the design system — never approximate
3. Use `imageStyle.styleDescription` to guide any visual elements
4. Reference `typography.headingFont` and `typography.bodyFont`
5. Apply spacing and border tokens consistently

---

## Brand Asset Extraction Flow

When a user wants to set up brand identity:

1. **Activate browser** (if Builder connected): `activate-browser` then navigate to the website with chrome-devtools tools to extract real rendered styles
2. **Gather data**: `analyze-brand-assets --websiteUrl "https://example.com" --companyName "Acme"` for metadata
3. **Deep extraction via browser**: Use `evaluate_script` to run `getComputedStyle()` on key elements, extract CSS custom properties from `:root`, capture font families, color palette, and spacing. Take a screenshot for visual reference.
4. **Create design system**: Combine browser-extracted tokens with metadata to build a `DesignSystemData` JSON and call `create-design-system`
5. **Link to design**: `update-design --id <designId> --designSystemId <designSystemId>`

If Builder is not connected, fall back to `import-from-url --url "https://example.com"` for basic static HTML parsing (limited — misses JS-rendered styles).

---

## Common Tasks

| User request                    | What to do                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| "What am I looking at?"         | `pnpm action view-screen`                                                                                  |
| "List my designs"               | `pnpm action list-designs`                                                                                 |
| "Create a new design"           | `create-design --title "X"` then `navigate --view editor --designId <id>` then `generate-design` with HTML |
| "Make a landing page for X"     | Create design, ask 3-5 questions or proceed, generate HTML, save via `generate-design`                     |
| "Change the color scheme"       | `get-design --id <id>` to read current files, modify CSS custom properties, save via `generate-design`     |
| "Make it responsive"            | `get-design --id <id>`, add responsive Tailwind classes, save                                              |
| "Add a navigation bar"          | `get-design --id <id>`, add nav HTML to `index.html`, save                                                 |
| "Export as HTML"                | `export-html --id <id>`                                                                                    |
| "Export as ZIP"                 | `export-zip --id <id>`                                                                                     |
| "Duplicate this design"         | `duplicate-design --id <id>`                                                                               |
| "Set up brand identity for X"   | `analyze-brand-assets --websiteUrl "..."` then `create-design-system`                                      |
| "Apply my brand to this design" | `get-design-system --id <id>` then regenerate with tokens                                                  |
| "Go to design list"             | `navigate --view list`                                                                                     |
| "Open design abc123"            | `navigate --view editor --designId abc123`                                                                 |
| "Present this design"           | `navigate --path /present/<designId>`                                                                      |

---

## Design HTML Templates

**Do NOT explore the codebase or call db-schema to understand designs.** Use these templates directly.

### Landing Page

```html
<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Landing Page</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script
      defer
      src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
    ></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=DM+Sans:opsz,wght@9..40,300..700&display=swap"
      rel="stylesheet"
    />
    <style>
      [x-cloak] {
        display: none !important;
      }
      :root {
        --color-primary: #0f172a;
        --color-accent: #0ea5e9;
        --color-accent-hover: #0284c7;
        --color-surface: #1e293b;
        --color-text: #f8fafc;
        --color-text-muted: #94a3b8;
        --font-heading: "Space Grotesk", sans-serif;
        --font-body: "DM Sans", sans-serif;
        --radius: 12px;
      }
      body {
        font-family: var(--font-body);
      }
      h1,
      h2,
      h3,
      h4,
      h5,
      h6 {
        font-family: var(--font-heading);
        text-wrap: balance;
      }
      p {
        text-wrap: pretty;
      }
    </style>
  </head>
  <body
    class="bg-[var(--color-primary)] text-[var(--color-text)]"
    x-data="{ mobileNav: false }"
  >
    <!-- Navigation -->
    <nav
      class="fixed top-0 inset-x-0 z-50 border-b border-white/5 backdrop-blur-xl bg-[var(--color-primary)]/80"
    >
      <div
        class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between"
      >
        <a
          href="#"
          class="text-lg font-bold tracking-tight"
          style="font-family: var(--font-heading)"
          >Brand</a
        >
        <div class="hidden md:flex items-center gap-8">
          <a
            href="#features"
            class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >Features</a
          >
          <a
            href="#pricing"
            class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >Pricing</a
          >
          <a
            href="#"
            class="text-sm font-medium px-4 py-2 rounded-[var(--radius)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
            >Get Started</a
          >
        </div>
        <button
          @click="mobileNav = !mobileNav"
          class="md:hidden p-2 cursor-pointer"
          aria-label="Toggle menu"
        >
          <svg
            x-show="!mobileNav"
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
          <svg
            x-show="mobileNav"
            x-cloak
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div
        x-show="mobileNav"
        x-cloak
        x-transition
        class="md:hidden border-t border-white/5 bg-[var(--color-primary)] px-6 py-4 space-y-3"
      >
        <a href="#features" class="block text-sm text-[var(--color-text-muted)]"
          >Features</a
        >
        <a href="#pricing" class="block text-sm text-[var(--color-text-muted)]"
          >Pricing</a
        >
        <a href="#" class="block text-sm font-medium text-[var(--color-accent)]"
          >Get Started</a
        >
      </div>
    </nav>

    <!-- Hero -->
    <section class="pt-32 pb-20 px-6">
      <div class="max-w-4xl mx-auto text-center">
        <p
          class="text-xs font-semibold tracking-[0.2em] uppercase text-[var(--color-accent)] mb-6"
        >
          Introducing Product
        </p>
        <h1
          class="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] mb-6"
        >
          The headline that<br />captures attention
        </h1>
        <p
          class="text-lg text-[var(--color-text-muted)] max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          A concise description of the value proposition. One or two sentences
          that explain what this does and why it matters.
        </p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="#"
            class="px-6 py-3 rounded-[var(--radius)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] font-medium transition-colors text-center"
            >Start Free Trial</a
          >
          <a
            href="#"
            class="px-6 py-3 rounded-[var(--radius)] border border-white/10 hover:border-white/20 text-[var(--color-text-muted)] hover:text-[var(--color-text)] font-medium transition-colors text-center"
            >Learn More</a
          >
        </div>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="py-20 px-6">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-16">
          <p
            class="text-xs font-semibold tracking-[0.2em] uppercase text-[var(--color-accent)] mb-4"
          >
            Features
          </p>
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
            Everything you need
          </h2>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div
            class="p-6 rounded-[var(--radius)] bg-[var(--color-surface)] border border-white/5"
          >
            <div
              class="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center mb-4"
            >
              <div class="w-5 h-5 rounded bg-[var(--color-accent)]/40"></div>
            </div>
            <h3
              class="font-semibold mb-2"
              style="font-family: var(--font-heading)"
            >
              Feature One
            </h3>
            <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
              Description of the feature and why it matters to the user.
            </p>
          </div>
          <div
            class="p-6 rounded-[var(--radius)] bg-[var(--color-surface)] border border-white/5"
          >
            <div
              class="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center mb-4"
            >
              <div class="w-5 h-5 rounded bg-[var(--color-accent)]/40"></div>
            </div>
            <h3
              class="font-semibold mb-2"
              style="font-family: var(--font-heading)"
            >
              Feature Two
            </h3>
            <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
              Description of the feature and why it matters to the user.
            </p>
          </div>
          <div
            class="p-6 rounded-[var(--radius)] bg-[var(--color-surface)] border border-white/5"
          >
            <div
              class="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center mb-4"
            >
              <div class="w-5 h-5 rounded bg-[var(--color-accent)]/40"></div>
            </div>
            <h3
              class="font-semibold mb-2"
              style="font-family: var(--font-heading)"
            >
              Feature Three
            </h3>
            <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
              Description of the feature and why it matters to the user.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-20 px-6">
      <div class="max-w-3xl mx-auto text-center">
        <h2 class="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
          Ready to get started?
        </h2>
        <p class="text-[var(--color-text-muted)] mb-8">
          Join thousands of users who already love this product.
        </p>
        <a
          href="#"
          class="inline-block px-8 py-3 rounded-[var(--radius)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] font-medium transition-colors"
          >Start Free Trial</a
        >
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-white/5 py-8 px-6">
      <div
        class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4"
      >
        <p class="text-sm text-[var(--color-text-muted)]">
          2026 Brand. All rights reserved.
        </p>
        <div class="flex gap-6">
          <a
            href="#"
            class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >Privacy</a
          >
          <a
            href="#"
            class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >Terms</a
          >
        </div>
      </div>
    </footer>
  </body>
</html>
```

### Dashboard

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script
      defer
      src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
    ></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=DM+Sans:opsz,wght@9..40,300..700&display=swap"
      rel="stylesheet"
    />
    <style>
      [x-cloak] {
        display: none !important;
      }
      :root {
        --color-primary: #0f172a;
        --color-accent: #0ea5e9;
        --color-surface: #1e293b;
        --color-surface-hover: #334155;
        --color-text: #f8fafc;
        --color-text-muted: #94a3b8;
        --color-border: rgba(255, 255, 255, 0.06);
        --color-success: #22c55e;
        --color-warning: #f59e0b;
        --color-error: #ef4444;
        --font-heading: "Space Grotesk", sans-serif;
        --font-body: "DM Sans", sans-serif;
        --radius: 10px;
        --sidebar-width: 240px;
      }
      body {
        font-family: var(--font-body);
      }
      h1,
      h2,
      h3 {
        font-family: var(--font-heading);
      }
    </style>
  </head>
  <body
    class="bg-[var(--color-primary)] text-[var(--color-text)]"
    x-data="{
        sidebarOpen: true,
        activeTab: 'overview',
        stats: [
          { label: 'Revenue', value: '$48,200', change: '+12.5%', up: true },
          { label: 'Users', value: '2,847', change: '+8.2%', up: true },
          { label: 'Orders', value: '1,234', change: '-2.4%', up: false },
          { label: 'Conversion', value: '3.2%', change: '+0.8%', up: true }
        ]
      }"
  >
    <div class="flex h-screen overflow-hidden">
      <!-- Sidebar -->
      <aside
        x-show="sidebarOpen"
        x-transition
        class="w-[var(--sidebar-width)] border-r border-[var(--color-border)] flex flex-col shrink-0"
      >
        <div
          class="h-14 px-4 flex items-center border-b border-[var(--color-border)]"
        >
          <span
            class="font-bold text-sm tracking-tight"
            style="font-family: var(--font-heading)"
            >Dashboard</span
          >
        </div>
        <nav class="flex-1 p-3 space-y-1">
          <template
            x-for="item in ['overview', 'analytics', 'customers', 'orders', 'settings']"
            :key="item"
          >
            <button
              @click="activeTab = item"
              :class="activeTab === item ? 'bg-[var(--color-surface)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/50'"
              class="w-full text-left px-3 py-2 rounded-lg text-sm capitalize transition-colors cursor-pointer"
              x-text="item"
            ></button>
          </template>
        </nav>
      </aside>

      <!-- Main content -->
      <main class="flex-1 overflow-auto">
        <header
          class="h-14 px-6 flex items-center justify-between border-b border-[var(--color-border)]"
        >
          <button
            @click="sidebarOpen = !sidebarOpen"
            class="p-1.5 rounded-lg hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            aria-label="Toggle sidebar"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <div class="flex items-center gap-3">
            <div
              class="w-7 h-7 rounded-full bg-[var(--color-accent)]/20 flex items-center justify-center text-xs font-medium text-[var(--color-accent)]"
            >
              U
            </div>
          </div>
        </header>

        <div class="p-6">
          <h1 class="text-xl font-bold mb-6">Overview</h1>

          <!-- Stats grid -->
          <div
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
          >
            <template x-for="stat in stats" :key="stat.label">
              <div
                class="p-4 rounded-[var(--radius)] bg-[var(--color-surface)] border border-[var(--color-border)]"
              >
                <p
                  class="text-xs text-[var(--color-text-muted)] mb-1"
                  x-text="stat.label"
                ></p>
                <p
                  class="text-2xl font-bold tracking-tight"
                  style="font-family: var(--font-heading)"
                  x-text="stat.value"
                ></p>
                <p
                  class="text-xs mt-1"
                  :class="stat.up ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'"
                  x-text="stat.change"
                ></p>
              </div>
            </template>
          </div>

          <!-- Chart placeholder -->
          <div
            class="rounded-[var(--radius)] bg-[var(--color-surface)] border border-[var(--color-border)] p-6 mb-8"
          >
            <h3 class="text-sm font-semibold mb-4">Revenue Over Time</h3>
            <div class="h-48 flex items-end gap-2">
              <template
                x-for="(height, i) in [40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88]"
                :key="i"
              >
                <div
                  class="flex-1 rounded-t bg-[var(--color-accent)]/60 hover:bg-[var(--color-accent)] transition-colors cursor-pointer"
                  :style="'height: ' + height + '%'"
                ></div>
              </template>
            </div>
            <div class="flex justify-between mt-2">
              <span class="text-xs text-[var(--color-text-muted)]">Jan</span>
              <span class="text-xs text-[var(--color-text-muted)]">Dec</span>
            </div>
          </div>

          <!-- Table -->
          <div
            class="rounded-[var(--radius)] bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden"
          >
            <div class="px-4 py-3 border-b border-[var(--color-border)]">
              <h3 class="text-sm font-semibold">Recent Orders</h3>
            </div>
            <table class="w-full">
              <thead>
                <tr class="border-b border-[var(--color-border)]">
                  <th
                    class="text-left text-xs font-medium text-[var(--color-text-muted)] px-4 py-2"
                  >
                    Order
                  </th>
                  <th
                    class="text-left text-xs font-medium text-[var(--color-text-muted)] px-4 py-2"
                  >
                    Customer
                  </th>
                  <th
                    class="text-left text-xs font-medium text-[var(--color-text-muted)] px-4 py-2"
                  >
                    Amount
                  </th>
                  <th
                    class="text-left text-xs font-medium text-[var(--color-text-muted)] px-4 py-2"
                  >
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr class="border-b border-[var(--color-border)]">
                  <td class="px-4 py-3 text-sm">#1234</td>
                  <td class="px-4 py-3 text-sm">Alice Johnson</td>
                  <td class="px-4 py-3 text-sm">$299.00</td>
                  <td class="px-4 py-3">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)]"
                      >Completed</span
                    >
                  </td>
                </tr>
                <tr class="border-b border-[var(--color-border)]">
                  <td class="px-4 py-3 text-sm">#1233</td>
                  <td class="px-4 py-3 text-sm">Bob Chen</td>
                  <td class="px-4 py-3 text-sm">$149.00</td>
                  <td class="px-4 py-3">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                      >Pending</span
                    >
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-3 text-sm">#1232</td>
                  <td class="px-4 py-3 text-sm">Clara Davis</td>
                  <td class="px-4 py-3 text-sm">$89.00</td>
                  <td class="px-4 py-3">
                    <span
                      class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)]"
                      >Completed</span
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  </body>
</html>
```

### Mobile App Prototype

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    />
    <title>Mobile App</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script
      defer
      src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"
    ></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=DM+Sans:opsz,wght@9..40,300..700&display=swap"
      rel="stylesheet"
    />
    <style>
      [x-cloak] {
        display: none !important;
      }
      :root {
        --color-primary: #0f172a;
        --color-accent: #0ea5e9;
        --color-surface: #1e293b;
        --color-text: #f8fafc;
        --color-text-muted: #94a3b8;
        --color-border: rgba(255, 255, 255, 0.08);
        --font-heading: "Space Grotesk", sans-serif;
        --font-body: "DM Sans", sans-serif;
        --radius: 16px;
        --safe-top: env(safe-area-inset-top, 0px);
        --safe-bottom: env(safe-area-inset-bottom, 0px);
      }
      body {
        font-family: var(--font-body);
      }
      h1,
      h2,
      h3 {
        font-family: var(--font-heading);
      }
    </style>
  </head>
  <body class="bg-[var(--color-primary)] text-[var(--color-text)]">
    <div class="min-h-screen flex items-center justify-center p-4 md:p-8">
      <div
        class="w-full max-w-[390px] min-h-[844px] bg-[var(--color-primary)] rounded-[40px] md:border md:border-[var(--color-border)] md:shadow-2xl overflow-hidden relative"
        x-data="{ activeTab: 'home', items: [
           { title: 'Morning Routine', subtitle: '7 tasks', color: 'var(--color-accent)' },
           { title: 'Work Focus', subtitle: '12 tasks', color: '#22C55E' },
           { title: 'Evening Wind Down', subtitle: '4 tasks', color: '#A855F7' }
         ]}"
      >
        <!-- Status bar -->
        <div
          class="h-12 px-6 flex items-center justify-between text-xs font-medium"
          style="padding-top: var(--safe-top)"
        >
          <span>9:41</span>
          <div class="flex items-center gap-1">
            <div class="w-4 h-2.5 rounded-sm border border-current relative">
              <div
                class="absolute inset-0.5 rounded-[1px] bg-current"
                style="width: 70%"
              ></div>
            </div>
          </div>
        </div>

        <!-- Screen content -->
        <div class="px-5 pt-2 pb-24">
          <h1 class="text-2xl font-bold mb-1">Good morning</h1>
          <p class="text-sm text-[var(--color-text-muted)] mb-6">
            3 routines ready
          </p>

          <div class="space-y-3">
            <template x-for="(item, i) in items" :key="i">
              <div
                class="p-4 rounded-[var(--radius)] bg-[var(--color-surface)] border border-[var(--color-border)] active:scale-[0.98] transition-transform cursor-pointer"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-10 h-10 rounded-xl flex items-center justify-center"
                    :style="'background: ' + item.color + '20'"
                  >
                    <div
                      class="w-4 h-4 rounded"
                      :style="'background: ' + item.color"
                    ></div>
                  </div>
                  <div class="flex-1">
                    <p class="text-sm font-semibold" x-text="item.title"></p>
                    <p
                      class="text-xs text-[var(--color-text-muted)]"
                      x-text="item.subtitle"
                    ></p>
                  </div>
                  <svg
                    class="w-4 h-4 text-[var(--color-text-muted)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Tab bar -->
        <div
          class="absolute bottom-0 inset-x-0 border-t border-[var(--color-border)] bg-[var(--color-primary)]/90 backdrop-blur-xl"
          style="padding-bottom: var(--safe-bottom)"
        >
          <div class="flex justify-around py-2">
            <template
              x-for="tab in [{name:'home', icon:'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3M19 10v10a1 1 0 01-1 1h-3'}, {name:'search', icon:'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'}, {name:'profile', icon:'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'}]"
              :key="tab.name"
            >
              <button
                @click="activeTab = tab.name"
                class="p-2 flex flex-col items-center gap-0.5 cursor-pointer"
                :class="activeTab === tab.name ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    :d="tab.icon"
                  />
                </svg>
                <span class="text-[10px] capitalize" x-text="tab.name"></span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
```

### Multi-Page Prototype Pattern

For multi-page designs, use Alpine.js to simulate page routing:

```html
<body x-data="{ currentPage: 'home' }">
  <!-- Page: Home -->
  <div x-show="currentPage === 'home'" x-transition>
    <!-- Home page content -->
    <button @click="currentPage = 'about'" class="cursor-pointer">
      Go to About
    </button>
  </div>

  <!-- Page: About -->
  <div x-show="currentPage === 'about'" x-cloak x-transition>
    <!-- About page content -->
    <button @click="currentPage = 'home'" class="cursor-pointer">
      Back to Home
    </button>
  </div>

  <!-- Page: Contact -->
  <div x-show="currentPage === 'contact'" x-cloak x-transition>
    <!-- Contact page content -->
  </div>
</body>
```

### Card Grid Layout

```html
<!-- Use within a full HTML skeleton -->
<section class="py-20 px-6">
  <div class="max-w-6xl mx-auto" x-data="{ filter: 'all' }">
    <!-- Filter bar -->
    <div class="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
      <template
        x-for="cat in ['all', 'design', 'code', 'marketing', 'product']"
        :key="cat"
      >
        <button
          @click="filter = cat"
          :class="filter === cat ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'"
          class="px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer capitalize"
          x-text="cat"
        ></button>
      </template>
    </div>

    <!-- Card grid -->
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      <div
        class="group rounded-[var(--radius)] bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden hover:border-[var(--color-accent)]/30 transition-colors"
      >
        <div
          class="aspect-[16/10] bg-gradient-to-br from-[var(--color-accent)]/20 to-[var(--color-accent)]/5"
        ></div>
        <div class="p-5">
          <p class="text-xs text-[var(--color-accent)] font-medium mb-2">
            Category
          </p>
          <h3
            class="font-semibold mb-1"
            style="font-family: var(--font-heading)"
          >
            Card Title
          </h3>
          <p class="text-sm text-[var(--color-text-muted)] line-clamp-2">
            Description text that gives context about this card item.
          </p>
        </div>
      </div>
    </div>
  </div>
</section>
```

---

## Complete Generation Example

Here is a full example showing the end-to-end flow of creating a design:

```bash
# Step 1: Create the design project
pnpm action create-design --title "SaaS Landing Page" --projectType prototype

# Step 2: Navigate to it
pnpm action navigate --view editor --designId <returned-id>

# Step 3: Generate the design files
pnpm action generate-design \
  --designId "<returned-id>" \
  --prompt "Modern SaaS landing page with dark theme" \
  --files '[
    {
      "filename": "index.html",
      "content": "<!DOCTYPE html><html lang=\"en\">...(full HTML)...</html>",
      "fileType": "html"
    }
  ]'
```

For designs with separate CSS:

```bash
pnpm action generate-design \
  --designId "<id>" \
  --prompt "Dashboard with custom animations" \
  --files '[
    {
      "filename": "index.html",
      "content": "<!DOCTYPE html>...",
      "fileType": "html"
    },
    {
      "filename": "styles.css",
      "content": "@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }...",
      "fileType": "css"
    }
  ]'
```

---

## Delegating to Sub-Agents

When spawning a sub-agent for design work, write an explicit task description — never vague. The sub-agent has the same actions you do and will use them if you tell it to.

**Always include in every design sub-agent task:**

1. **The exact designId** if working on an existing design
2. **The design system tokens** if one is linked (pass the full DesignSystemData JSON)
3. **DO NOT tell it to read skills or explore** — the HTML templates are in this AGENTS.md
4. **The complete HTML skeleton** — sub-agents should output full, self-contained HTML

**Example — generating a design for an open project:**

```
The user has design "design-abc123" open. Generate a SaaS landing page prototype.

Use `generate-design --designId "design-abc123"` with:
- filename: "index.html"
- Complete HTML with Alpine.js + Tailwind CDN
- Dark theme with accent color #0EA5E9
- Responsive from 375px to 1920px
- CSS custom properties in :root for tweaks panel

Use the HTML templates from AGENTS.md. DO NOT use db-schema, search-files, or shell.
```

---

## Visual Quality Standards — Anti-AI-Slop Rules

### Blacklisted Patterns (NEVER use these)

- Aggressive purple/blue gradients as primary backgrounds
- Left-border accent cards (the colored left stripe pattern)
- Emoji as icons in the UI — use SVG or Tabler icons
- Inline SVG illustrations or hand-drawn SVG imagery
- Inter, Roboto, or Arial as primary fonts — use distinctive typography
- Fake statistics ("87% of users", "3x faster") — only real data or clearly labeled placeholder data
- Fake testimonials or quotes
- Generic stock-photo-style imagery
- Decorative sparkle/glow effects
- Excessive drop shadows or glassmorphism
- Rounded cards with centered icon + title + description (the "bento card" cliche)
- Gradient text on every heading
- Floating 3D elements for decoration
- "Trusted by 10,000+ companies" without real logos

### Required Quality Checks

Before saving any generated design, verify:

- Body text minimum 16px (never smaller unless it's a caption or label)
- Heading hierarchy is clear and consistent
- "Earn its place" — every element must justify its existence
- Empty space is solved with composition, not filler content
- When you think "adding this would look better" — that is usually a sign of AI slop
- Default to restraint: fewer elements, more whitespace, stronger hierarchy
- Touch targets are at least 44x44px on mobile
- Color contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large text)
- No orphaned headings (heading always followed by content)

### Modern CSS Techniques to Use

- `text-wrap: balance` for headings, `text-wrap: pretty` for body
- `oklch()` color space for perceptually uniform color manipulation
- CSS Grid with named areas for complex layouts (in `<style>` blocks)
- `color-mix()` for dynamic color variants
- Container queries for component-responsive design
- `:has()` selector for parent-based styling
- `scroll-snap-type` for carousel/swipe interactions
- `@property` for animating CSS custom properties

### Typography Best Practices

- Use 2 fonts maximum: one for headings, one for body
- Heading: 600-900 weight, tight tracking (`letter-spacing: -0.02em` to `-0.04em`)
- Body: 400-500 weight, relaxed leading (`line-height: 1.6` to `1.75`)
- Caption/label: 300-500 weight, wider tracking (`letter-spacing: 0.05em` to `0.1em`)
- Use `font-variation-settings` for variable fonts when available
- Two-tier text shadow for depth: `1px 1px 0 rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.05)` (never a single hard shadow)

### Color Best Practices

- Define a 5-7 color palette maximum
- Use opacity variants (`/10`, `/20`, `/40`, `/60`) instead of defining 50 shades
- Background-to-surface contrast should be subtle (e.g., `#0F172A` to `#1E293B`)
- Accent color used sparingly — CTAs, active states, key data points
- Status colors: success (green), warning (amber), error (red), info (blue)

---

## Design Philosophy Reference

When the user's request is vague about visual direction, recommend from these schools:

### Information Architecture School

| Style             | Philosophy                                                    | When to Use                                                 |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| **Pentagram**     | Grid-first, black/white/red, structured information hierarchy | Data-heavy dashboards, editorial layouts, corporate reports |
| **Stamen Design** | Data-driven, cartographic precision, clear visual encoding    | Analytics dashboards, map interfaces, data visualization    |

### Motion Poetics School

| Style             | Philosophy                                                 | When to Use                                               |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| **Locomotive**    | Smooth scroll, parallax depth, cinematic pacing            | Long-form landing pages, storytelling, product showcases  |
| **Active Theory** | WebGL experiments, particle systems, immersive 3D          | Creative portfolios, tech demos, experimental interfaces  |
| **Field.io**      | Generative art, algorithmic beauty, mathematical precision | Art installations, creative tools, music/audio interfaces |

### Minimalism School

| Style                   | Philosophy                                                   | When to Use                                              |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| **Experimental Jetset** | Swiss typography, geometric forms, pure structure            | Typographic layouts, manifesto pages, text-first designs |
| **Muller-Brockmann**    | Grid systems, objective communication, typographic hierarchy | Enterprise SaaS, documentation, structured content       |
| **Build**               | Reduction to essence, mono-font, pure whitespace             | Developer tools, API docs, technical products            |

### Eastern Philosophy School

| Style          | Philosophy                                                    | When to Use                                                     |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------- |
| **Kenya Hara** | Ma (negative space), simplicity as depth, emptiness as design | Luxury products, meditation/wellness, premium experiences       |
| **Takram**     | Craft meets technology, material honesty, subtle animation    | Physical-digital products, IoT dashboards, craft-focused brands |

**Key insight**: Describe mood, not layout. Short emotional prompts outperform detailed layout specifications. "Make it feel like a quiet morning" is more effective than "put the header at the top with 80px padding and a centered logo."

---

## Batch Production Strategy

Always make a hero section first to lock the visual grammar before generating the full page:

1. Generate the hero/above-the-fold section (first ~500px of viewport)
2. Show the user the preview
3. Once approved, generate the remaining sections following the established grammar
4. Apply tweaks definitions for interactive customization

For multi-page prototypes, establish the visual language on the home page first, then apply it consistently to all sub-pages.

---

## Export and Handoff

### HTML Export

`export-html --id <id>` bundles all files into a single standalone HTML file with Tailwind CDN and Alpine.js included. The output works when double-clicked in a browser.

### ZIP Export

`export-zip --id <id>` creates a ZIP containing:

- All HTML, CSS, JSX files organized by type
- `README.md` with project metadata
- `design-data.json` with generation metadata

### Claude Code Handoff

When the user wants to convert a prototype into production code, generate a handoff prompt:

```
Convert this Alpine.js + Tailwind prototype into a production React/Next.js application.

Key design tokens:
- Primary: #0F172A
- Accent: #0EA5E9
- Font: Space Grotesk (headings), DM Sans (body)
- Border radius: 12px

Interactive states to preserve:
- Mobile navigation toggle
- Tab switching
- Filter controls

Responsive breakpoints:
- Mobile: 375px
- Tablet: 768px
- Desktop: 1280px
- Wide: 1920px
```

---

## Inline Previews in Chat

The agent can embed a design preview directly inside a chat message using the framework's `embed` fence:

````
```embed
src: /present/<designId>
aspect: 16/9
title: Landing Page Preview
```
````

- `designId` — the design's `id` field (required).
- `aspect` — use `16/9` for desktop layouts, `9/16` for mobile prototypes.
- `title` — a short human-readable label shown above the iframe in chat.

---

## Skills

Skills provide detailed guidance for specific patterns. Read the relevant skill before making changes — these are the source of truth.

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `design-generation`   | Before generating any design HTML content                      |
| `design-systems`      | Before creating/applying design systems                        |
| `export-handoff`      | Before exporting or generating handoff commands                |
| `actions`             | Before creating or modifying actions                           |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |
| `capture-learnings`   | When you learn something worth remembering                     |
| `create-skill`        | When adding a new skill                                        |
| `security`            | Before writing any action that touches user data               |

The framework auto-injects a `<skills>` block in your system prompt listing every available skill. Read a skill via shell:

```bash
cat .agents/skills/design-generation/SKILL.md
```

---

## When Adding Features

As you build out this app, follow this checklist for each new feature:

1. **Add navigation state entries** — extend `use-navigation-state.ts` to track new routes
2. **Enhance view-screen** — make the view-screen script return relevant context for the new view
3. **Create domain actions** — add actions for CRUD operations on new data models
4. **Create domain skills** — add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations
5. **Update this AGENTS.md** — add the new actions, state keys, and common tasks

### Authentication

Auth is automatic and environment-driven:

- **Dev mode**: Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`.
- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts.

Use `getSession(event)` server-side and `useSession()` client-side.

### UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

---

## Development

For code editing and development guidance, read `DEVELOPING.md`.
