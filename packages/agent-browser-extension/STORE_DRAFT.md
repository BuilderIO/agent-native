# Chrome Web Store draft

## Listing

Name: Agent Native for Chrome

Summary: Capture the page you choose and work with it in Agent Native.

Category: Productivity

The Store item ID is intentionally unset until the first upload creates it.

## Single purpose

Agent Native for Chrome lets a user explicitly attach the current webpage to an
Agent Native conversation, then review work produced from that context.

## Permission justification

- `activeTab` and `scripting`: run one bounded readable-context extraction only
  after the user presses **Capture page**.
- `sidePanel`: keeps the Agent Native conversation beside the webpage.
- `storage`: remembers the configured Dispatch URL and keeps short-lived pairing
  state in session-only extension storage.
- `debugger`: used only by the shared origin-scoped Tier-1 control engine after
  Desktop explicitly assigns a tab. It is not used by Tier-0 capture.
- `nativeMessaging`: connects that shared control engine to Agent Native
  Desktop. If Desktop has not allowlisted the public Store ID, the panel reports
  control unavailable.
- `alarms`: retries the Desktop Native Messaging connection after disconnects.
- `tabs`: revalidates the exact origin of a user-assigned control tab.

The extension has no persistent content script and requests no broad host
permission. Its externally-connectable pairing listener accepts only a
user-configured exact Dispatch origin plus a fresh nonce and expiring one-time
embed path.

## Data handling

On explicit capture, the extension may process the page URL/title, selected
text, visible main text, headings, and bounded HTTP(S) links. It excludes form
values, editable content, hidden text, full DOM markup, cookies, headers,
network bodies, and credentials. Sensitive-looking URL query values are
redacted. Context is sent only to the Dispatch origin the user connected.

LinkedIn's **Draft outreach** action creates a reviewable draft in Dispatch. It
does not send, post, connect, or message on LinkedIn.

## Package

```bash
pnpm --filter @agent-native/agent-browser-extension package
```

Upload the versioned ZIP written to `releases/`.
