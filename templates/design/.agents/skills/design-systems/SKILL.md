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
    slidePadding: string;  // e.g., "80px 110px"
    elementGap: string;    // e.g., "24px"
  };
  borders: {
    radius: string;        // e.g., "12px"
    accentWidth: string;   // e.g., "4px"
  };
  slideDefaults: {
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
      "headingFont": "Space Grotesk",
      "bodyFont": "DM Sans",
      "headingWeight": "700",
      "bodyWeight": "400",
      "headingSizes": { "h1": "64px", "h2": "40px", "h3": "28px" }
    },
    "spacing": { "slidePadding": "80px 110px", "elementGap": "24px" },
    "borders": { "radius": "12px", "accentWidth": "4px" },
    "slideDefaults": { "background": "#0F172A", "labelStyle": "uppercase" },
    "logos": []
  }'
```

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

## Brand Asset Extraction Flow

When a user wants to create a design system from an existing brand:

### Step 1: Gather brand signals

```bash
pnpm action analyze-brand-assets \
  --websiteUrl "https://acme.com" \
  --companyName "Acme" \
  --brandNotes "Modern B2B SaaS, blue accent, clean"
```

Returns:
- `cssCustomProperties` — extracted CSS variables from the website
- `colors` — hex/rgb colors found in the HTML/CSS
- `fontFaces` — @font-face declarations
- `googleFonts` — Google Fonts links
- `themeColor` — meta theme-color
- `pageTitle`, `metaDescription`, `ogImage`, `favicon`

### Step 2: Analyze and create

Use the extracted data to build a `DesignSystemData` object:

1. Map the most prominent colors to `primary`, `accent`, `surface`, `text`
2. Identify heading and body fonts from `fontFaces` or `googleFonts`
3. Extract border radius and spacing patterns from `cssCustomProperties`
4. Use `ogImage` or `favicon` for logo URLs

Then call `create-design-system` with the assembled JSON.

### Step 3: Link to a design

```bash
pnpm action update-design --id <designId> --designSystemId <designSystemId>
```

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
