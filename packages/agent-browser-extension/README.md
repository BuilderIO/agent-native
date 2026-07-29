# Agent Native for Chrome

Public Manifest V3 side panel for page-aware Agent Native chat and
origin-scoped browser control.

## Product behavior

- Dispatch chat is the primary surface. The packaged side panel owns Chrome
  APIs and embeds a short-lived, nonce-bound Dispatch chat session.
- The compact page bar follows the active tab without reading it. **Use page**
  requests access for that exact site, captures one bounded
  `browser-context.v1` readable projection, and stages an opaque
  `browserSession` handle with the context.
- The handle maps to the tab only inside `chrome.storage.session`. Cross-origin
  navigation invalidates it, and neither chat nor Dispatch receives a Chrome
  tab id.
- Hidden content, form values, editable drafts, full DOM, cookies, headers,
  request bodies, and arbitrary JavaScript results are never captured.
- Desktop Native Messaging is the preferred browser-control upstream. When
  Desktop is absent, the extension can use the scoped remote-device credential
  delivered through Dispatch pairing to poll the Agent Native relay directly.
- The direct relay always advertises `browser.observe`. It advertises
  `browser.control` only while Native Messaging is disconnected, so one
  upstream owns mutations.

## Relay action contract

The extension handles only versioned, lease-bound `computer-operation`
envelopes whose approval hash passes the core supervision parser:

- `browser.read` resolves `target.sessionHandle` and performs Tier-0 bounded
  capture on the active, user-granted page.
- `browser.attach` resolves `target.sessionHandle` locally, then attaches the
  shared `BrowserControlService` under `envelope.runId`.
- `browser.observe`, `browser.click`, `browser.type`, `browser.key`,
  `browser.navigate`, `browser.scroll`, and `browser.stop` use that same
  reviewed service and lease.

Control observations exclude screenshots from relay results. There is no
arbitrary CDP method, expression, function-call, or `Runtime.evaluate` surface.

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
