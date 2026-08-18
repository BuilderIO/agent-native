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
- `nativeMessaging`: connects the shared engine to Agent Native Desktop only
  when no usable paired relay is available.
- `alarms`: retries Desktop and wakes the direct relay fallback.
- `tabs`: follows the current page, resolves user-shared page handles,
  revalidates an assigned control tab's exact origin, and creates requested
  control tabs with `active: false`.

A usable paired relay is canonical for side-panel browser sessions: the
extension disconnects or skips Native Messaging before advertising relay
control. If a native task is already active, the extension waits for it to stop
instead of preempting it. Removing relay access stops remaining relay leases
before reconnecting the Desktop fallback.

## Pairing and relay

`externally_connectable` permits HTTPS and loopback Dispatch pages to reach the
pairing listener. The listener still requires an exact configured origin, fresh
nonce, expiring root-relative embed start path, scoped `remoteDevice` descriptor,
and secure `relayBaseUrl`.

The relay device token is distinct from the short-lived chat embed ticket. It
is stored only in extension-local storage and sent only as a bearer credential
to its paired HTTPS relay origin (or explicit loopback development origin).
Cross-origin relay access is requested from the user for that exact origin.
