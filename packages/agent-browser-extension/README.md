# Agent Native for Chrome

Public Manifest V3 side-panel shell for attaching an explicitly captured browser
page to a Dispatch conversation.

## MVP behavior

- Clicking the extension action opens the side panel.
- The panel tracks the active tab's title and origin, but never reads page
  content automatically.
- **Capture page** injects a one-shot Tier-0 extractor under `activeTab`. It
  returns one canonical `browser-context.v1` readable projection containing a
  bounded page URL, title, visible main text, selection, semantic blocks, and
  links.
- Hidden content, form values, editable drafts, full DOM, cookies, headers,
  request bodies, and arbitrary JavaScript results are never captured.
- The panel pairs through a top-level
  `/browser-connect?extensionId=…&nonce=…` page. The extension accepts only an
  exact configured Dispatch origin, matching nonce, root-relative one-time
  embed start path, and bounded future expiry. It stores that start path only
  in `chrome.storage.session` and clears it as soon as the iframe reports ready.
- Captured context is staged with an exact-origin, iframe-source, nonce-bound
  `postMessage`. On LinkedIn profile-like URLs, **Draft outreach** submits a
  review-only drafting prompt to Dispatch; the extension never sends or posts
  on LinkedIn.

`debugger` and `nativeMessaging` are declared from the first Store manifest
because Chrome does not support adding `debugger` as an optional permission and
the existing Desktop control transport uses Native Messaging. Tier-0 capture
does not call either API. A separate background adapter runs the shared reviewed
browser-control engine and reports its live connection state in the panel. It
becomes available when Desktop allowlists the public Store extension ID. The
engine has no arbitrary CDP method, expression, function-call, or
`Runtime.evaluate` surface.

## Development

```bash
pnpm --filter @agent-native/agent-browser-extension test
pnpm --filter @agent-native/agent-browser-extension typecheck
pnpm --filter @agent-native/agent-browser-extension build
pnpm --filter @agent-native/agent-browser-extension package
```

Load `dist/` from `chrome://extensions` in Developer mode. No manifest key or
Store item ID is committed; Chrome assigns the public ID when the Store item is
created.
