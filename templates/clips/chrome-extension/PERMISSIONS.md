# Permissions model

This extension ships **activeTab-only**: it deliberately does **not** request the
broad `<all_urls>` host permission, and it has **no declarative `content_scripts`**.

## Why

A declarative content script on `<all_urls>` (and the matching `<all_urls>` host
permission) triggers Chrome Web Store's **broad host permission in-depth review**,
which significantly delays publishing and updates. We avoid that.

## How the overlay gets on the page

When the user clicks the extension and starts a recording, the background service
worker injects the content script into the **launch tab** with
`chrome.scripting.executeScript({ target: { tabId }, files: ["assets/content-script.js"] })`.
That call is authorized by the **`activeTab`** permission, which Chrome grants for
the tab that was active when the user invoked the extension — no broad host access
needed. The content script then mounts the overlay iframes (countdown, camera
bubble, controls). `web_accessible_resources` stays `<all_urls>` — that is **not**
a host permission and does not trigger the review.

Declared permissions: `activeTab`, `debugger`, `offscreen`, `scripting`,
`storage`. Host permissions: only the configured Clips app + `forms.agent-native.com`

- `localhost`/`127.0.0.1`.

## What this costs

- The overlay (countdown, camera bubble, recording controls) lives **only on the
  tab the recording was launched from**. It does **not** follow the user to other
  tabs during a full-screen or multi-tab recording.
- **Recording itself is unaffected.** Capture runs in the offscreen document via
  `getDisplayMedia`, independent of any tab's content script — full-screen,
  window, and other-tab content are all still captured normally. Only the on-page
  _overlay UI_ is scoped to the launch tab.

## Re-enabling cross-tab follow

The full cross-tab behavior is gated behind a single flag in
`src/background.ts`:

```ts
const CROSS_TAB_FOLLOW = false; // flip to true
```

Flipping it to `true` restores the all-tabs broadcast in `broadcastMount()` /
`broadcastUnmount()` and the `chrome.tabs.onActivated` follow listener. To make
that actually work you must **also** restore broad host access so the worker can
inject into arbitrary tabs. Two options:

1. **Static (simplest, but in-depth review):** re-add to `public/manifest.json`:
   - `"<all_urls>"` in `host_permissions`, and
   - the `content_scripts` block:
     ```json
     "content_scripts": [
       {
         "matches": ["<all_urls>"],
         "js": ["assets/content-script.js"],
         "run_at": "document_idle",
         "all_frames": false
       }
     ],
     ```

2. **Optional (preferred — keeps the default install lean):** declare
   `"optional_host_permissions": ["<all_urls>"]` in the manifest and call
   `chrome.permissions.request({ origins: ["<all_urls>"] })` at runtime (e.g. from
   a settings toggle) before enabling follow. The user grants the broad access
   explicitly, only if they want cross-tab overlays.

After any change: `pnpm build`, then re-zip `dist/`.
