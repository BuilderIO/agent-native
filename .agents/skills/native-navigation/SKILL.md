---
name: native-navigation
description: >-
  Use when adding or reviewing UI navigation so internal routes preserve
  normal SPA behavior plus Cmd/Ctrl-click and middle-click new-tab semantics.
scope: dev
---

# Native Navigation

## Rule

Pure navigation must render a real React Router `<Link>` for same-SPA routes,
a native `<a href>` for external/public or explicit new-tab destinations, or a
shadcn `Button asChild` wrapper around one. Do not use a button whose only job
is to call `navigate()`, `window.open()`, or `window.location`.

## Why

Browser modifier-click, middle-click, keyboard activation, accessibility, and
normal client-side routing come from real links. Imperative JavaScript
navigation hides the destination and blocks those browser semantics.

## How

```tsx
import { Link } from "react-router";

<Link to={`/items/${item.id}`}>...</Link>

<Button asChild>
  <Link to="/settings">Settings</Link>
</Button>

<a href={previewUrl} target="_blank" rel="noopener noreferrer">
  Preview
</a>
```

- Use `Link` for same-SPA internal routes.
- Use `<a>` when the URL is external, crosses an app/public boundary, is an
  auth or sign-in destination, or intentionally opens in a new tab.
- Preserve query strings and hashes in `to` or `href`.
- For cards with nested actions, link only the non-interactive card region or
  use a transparent Link overlay; never nest links or buttons.
- If selection mode changes click behavior, prevent default only for an
  unmodified primary click and preserve modified clicks.

Keep imperative navigation for post-mutation redirects, OAuth and popup flows,
downloads, media/blob URLs, playback, keyboard shortcuts, and stateful tabs.

## Review

Search for `onClick={() => navigate`, `window.open`, `window.location`,
`onAuxClick`, and buttons whose only purpose is routing. For each candidate,
confirm whether it is pure navigation or a stateful workflow before changing
it.

Verify the rendered DOM exposes an `href`, then test normal click, Cmd/Ctrl-click,
middle-click, keyboard Enter, and nested controls where applicable. Run oxfmt
and focused app tests or typechecks for the touched package.

## Related Skills

- `client-side-routing`
- `frontend-design`
- `shadcn-ui`
