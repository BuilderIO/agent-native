# Permissions model

This extension ships **cross-tab follow for recording overlays**: it declares
the broad `<all_urls>` host permission and a matching declarative content script
so the camera bubble and controls can survive tab switches and navigations.

## Why

A declarative content script on `<all_urls>` (and the matching `<all_urls>` host
permission) triggers Chrome Web Store's **broad host permission in-depth review**,
which significantly delays publishing and updates. We take that review path only
for the release that re-enables cross-tab follow.

The declarative content scripts are scoped to:

- `https://github.com/*` for Clips link previews in GitHub issue/PR markdown.
- `<all_urls>` for the recording overlay host that keeps the face bubble and
  controls mounted across pages while a recording is active.

The GitHub preview script adds a narrow host disclosure, while the overlay host
is the broad review boundary.

## How the overlay gets on the page

When the user clicks the extension and starts a recording, the background service
worker mounts the overlay on the active tab and keeps rebroadcasting it as the
active tab changes. The content script then mounts the overlay iframes
(countdown, camera bubble, controls). `web_accessible_resources` stays
`<all_urls>` — that is **not** a host permission and does not trigger the review.

Declared permissions: `activeTab`, `debugger`, `offscreen`, `scripting`,
`storage`. Host permissions: the configured Clips app + `forms.agent-native.com`

- `localhost`/`127.0.0.1`.
- `https://github.com/*` is content-script scoped for link previews.
- `<all_urls>` is the overlay host required for cross-tab follow.

## What this costs

- The overlay (countdown, camera bubble, recording controls) follows the user
  across tabs while a recording is active. Navigating to a new page or tab keeps
  the face bubble and controls mounted once the page loads.
- **Recording itself is unaffected.** Capture runs in the offscreen document via
  `getDisplayMedia`, independent of any tab's content script — full-screen,
  window, and other-tab content are all still captured normally. Only the on-page
  _overlay UI_ is scoped to the launch tab.

## Re-enabling cross-tab follow

The full cross-tab behavior is gated behind a single flag in `src/background.ts`:

```ts
const CROSS_TAB_FOLLOW = true;
```

That keeps the all-tabs broadcast in `broadcastMount()` / `broadcastUnmount()`
and the `chrome.tabs.onActivated` follow listener live. The manifest must keep
the broad host permission and the `<all_urls>` declarative content script in
place so the worker can inject into arbitrary tabs.

After any change: `pnpm build`, then re-zip `dist/`.
