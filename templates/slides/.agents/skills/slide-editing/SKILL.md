---
name: slide-editing
description: How to edit individual slides -- content formatting, HTML styling rules, updating slide content in the database.
---

# Slide Editing

Slides are HTML content stored inside the deck JSON. Each slide's `content` field is a self-contained HTML string that renders at 1920x1080 resolution.

## Slide HTML Structure

Every slide uses this wrapper:

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start;">
  <!-- Slide content here -->
</div>
```

## Styling Rules

All generated slides follow these conventions:

| Element | Style |
|---------|-------|
| Background | `bg-[#000000]` (pure black) |
| Font | `font-family: 'Poppins', sans-serif` on all text |
| Section labels | `font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF` |
| Headings | `font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px` |
| Title slides | `font-size: 54px; font-weight: 900` with `justify-content: center` |
| Bullet points | `&#x25CF;` character (8px, white), gap: 20px, font-size: 22px, color: rgba(255,255,255,0.85) |
| Sub-bullets | `&#x25CB;` (open circle), padding-left: 36px |
| Bold terms | `<strong style="font-weight: 800; color: #fff;">Term</strong>` + description in rgba(255,255,255,0.55) |
| Accent color | `#00E5FF` (cyan) for section labels, emphasis, highlights |

## Updating a Slide

To edit a slide's content:

1. **Get the deck**: `pnpm script get-deck --id=<deckId>`
2. **Parse the JSON**, find the slide by ID
3. **Modify the content** HTML string
4. **Update the deck** via `PUT /api/decks/:id` with the full updated deck JSON

## Image Placeholders

For visual elements (diagrams, charts, photos), use placeholder divs:

```html
<div class="fmd-img-placeholder" style="width: 100%; height: 300px; border-radius: 12px;">
  Description of the image
</div>
```

Never try to recreate complex visuals with raw HTML/CSS. Use placeholders and generate proper images via the image generation flow.

## Slide Layouts

Common layout patterns:

- **Title slide**: Single centered heading, `justify-content: center`
- **Section divider**: Large single word, centered
- **Content**: Section label + heading + bullet list
- **Two-column**: Flex row with `gap: 40px`, text left, image right
- **Table**: CSS grid with alternating row backgrounds
