---
name: embeds
description: Inline, popup, and floating-button embeds — snippet generation and theming.
---

# Embeds

## Modes

- **inline** — iframe embedded in the page
- **popup** — trigger opens modal overlay with iframe
- **element-click / floating-button** — fixed-position trigger anywhere on
  the page

## URL

Embed page: `/:user/:slug/embed` — same Booker, no chrome, theme honored
via query params.

## Snippet

```html
<script src="https://<host>/embed.js" async></script>
<div id="cal-inline-embed"></div>
<script>
  Cal("init", { origin: "https://<host>" });
  Cal("inline", {
    elementOrSelector: "#cal-inline-embed",
    calLink: "my-user/intro",
    config: { theme: "light" }
  });
</script>
```

## Theming

Query params on the embed URL:
- `theme=light|dark`
- `primaryColor=<hex>`
- `locale=en|es|...`
- `timeZone=America/Los_Angeles`

These override the event type's defaults for the embedded session only.

## Message passing

The iframe posts messages to the parent on lifecycle events:
`__cal.init`, `__cal.booking-successful`, `__cal.booking-cancelled`,
`__cal.booking-rescheduled`.
