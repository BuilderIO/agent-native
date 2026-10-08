# Ready-to-Use Templates

Copy and fill in the bracketed values. `[WRAPPER STYLE]` stands for the deck
contract chosen in "Slide Wrapper" - the inherited `var(--ds-*)` form when a
system is linked, the literal form when none is. It is identical on every
slide. Inside the slide, read the contract directly (`var(--deck-accent)`), not
through another layer of fallbacks; the wrapper has already defined every role.

### Title Slide

```html
<div
  class="fmd-slide"
  style="[WRAPPER STYLE] justify-content: center; align-items: flex-start; gap: 18px;"
>
  <div
    style="font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--deck-accent);"
  >
    [LABEL OR DATE]
  </div>
  <h1
    style="font-size: 56px; font-weight: 750; color: var(--deck-ink); font-family: var(--deck-heading-font); line-height: 1.05; letter-spacing: -0.04em; margin: 0; max-width: 760px;"
  >
    [TITLE]
  </h1>
  <p style="font-size: 20px; color: var(--deck-muted); margin: 4px 0 0;">
    [SUBTITLE OR PRESENTER]
  </p>
</div>
```

### Content or Two-Column Slide

```html
<div
  class="fmd-slide"
  style="[WRAPPER STYLE] justify-content: flex-start; gap: 18px;"
>
  <div
    style="font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--deck-accent);"
  >
    [SECTION LABEL]
  </div>
  <h2
    style="font-size: 34px; font-weight: 750; color: var(--deck-ink); font-family: var(--deck-heading-font); line-height: 1.12; letter-spacing: -0.03em; margin: 0 0 18px;"
  >
    [SLIDE HEADING]
  </h2>
  <div
    style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;"
  >
    <div style="display: flex; flex-direction: column; gap: 14px;">
      <div
        style="border-left: 3px solid var(--deck-accent); padding: 12px 16px; background: var(--deck-surface); border-radius: var(--deck-radius); font-size: 18px; line-height: 1.4;"
      >
        [KEY POINT]
      </div>
      <div
        style="border-left: 3px solid var(--deck-accent); padding: 12px 16px; background: var(--deck-surface); border-radius: var(--deck-radius); font-size: 18px; line-height: 1.4;"
      >
        [KEY POINT]
      </div>
    </div>
    <div
      class="fmd-img-placeholder"
      style="min-height: 220px; border-radius: var(--deck-radius);"
    >
      [VISUAL OR IMAGE DESCRIPTION]
    </div>
  </div>
</div>
```

Use the same wrapper and tokens for section, statement, metrics, and closing
slides, changing only the composition. An image placeholder, metric row,
short rule, or callout should support the message, not fill empty space.

## Image Placeholders

When a slide needs a specific visual, use this div. It renders as a styled
placeholder and can later be replaced with a generated image. Describe the
content the image must show ("Q3 revenue by region, bar chart"), not its role
("hero image"). If type, layout, and color can carry the slide, use no
placeholder:

```html
<div
  class="fmd-img-placeholder"
  style="width: 100%; min-height: 220px; border-radius: var(--deck-radius);"
>
  [Description of what image should show]
</div>
```
