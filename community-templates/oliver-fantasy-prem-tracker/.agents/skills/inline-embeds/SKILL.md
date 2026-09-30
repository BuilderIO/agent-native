---
name: inline-embeds
description: >-
  How to render interactive previews of app screens inline in agent chat via
  sandboxed iframes. Covers the `embed` fence syntax, the `postNavigate` pop-out
  helper, and when to prefer an embed over prose / a static image.
---

# Inline Embeds

The chat renderer lets you embed a sandboxed iframe pointing at any same-origin
route of this app, rendered inline with your reply. Use this when a live,
interactive preview communicates more than prose or a static screenshot — a
chart, an email thread, a slide, a form, a ticket.

## The `embed` fence

Emit a fenced code block with the language `embed`:

````
```embed
src: /email?id=msg_123
aspect: 4/3
title: Re: Q4 planning
```
````

Keys:

| Key      | Required | Notes                                                              |
| -------- | -------- | ------------------------------------------------------------------ |
| `src`    | yes      | Same-origin path beginning with `/`. Cross-origin URLs are blocked |
| `aspect` | no       | `16/9` (default), `4/3`, `3/2`, `2/1`, `21/9`, `1/1`               |
| `title`  | no       | Accessible label + hover tooltip                                   |
| `height` | no       | Fixed pixel height when aspect ratio doesn't fit                   |

The rendered iframe is sandboxed (`allow-scripts allow-same-origin allow-forms
allow-popups`) and `referrerpolicy="same-origin"`. The browser enforces that
the iframe can't navigate the parent window.

## When to reach for an embed

- A chart or visualization that benefits from tooltips / hover.
- A detail view the user might want to scan (email, ticket, event, slide).
- Anything where "here's a link to it" would force an extra click.

**Don't** embed when plain prose, a bulleted list, or a small table is enough.
**Don't** embed external sites — the renderer blocks cross-origin URLs.

## "Open in main window" button — `postNavigate`

Every embed route should include a small "Open" button so the user can pop the
view out of the chat and into the full app. Import the helper from
`@agent-native/core/client`:

```tsx
import { postNavigate, isInAgentEmbed } from "@agent-native/core/client";

export function OpenButton({ path }: { path: string }) {
  if (!isInAgentEmbed()) return null;
  return (
    <button onClick={() => postNavigate(path)}>Open</button>
  );
}
```

`postNavigate` sends a `postMessage` to the parent chat window. The chat
renderer validates the message is same-origin, same-iframe, and the path is
relative, then updates the parent URL via `history.pushState` so react-router
navigates without a page reload.

When the page is loaded directly (not in an iframe), `postNavigate` falls back
to a same-window navigation, so the button works both ways.

## Adding an embed route to a template

1. Create a chromeless route (e.g. `app/routes/email.tsx`) that renders the
   detail view without the app shell.
2. Mark the route path as bare in `app/components/layout/Layout.tsx` so the
   sidebar / header don't render inside the iframe.
3. Render the existing detail component with a transparent background so it
   blends into the chat theme.
4. Include an `<OpenButton>` that calls `postNavigate("/path/to/detail")`.
5. Document the embed URL in this template's `AGENTS.md` so the agent knows
   what's embeddable.

The framework-level fence renderer and security enforcement apply
automatically — no per-template wiring beyond the route and layout bypass.
