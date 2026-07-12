---
name: design-systems
description: >-
  Manage and apply Design app brand systems. Use when creating, importing,
  linking, inspecting, or following design-system tokens, assets, fonts, logos,
  and custom instructions.
---

# Design Systems

Design systems store brand identity tokens (colors, fonts, spacing, logos) that are applied to all designs in a project.

## Data Model

Design systems are stored in the `design_systems` SQL table. Each has:

- `id` — unique identifier
- `title` — display name (e.g., "Acme Corp Brand")
- `description` — optional description
- `data` — JSON string containing `DesignSystemData` tokens
- `assets` — JSON string containing `DesignSystemAsset[]` (logos, fonts, images)
- `is_default` — boolean, whether this is the user's default design system
- `owner_email` — auto-set from session
- `org_id` — organization scope

### DesignSystemData Schema

```typescript
interface DesignSystemData {
  colors: {
    primary: string;      // Main background (#0F172A)
    secondary: string;    // Secondary background (#1E293B)
    accent: string;       // Accent/CTA color (#0EA5E9)
    background: string;   // Page background (#0F172A)
    surface: string;      // Card/panel background (#1E293B)
    text: string;         // Primary text (#F8FAFC)
    textMuted: string;    // Secondary text (#94A3B8)
  };
  typography: {
    headingFont: string;  // Google Fonts name ("Space Grotesk")
    bodyFont: string;     // Google Fonts name ("DM Sans")
    headingWeight: string;  // e.g., "700"
    bodyWeight: string;     // e.g., "400"
    headingSizes: {
      h1: string;  // e.g., "64px"
      h2: string;  // e.g., "40px"
      h3: string;  // e.g., "28px"
    };
  };
  spacing: {
    pagePadding: string;  // e.g., "80px 110px"
    elementGap: string;    // e.g., "24px"
  };
  borders: {
    radius: string;        // e.g., "12px"
    accentWidth: string;   // e.g., "4px"
  };
  defaults: {
    background: string;    // e.g., "#0F172A"
    labelStyle: "uppercase" | "lowercase" | "capitalize" | "none";
  };
  logos: {
    url: string;
    name: string;
    variant: "light" | "dark" | "auto";
  }[];
  imageStyle?: {
    referenceUrls: string[];
    styleDescription: string;  // e.g., "Clean, minimal product photography"
  };
  customCSS?: string;   // Extra CSS injected into designs
  notes?: string;        // Free-form brand notes
}
```

`imageStyle.styleDescription` is not just metadata — fold it into every
`generate-asset` prompt for a design linked to this system, alongside the
subject/composition/lighting direction described in the design-generation
skill's Imagery section. This is what keeps generated photography/illustration
on-brand instead of drifting to a generic stock look each time.

## Actions

### Creating a Design System

```bash
pnpm action create-design-system \
  --title "Acme Corp Brand" \
  --description "Corporate brand identity" \
  --data '{
    "colors": {
      "primary": "#0F172A",
      "secondary": "#1E293B",
      "accent": "#2563EB",
      "background": "#0F172A",
      "surface": "#1E293B",
      "text": "#F8FAFC",
      "textMuted": "#94A3B8"
    },
    "typography": {
      "headingFont": "<HEADING_FONT>",
      "bodyFont": "<BODY_FONT>",
      "headingWeight": "700",
      "bodyWeight": "400",
      "headingSizes": { "h1": "64px", "h2": "40px", "h3": "28px" }
    },
    "spacing": { "pagePadding": "80px 110px", "elementGap": "24px" },
    "borders": { "radius": "12px", "accentWidth": "4px" },
    "defaults": { "background": "#0F172A", "labelStyle": "uppercase" },
    "logos": []
  }'
```

`<HEADING_FONT>` / `<BODY_FONT>` are placeholders — pick a real Google Fonts
pairing per the design-generation skill's Font Recommendations table (or the
brand's actual extracted fonts) rather than defaulting to Space Grotesk/DM
Sans every time; that pairing is this skill's own most common convergence
fingerprint.

If this is the user's first design system, it is automatically set as the default.

### Starting from an established public system

Use the curated production templates instead of recreating familiar systems
from memory:

```bash
pnpm action create-design-system --templateId material-3
pnpm action create-design-system --templateId carbon-white
pnpm action create-design-system --templateId primer-light
```

Each template is a source-linked, versioned snapshot with real semantic tokens,
type scales, spacing, shapes, CSS variables, state guidance, attribution, and
brand-misrepresentation guardrails. The action may accept a custom `title`,
`description`, or additional `customInstructions`, but it intentionally rejects
`data` overrides when `templateId` is present so the named snapshot cannot
silently become a lookalike. Use `get-design-system` after creation when the
full stored snapshot is needed.

### Reading a Design System

```bash
pnpm action get-design-system --id <designSystemId>
```

Returns the full `data` and `assets` JSON.

### Listing All Design Systems

```bash
pnpm action list-design-systems
pnpm action list-design-systems --compact true
```

### Updating Tokens

```bash
pnpm action update-design-system --id <id> --data '<updated JSON>'
```

Only provided fields are updated. You can also update `--title`, `--description`, or `--assets`.

### Setting Default

```bash
pnpm action set-default-design-system --id <id>
```

Unsets any previously-default design system for this user.

## Multi-Source Import Flow

The design system setup page collects brand assets from multiple sources. When the user clicks "Continue to generation", a structured message is sent to the agent with all sources. Process each source type with the appropriate action:

### Source: Website URL

```bash
pnpm action import-from-url --url "https://acme.com"
```

Returns CSS custom properties, colors, fonts, Google Fonts links, theme-color, OG image, favicon.

### Source: GitHub Repository

```bash
pnpm action index-design-system-with-builder --githubRepoUrl "https://github.com/acme/ui"
```

Starts Builder design-system indexing for the repository. Builder is the source of truth for the indexed brand kit, generated docs, and usage guidance. If Builder is not connected, stop and ask the user to connect Builder.

### Source: Local Code Files

```bash
pnpm action index-design-system-with-builder --codeFiles '[{"filename":"globals.css","content":"..."}]'
```

Uploads code/design files to Builder and starts design-system indexing. Do not create a local design system from uploaded code files unless the user explicitly asks for a manual local fallback.

For the active design's Tokens panel, use `import-design-tokens` when the user
wants to pull reusable CSS vars/tokens straight into the open design without
creating a full design system:

```bash
pnpm action import-design-tokens \
  --designId "design_123" \
  --source files \
  --files '[{"filename":"design.md","content":"Primary color: #2563eb"}]'
```

Supported sources are `files`, `paste`, and `current-design`. The action parses
CSS variables, design.md-style labeled lines, Tailwind/theme JSON, colors,
spacing, radii, and fonts, then persists them through the design's
`tweakSelections` so the canvas updates like any other token edit. Treat manual
`apply-design-token-edit` calls as a last-resort one-off edit after import has
been tried or ruled out.

### Source: Documents (DOCX, PPTX, PDF)

```bash
pnpm action import-document --files '[{"filename":"brand.pptx","fileType":"application/pptx","sizeBytes":1234}]'
```

Returns content-type-aware design hints and agent instructions. Presentations are the strongest signal for brand colors/fonts.

### Source: Existing Project or Design System

```bash
pnpm action import-design-project --designId "abc123"
pnpm action import-design-project --designId _ --designSystemId "ds-456"
```

Extracts CSS tokens from a project's generated HTML, or clones an existing design system for forking.

### Source: Figma file

```bash
pnpm action index-design-system-with-builder \
  --projectName "Acme Figma system" \
  --codeFiles '[{"filename":"figma-summary.md","content":"<extracted tokens / styles summary>"}]'
```

Builder is the required extraction/indexing path for Figma-backed design
systems. If a connected Figma MCP is available (tools like `get_variable_defs`,
`get_design_context`, `get_metadata`, `get_screenshot`), call those on the
file/selection first to pull real variables, color/text styles, and screenshot
notes, then pass that summary to `index-design-system-with-builder` as an
uploaded text context file. Do not build a local design system from the Figma
summary unless the user explicitly asks for a manual local fallback.

**When the user uploads a raw `.fig` file on the Design System Setup page**,
send it to Builder design-system indexing through the setup page upload route.
Do not parse `.fig` files locally for this flow and do not call
`create-design-system` from raw `.fig` output; Builder owns the indexed brand
kit, generated docs, and usage guidance. This is unchanged and is specifically
about **token/brand-kit extraction**.

**When the user uploads a raw `.fig` file in the Design editor's Import panel**
(not Design System Setup), it takes a different, narrower path: the server
decodes the container/Kiwi document locally (`fig-file-decoder.ts`) and maps
its `NodeChange` tree to editable HTML screens (`fig-file-to-html.ts`,
`fig-file-import.ts`) through the same `saveImportedDesignFiles` path as other
Design imports — no Builder connection required. This is explicitly scoped to
**screens only**, not tokens: it does not create or update a design system, and
it is separate from (and does not reopen) the Design System Setup `.fig`
upload above. Treat it as experimental — the `.fig` container is a proprietary,
undocumented format, so unsupported node types, geometry, or schema variants
fail closed with an explicit warning/placeholder rather than a silent
approximation. Read the returned `fidelityReport` (`stats`, `warnings`) back to
the user, and see `FIGMA_INTEROPERABILITY.md`'s "`.fig` upload" row for the
current fidelity contract and required verification corpus.

**When the user wants a Figma Assets-style native component drawer inside
Design**, do not use Figma or media assets. Use `list-design-native-assets` to
choose an editable primitive/component/layout, then
`insert-design-native-asset` to insert it into the active screen. These entries
are Design-native HTML stamped with component/layer metadata.

**When the user wants reusable Figma components/assets**, do not run
design-system indexing just to insert a component. Use
`list-figma-library-assets` with a Figma file URL/key, then
`insert-figma-library-asset` with the returned `renderUrl`, `fileKey`,
`nodeId`, `componentKey`, and `sourceUrl`. This inserts a rendered
component/component set with provenance. Styles and variables still belong in
the Builder-backed design-system path above.

### Import from Figma (pixel-accurate frame import)

**When the user pastes a Figma frame/screen link and wants a real, editable
Design screen** (not a rendered image, not a component insert), use
`import-figma-frame` instead of `list-figma-library-assets` +
`insert-figma-library-asset`:

```bash
pnpm action import-figma-frame --figmaUrl "https://www.figma.com/design/<fileKey>/<name>?node-id=<id>"
# or
pnpm action import-figma-frame --fileKey "<fileKey>" --nodeId "12:34" --designId "<designId>"
```

- Accepts a full Figma URL (design/file/proto share links, including
  `/branch/<key>/` branch URLs — the branch's own key is used automatically) or
  an explicit `fileKey` + `nodeId`. If `nodeId` is omitted, the file's first
  top-level frame is imported.
- Maps the node tree to real HTML/CSS: exact position/size, auto-layout as
  flexbox, text (font, line-height, letter-spacing, case, decoration, align),
  fills (solid/gradient/image, correctly layered and gradient-angle-derived,
  not a default angle), strokes (including the CENTER/INSIDE/OUTSIDE
  distinction), per-corner radii, shadows/blur, opacity, and blend modes.
  Vector networks, boolean operations, and other structurally unsupported node
  types are rendered as an exact PNG at 2x scale instead of an approximated
  shape guess.
- Saves the result as a new screen via the same import path as other Design
  imports (`saveImportedDesignFiles`), placed on the overview canvas.
- Returns a `fidelityReport` — `exactCount`, `approximated` (properties CSS
  can only approximate: rotation, per-side stroke weights, radial/angular/
  diamond gradients, blur radius scale), and `imageFallbacks` (subtrees
  rendered as PNG instead of structural HTML). Read this back to the user when
  a design has non-trivial fallbacks so they know what to expect if they later
  edit that subtree.
- After import, treat the screen like any other: `view-screen`,
  `get-design-snapshot`, `apply-visual-edit` / `edit-design` all work normally
  on it.
- For a file's published FILL/TEXT/EFFECT/GRID styles (name, description, node
  id — not full token values), use `get-figma-styles` with `fileUrl`/`fileKey`.
  This is the file's Styles panel, not the Enterprise Variables API; full
  design-token extraction still routes through the Builder-backed
  `index-design-system-with-builder` path above.

#### Paste from Figma (Cmd+C/Cmd+V) vs. a copied frame link

A plain clipboard paste (Cmd+C in Figma, Cmd+V on the Design canvas) is
handled separately from `import-figma-frame`, because a clipboard paste and a
copied frame **link** carry fundamentally different information:

- **A copied frame link** (`?node-id=...`) names an exact node. Always exact —
  use `import-figma-frame`.
- **A current Figma clipboard paste** carries `figmeta.selectedNodeData`; each
  comma-separated entry begins with the exact REST node id. Design imports
  those selected nodes directly, including multi-selection. This field is not
  a public Figma contract, so older or future clipboard formats may still need
  the conservative matching fallback below.

The canvas paste listener (`app/lib/figma-clipboard.ts` +
`import-figma-clipboard`) handles this automatically:

1. Decodes `figmeta` from the pasted HTML client-side
   (`extractFigmeta`/`resolveFigmaPasteImportCall`) to decide whether to call
   `import-figma-clipboard` (figmeta present) or the legacy
   `import-design-source` HTML path (no figmeta — not a Figma paste, or an
   older Figma client that doesn't emit the marker).
2. When `selectedNodeData` is present, `import-figma-clipboard` fetches those
   exact node ids immediately. Otherwise it fetches the file's shallow
   structure and heuristically matches it against pasted visible text
   (`server/lib/figma-clipboard-match.ts`):
   a frame is only imported when its **name** or at least **two distinct
   text-layer contents** appear verbatim in the paste. Anything ambiguous or
   unmatched imports **nothing structural** — it never guesses and never
   imports the whole file uninvited.
3. On a confident match, the matched node(s) are fetched and mapped through
   the same `buildScreenFilesFromFigmaNodes` core `import-figma-frame` uses
   (`strategy: "restNodes"` in the result, with a `fidelityReport`).
4. Otherwise it falls back to the legacy visible-HTML paste
   (`strategy: "htmlFallback"`), and reports why via `matchStatus`
   (`"ambiguous"`, `"none"`, or `"error"`) and `figmaApiKeyMissing` (no
   `FIGMA_ACCESS_TOKEN` configured). The canvas paste toast surfaces a hint in
   both cases: connect the Figma access token, or paste a frame **link**
   instead for a guaranteed-exact import.

Tell users who need a path based only on Figma's public contract to copy a
frame **link** ("Copy link to selection" in Figma). Current Cmd+C is exact
when `selectedNodeData` is present, with conservative fallback if it changes.

### Reading a Figma file/frame without importing it

**When the user just asks a question about a Figma file/frame** ("what's in
this file?", "what's in this frame?", "show me a screenshot of this Figma
frame", "what components/instances does it use?") — do not call
`import-figma-frame` just to inspect it; that persists a new Design screen.
Use `get-figma-design-context` instead, the chat equivalent of the official
Figma MCP's `get_metadata` + `get_design_context` for this app:

```bash
# No nodeId: lists pages and top-level frames (like get_metadata with no node id)
pnpm action get-figma-design-context --figmaUrl "https://www.figma.com/design/<fileKey>/<name>"
# A specific frame/node: full structural summary + screenshot
pnpm action get-figma-design-context --figmaUrl "https://www.figma.com/design/<fileKey>/<name>?node-id=<id>"
```

- **Overview mode** (no `nodeId`, none parsed from the URL) returns the file's
  pages and each page's top-level frames (id, name, type, child count) so the
  agent can pick a frame before drilling in — mirrors the official MCP's
  `get_metadata` behavior when called with no node id.
- **Node mode** (a `nodeId`, or a link with `?node-id=`) returns a
  depth-limited, size-capped tree (`depth`/`maxNodes` args) describing box
  geometry, fills/strokes/effects/corner-radii (including per-corner arrays),
  auto-layout, text/style (font, case, decoration, line-height), and
  component/instance identity (`isComponent`/`isInstance`/`componentId`) for
  every visible descendant — plus a rendered screenshot URL by default
  (`includeScreenshot: false` to skip it). It never writes anything; use
  `import-figma-frame` afterward if the user wants the frame brought in as a
  real, editable screen.
- This also answers "what components does this file use?" for **local,
  unpublished** components/instances that never show up in
  `list-figma-library-assets` — that action's REST source
  (`/files/:key/components`) only returns components **published to a team
  library**, not every `COMPONENT`/`INSTANCE` node in the file. Use
  `get-figma-design-context` for "what components exist in this file/frame",
  and `list-figma-library-assets` + `insert-figma-library-asset` for "insert a
  reusable library component". The screenshot URL `get-figma-design-context`
  returns for a component/instance node can be passed straight to
  `insert-figma-library-asset` as `renderUrl` even when the component isn't
  published.
- For Figma **variables** ("what tokens/variables does this file define?"),
  give an honest answer instead of guessing: the REST Variables API is
  Enterprise-plan-gated, so `get-figma-design-context`'s summary of a node's
  own paints only shows resolved colors, not variable bindings, and
  `get-figma-styles` only covers the file's published FILL/TEXT/EFFECT/GRID
  **Styles** (a separate, non-Enterprise feature) — neither is the Variables
  API. If the user has Enterprise access and a connected Figma MCP with
  `get_variable_defs`, call that directly for real variable definitions and
  pass the result to `index-design-system-with-builder`. Otherwise, tell the
  user variables need Enterprise access or a connected Figma MCP, and offer
  Styles (`get-figma-styles`) or a manual `import-design-tokens` /
  `apply-design-token-edit` pass as the available fallback — do not claim to
  have enumerated variables from a plain `FIGMA_ACCESS_TOKEN`.

### Source: Brand Analysis (combines website + notes)

```bash
pnpm action analyze-brand-assets \
  --websiteUrl "https://acme.com" \
  --companyName "Acme" \
  --brandNotes "Modern B2B SaaS, blue accent, clean"
```

Returns CSS properties, colors, fonts, theme-color, metadata.

### Processing Multiple Sources

When the user provides multiple sources, call all applicable import actions in parallel, then synthesize:

1. **Prioritize code sources** (GitHub, local files) — these have the most accurate tokens
2. **Figma variables/styles** (via the Figma MCP) — authoritative when the team designs in Figma
3. **Cross-reference with website** — validates colors/fonts are actually deployed
4. **Documents supplement** — presentations may reveal brand colors not in code
5. **Images inform mood** — color temperature, density, visual style
6. **Aggregate into DesignSystemData** — merge all extracted tokens, resolve conflicts
7. **Call `create-design-system`** with the combined result
8. **Link to design** via `update-design --designSystemId`

## Applying Design System to Generated HTML

When generating a design that has a linked design system, replace all default CSS custom properties with the design system tokens.

### Before (defaults):

```css
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
```

### After (with design system):

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

Also update the Google Fonts `<link>` tag to include the design system's fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=HEADING_FONT:wght@400;700;900&family=BODY_FONT:wght@300;400;600&display=swap" rel="stylesheet">
```

### Logo Usage

If the design system has logos, include them in the navigation or hero:

```html
<!-- Light logo on dark background -->
<img src="LOGO_URL" alt="Company Name" class="h-8">

<!-- Or for logos with variant "auto", use CSS to switch -->
<img src="LOGO_URL" alt="Company Name" class="h-8 dark:invert">
```

### Custom CSS Injection

If the design system has `customCSS`, inject it into the `<style>` block:

```html
<style>
  [x-cloak] { display: none !important; }
  :root { /* tokens */ }
  /* Design system custom CSS */
  ${designSystem.customCSS}
</style>
```

## Tweaks Integration

Design system values should be the starting point for tweaks. When generating tweaks:

```json
{
  "tweaks": [
    {
      "id": "accent-color",
      "label": "Accent Color",
      "type": "color-swatch",
      "options": [
        { "label": "Brand", "value": "DESIGN_SYSTEM_ACCENT", "color": "DESIGN_SYSTEM_ACCENT" },
        { "label": "Alt 1", "value": "#22C55E", "color": "#22C55E" },
        { "label": "Alt 2", "value": "#F97316", "color": "#F97316" }
      ],
      "defaultValue": "DESIGN_SYSTEM_ACCENT",
      "cssVar": "--color-accent"
    }
  ]
}
```

The first option should always be the design system's value (labeled "Brand" or the company name).

## Sharing Design Systems

Design systems use the same sharing model as designs:

```bash
pnpm action share-resource --resourceType design-system --resourceId <id> --principalType org --principalId <orgId> --role viewer
```

This makes the design system available to all members of an organization.
