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
- A usable Dispatch pairing makes the direct relay the canonical control
  upstream for the side-panel session. The extension disconnects or skips Native
  Messaging before advertising relay control.
- If no usable relay pairing and exact relay-origin grant exists, Desktop Native
  Messaging is the fallback. The extension never runs both control upstreams.

## Relay action contract

The extension handles only versioned, lease-bound `computer-operation`
envelopes whose approval hash passes the core supervision parser:

- `browser.read` resolves `target.sessionHandle` and performs Tier-0 bounded
  capture on the active, user-granted page.
- `browser.attach` resolves `target.sessionHandle` locally, then attaches the
  shared `BrowserControlService` under `envelope.runId`.
- `browser.observe`, `browser.click`, `browser.type`, `browser.key`,
  `browser.navigate`, `browser.open-tab`, `browser.scroll`, and
  `browser.stop` use that same reviewed service and lease. `browser.open-tab`
  creates an inactive tab on the assigned exact origin and moves the control
  lease to it without focusing Chrome.

Control observations exclude screenshots from relay results. There is no
arbitrary CDP method, expression, function-call, or `Runtime.evaluate` surface.
The shared service rejects a competing attachment instead of moving an existing
lease. If relay access is removed, active relay leases are stopped before the
Desktop fallback reconnects.

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
