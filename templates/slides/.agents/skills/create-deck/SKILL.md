---
name: create-deck
description: How to create a new deck with slides from scratch. Read this before creating any deck. Contains exact HTML templates for every slide layout — no codebase exploration needed.
---

# Creating a Deck

**Do not explore the codebase.** Everything you need is here.

## Workflow

1. Plan the slides (title, section dividers, content slides)
2. Call `create-deck --title "..." --slides '[]'` to create an empty deck
3. Navigate to the new deck
4. Call `add-slide` once per slide in slide order, waiting for each result
   before adding the next slide

Do not create multiple slides in parallel for the same deck. Do not spawn
sub-agents to write into the same deck at the same time. Sub-agents may research
or draft slide copy, but one writer should call `add-slide` sequentially so the
editor stays stable and the user can watch progress.

If the user provides a Google Docs URL as source material, call
`import-google-doc --url <url>` first and build from the returned text. If the
action cannot read a private document, the user can connect Google Docs and
choose the file through the picker, or share the Doc with the configured service
account. Relay the action's exact access instructions instead of generating from
the URL alone.

```bash
pnpm action create-deck --title "My Deck" --slides '[]'
```

Then navigate:
```bash
pnpm action navigate --deckId=<id from create-deck output>
```

Then add slides one by one:

```bash
pnpm action add-slide --deckId=<id> --layout title --content "..."
pnpm action add-slide --deckId=<id> --layout content --content "..."
```

## Slide Wrapper

Every slide's `content` must use this exact outer div:

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <!-- slide content here -->
</div>
```

Background (`var(--ds-bg)`) — set by the renderer, not the slide HTML.

## Ready-to-Use Templates

Copy and fill in the bracketed values. Use `\` to escape quotes inside the JSON string.

---

### Title Slide

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 24px;">[LABEL OR DATE]</div>
  <h1 style="font-size: 64px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;">[TITLE]</h1>
  <p style="font-size: 22px; color: var(--ds-text-muted); margin: 0;">[SUBTITLE OR PRESENTER]</p>
</div>
```

---

### Section Divider

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 20px;">[SECTION NUMBER, e.g. 01]</div>
  <h2 style="font-size: 72px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.05; letter-spacing: -2px; margin: 0;">[SECTION TITLE]</h2>
</div>
```

---

### Content Slide (bullets)

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 16px;">[SECTION LABEL]</div>
  <h2 style="font-size: 40px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;">[SLIDE HEADING]</h2>
  <div style="display: flex; flex-direction: column; gap: 20px;">
    <div style="display: flex; align-items: flex-start; gap: 16px;">
      <span style="font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
      <span style="font-size: 22px; color: var(--ds-text); line-height: 1.5;">[BULLET TEXT]</span>
    </div>
    <div style="display: flex; align-items: flex-start; gap: 16px;">
      <span style="font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
      <span style="font-size: 22px; color: var(--ds-text); line-height: 1.5;">[BULLET TEXT]</span>
    </div>
    <div style="display: flex; align-items: flex-start; gap: 16px;">
      <span style="font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
      <span style="font-size: 22px; color: var(--ds-text); line-height: 1.5;">[BULLET TEXT]</span>
    </div>
  </div>
</div>
```

---

### Two-Column Slide (text left, image/visual right)

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 16px;">[SECTION LABEL]</div>
  <h2 style="font-size: 40px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.15; letter-spacing: -1px; margin: 0 0 40px 0;">[HEADING]</h2>
  <div style="display: flex; gap: 60px; flex: 1;">
    <div style="flex: 1; display: flex; flex-direction: column; gap: 20px;">
      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <span style="font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
        <span style="font-size: 20px; color: var(--ds-text); line-height: 1.5;">[BULLET]</span>
      </div>
      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <span style="font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
        <span style="font-size: 20px; color: var(--ds-text); line-height: 1.5;">[BULLET]</span>
      </div>
    </div>
    <div class="fmd-img-placeholder" style="flex: 1; border-radius: 12px; min-height: 300px;">[IMAGE DESCRIPTION]</div>
  </div>
</div>
```

---

### Statement / Quote Slide

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="width: 60px; height: 4px; background: var(--ds-accent); margin-bottom: 40px;"></div>
  <p style="font-size: 48px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.2; letter-spacing: -1px; margin: 0 0 32px 0;">&ldquo;[STATEMENT OR QUOTE]&rdquo;</p>
  <p style="font-size: 18px; color: var(--ds-text-muted); margin: 0;">[SOURCE OR ATTRIBUTION]</p>
</div>
```

---

### Metrics / Stats Slide

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 16px;">[SECTION LABEL]</div>
  <h2 style="font-size: 40px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.15; letter-spacing: -1px; margin: 0 0 60px 0;">[HEADING]</h2>
  <div style="display: flex; gap: 60px;">
    <div style="flex: 1;">
      <div style="font-size: 72px; font-weight: var(--ds-heading-weight); color: var(--ds-accent); letter-spacing: -2px; line-height: 1;">[METRIC]</div>
      <div style="font-size: 18px; color: var(--ds-text-muted); margin-top: 12px;">[LABEL]</div>
    </div>
    <div style="flex: 1;">
      <div style="font-size: 72px; font-weight: var(--ds-heading-weight); color: var(--ds-accent); letter-spacing: -2px; line-height: 1;">[METRIC]</div>
      <div style="font-size: 18px; color: var(--ds-text-muted); margin-top: 12px;">[LABEL]</div>
    </div>
    <div style="flex: 1;">
      <div style="font-size: 72px; font-weight: var(--ds-heading-weight); color: var(--ds-accent); letter-spacing: -2px; line-height: 1;">[METRIC]</div>
      <div style="font-size: 18px; color: var(--ds-text-muted); margin-top: 12px;">[LABEL]</div>
    </div>
  </div>
</div>
```

---

### Closing / CTA Slide

```html
<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: var(--ds-heading-font), sans-serif;">
  <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 24px;">[LABEL, e.g. GET STARTED]</div>
  <h2 style="font-size: 64px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.1; letter-spacing: -2px; margin: 0 0 32px 0;">[CLOSING STATEMENT]</h2>
  <p style="font-size: 22px; color: var(--ds-text-muted); margin: 0;">[CONTACT OR NEXT STEP]</p>
</div>
```

## Image Placeholders

When a slide needs a visual, use this div — it renders as a styled placeholder and can later be replaced with a generated image:

```html
<div class="fmd-img-placeholder" style="width: 100%; height: 300px; border-radius: 12px;">[Description of what image should show]</div>
```

## Bold Terms with Description

For definition-style bullets:

```html
<div style="display: flex; align-items: flex-start; gap: 16px;">
  <span style="font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
  <span style="font-size: 22px; line-height: 1.5;">
    <strong style="font-weight: var(--ds-heading-weight); color: var(--ds-text);">[Term]</strong>
    <span style="color: var(--ds-text-muted);"> — [description]</span>
  </span>
</div>
```

## Bulk Replacement Only

Use a non-empty `create-deck --slides '[...]'` payload only for imports or an
intentional atomic bulk replacement. For normal AI-generated decks, use the
empty-deck plus sequential `add-slide` workflow above.

A bulk payload looks like this:

```bash
pnpm action create-deck --title "Product Vision 2025" --slides '[
  {
    "id": "slide-1",
    "layout": "title",
    "content": "<div class=\"fmd-slide\" style=\"padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: var(--ds-heading-font), sans-serif;\"><div style=\"font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 24px;\">ANNUAL STRATEGY</div><h1 style=\"font-size: 64px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;\">Product Vision 2025</h1><p style=\"font-size: 22px; color: var(--ds-text-muted); margin: 0;\">Engineering Leadership — Q1 2025</p></div>"
  },
  {
    "id": "slide-2",
    "layout": "content",
    "content": "<div class=\"fmd-slide\" style=\"padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: var(--ds-heading-font), sans-serif;\"><div style=\"font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--ds-accent); margin-bottom: 16px;\">OVERVIEW</div><h2 style=\"font-size: 40px; font-weight: var(--ds-heading-weight); color: var(--ds-text); line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;\">Three Core Priorities</h2><div style=\"display: flex; flex-direction: column; gap: 20px;\"><div style=\"display: flex; align-items: flex-start; gap: 16px;\"><span style=\"font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;\">&#x25CF;</span><span style=\"font-size: 22px; color: var(--ds-text); line-height: 1.5;\">Ship the agent platform by March</span></div><div style=\"display: flex; align-items: flex-start; gap: 16px;\"><span style=\"font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;\">&#x25CF;</span><span style=\"font-size: 22px; color: var(--ds-text); line-height: 1.5;\">Grow to 10k active teams</span></div><div style=\"display: flex; align-items: flex-start; gap: 16px;\"><span style=\"font-size: 8px; color: var(--ds-text); margin-top: 8px; flex-shrink: 0;\">&#x25CF;</span><span style=\"font-size: 22px; color: var(--ds-text); line-height: 1.5;\">Reduce time-to-value to under 5 minutes</span></div></div></div>"
  }
]'
```

After creating, navigate to the deck:
```bash
pnpm action navigate --deckId=<id>
```
