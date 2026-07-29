# Permission model

## User-facing capture

- `activeTab`: temporary access only after the user invokes the extension.
- `scripting`: injects the one-shot readable-context extractor after the user
  presses **Capture page**. There is no persistent content script.
- `storage`: keeps the configured Dispatch URL in `storage.local`; pending
  nonces and short-lived one-time embed start paths use `storage.session`.
- `sidePanel`: hosts the persistent Agent Native chat surface.

## Separate Tier-1 control transport

- `debugger`: used only by the shared reviewed Tier-1 browser-control engine
  after Desktop assigns a tab and exact allowed origin. Chrome does not support
  this as an optional permission. Tier-0 never attaches the debugger.
- `nativeMessaging`: connects the shared engine to the existing Agent Native
  Desktop transport. The panel reports the real connection state; control stays
  unavailable until Desktop allowlists the public Store ID.
- `alarms`: retries the Native Messaging connection after Desktop disconnects.
- `tabs`: lets the shared control engine revalidate the assigned tab's exact
  origin before debugger attachment and every mutation.

## Pairing surface

`externally_connectable` permits HTTPS and loopback pages to reach the pairing
listener because the Dispatch URL is configurable. The listener still fails
closed unless all of these match:

1. `sender.origin` equals the exact user-configured Dispatch origin.
2. The message has the strict `browser-chat.session.v1` shape.
3. Its nonce matches a pending, unexpired user-initiated pairing.
4. Its `dispatchOrigin` matches both the sender and configured origin.
5. Its `startPath` is root-relative on that origin.
6. Its `expiresAt` is in the future and within the short pairing window.

The extension never receives or stores a bearer token.
