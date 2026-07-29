# Permission model

## Page context

- `activeTab`: temporary access after the user invokes the toolbar action.
- `optional_host_permissions`: the panel may request access for one exact
  HTTP(S) site when the user presses **Use page**. This keeps page-aware chat
  working after the side panel remains open across tab changes without granting
  every site at install time.
- `scripting`: injects the packaged one-shot readable-context extractor. There
  is no persistent content script.
- `storage`: stores the Dispatch URL and scoped remote-device credential in
  `storage.local`; pending nonces, embed tickets, page handles, and tab mappings
  use `storage.session`.
- `sidePanel`: keeps Dispatch chat beside the webpage.

## Browser control

- `debugger`: used only by the shared reviewed browser-control engine after an
  opaque page handle resolves to an exact tab and origin. Tier-0 read capture
  never attaches the debugger.
- `nativeMessaging`: connects the shared engine to Agent Native Desktop, the
  preferred control upstream.
- `alarms`: retries Desktop and wakes the direct relay fallback.
- `tabs`: follows the current page, resolves user-shared page handles, and
  revalidates an assigned control tab's exact origin.

When Desktop is connected, the direct relay continues to advertise read and
observation but sets `browser.control` to false. Competing control attachment
fails visibly in the shared service rather than preempting a task.

## Pairing and relay

`externally_connectable` permits HTTPS and loopback Dispatch pages to reach the
pairing listener. The listener still requires an exact configured origin, fresh
nonce, expiring root-relative embed start path, scoped `remoteDevice` descriptor,
and secure `relayBaseUrl`.

The relay device token is distinct from the short-lived chat embed ticket. It
is stored only in extension-local storage and sent only as a bearer credential
to its paired HTTPS relay origin (or explicit loopback development origin).
Cross-origin relay access is requested from the user for that exact origin.
