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

**When the user uploads a raw `.fig` file**, send it to Builder design-system
indexing through the setup page upload route. Do not parse `.fig` files locally
and do not call `create-design-system` from raw `.fig` output; Builder owns the
indexed brand kit, generated docs, and usage guidance.

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
