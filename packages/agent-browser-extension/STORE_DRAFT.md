# Chrome Web Store draft

## Listing

Name: Agent Native for Chrome

Summary: Chat with the page you choose and let Agent Native work alongside you.

Category: Productivity

The Store item ID is intentionally unset until the first upload creates it.

## Single purpose

Agent Native for Chrome places an Agent Native conversation beside the current
webpage. Users can explicitly share bounded page context and, when connected,
let Agent Native operate an assigned tab through an origin-scoped control
session.

## Permission justification

- `activeTab` and `scripting`: run one bounded readable-context extraction after
  an explicit extension gesture.
- `optional_host_permissions`: request one exact site only when the user chooses
  **Use page**, or the exact paired relay origin when enabling browser tools.
- `sidePanel`: keeps the Agent Native conversation beside the webpage.
- `storage`: remembers the Dispatch URL, scoped remote-device credential, and
  session-only pairing/page-handle state.
- `debugger`: powers the reviewed origin-scoped control engine; Tier-0 capture
  never uses it.
- `nativeMessaging`: connects the same engine to Agent Native Desktop.
- `alarms`: retries Desktop and wakes the direct relay fallback.
- `tabs`: follows the selected page, revalidates an assigned control origin,
  and lets an approved control task open an inactive tab on that origin.

There is no persistent content script and no install-time host access. The
externally-connectable listener accepts only the configured Dispatch origin
with a fresh nonce and expiring one-time embed path.

## Data handling

On explicit page sharing, the extension may process the URL/title, selected
text, visible main text, headings, and bounded HTTP(S) links. It excludes form
values, editable content, hidden text, full DOM markup, cookies, headers,
network bodies, and credentials. Sensitive-looking URL query values are
redacted. Context is sent only to the Dispatch conversation the user connected.

A scoped remote-device token may be stored in Chrome extension storage so the
paired relay can poll for approved computer operations. It is
sent only to the paired HTTPS relay origin or an explicit loopback development
origin. A usable paired relay is the sole control upstream for the side-panel
session; Native Messaging is disconnected or skipped. Desktop becomes the
fallback only when no usable paired relay and exact relay-origin grant exists.

## Package

```bash
pnpm --filter @agent-native/agent-browser-extension package
```

Upload the versioned ZIP written to `releases/`.
