# Design Systems

Design systems store brand identity tokens (colors, fonts, spacing, logos) that are applied to all slides in a deck.

## Data Model

Design systems are stored in the `design_systems` SQL table. Each has a `data` column with JSON tokens:

- `colors`: primary, secondary, accent, background, surface, text, textMuted
- `typography`: headingFont, bodyFont, headingWeight, bodyWeight, headingSizes
- `spacing`: slidePadding, elementGap
- `borders`: radius, accentWidth
- `slideDefaults`: background, labelStyle
- `logos`: array of { url, name, variant }
- `imageStyle`: referenceUrls, styleDescription
- `customCSS`: optional custom CSS

## Creating a Design System

1. User provides brand context (company name, website, assets, notes)
2. `analyze-brand-assets` gathers raw data (extracts CSS, fonts, colors from website)
3. Agent analyzes the data and calls `create-design-system` with extracted tokens
4. The design system is published and becomes available for deck creation

### Source: Figma `.fig` file

When the user uploads a raw Figma local copy (`.fig`), start Builder
design-system indexing with `import-file` instead of treating it like a
document:

```bash
pnpm action import-file --filePath "data/uploads/brand.fig" --format fig
```

The action requires Builder to be connected and returns Builder `projectId`,
`jobId`, `designSystemId`, and `builderUrl`. Builder is the source of truth for
the indexed brand kit, generated docs, and usage guidance.

Do not call `create-design-system` locally from `.fig` uploads. Do not call
`import-document` for `.fig` files; it only handles metadata and will miss the
Builder indexing flow.

## Applying to Slides

When generating slides, replace default values with design system tokens:

- `#00E5FF` -> `colors.accent`
- `Poppins` -> `typography.headingFont` / `typography.bodyFont`
- `#000000` background -> `colors.background`
- `rgba(255,255,255,0.55)` -> `colors.textMuted`

## Tweaks

The Tweaks panel provides live CSS variable overrides:

- Accent color swatches
- Title case (lowercase/Title/UPPER)
- Background warmth

Changes persist to the design system and apply immediately via CSS custom properties.
