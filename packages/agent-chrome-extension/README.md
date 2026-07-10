# Agent-Native Browser Control

The bundled manifest key fixes the extension id at
`oflpdgfpegnhakjociddiffecjnbnnad`, so the desktop native-host manifest can
grant access to one exact extension origin instead of a wildcard.

This private Manifest V3 extension is the Chrome-side capability adapter for the
Agent-Native desktop app. It does not accept messages from web pages and it has
no arbitrary JavaScript evaluation command.

## Native host contract

The desktop app registers the native messaging host
`com.agent_native.dispatch`, restricted by its native-host manifest to this
extension's generated Chrome extension origin. The host sends JSON requests:

```json
{
  "id": "req-example",
  "taskId": "task-example",
  "command": {
    "type": "attach",
    "tabId": 42,
    "allowedOrigins": ["https://example.com"]
  }
}
```

A task must attach a tab with one or more exact HTTP(S) origins before it can
observe or mutate it. Only one task can own a tab. Attachments are detached when
the desktop native port disconnects, the tab leaves its allowed origins, Chrome
detaches the debugger, or the host sends `detach` / `stop`.
Emergency stop also releases injected mouse buttons and modifier keys before it
detaches the debugger.

Supported commands are `attach`, `detach`, `stop`, `observe`, `click`, `type`,
`key`, `navigate`, and `scroll`. `observe` returns a bounded, simplified Chrome
Accessibility tree and an optional viewport JPEG. Click and type targets are
`backendNodeId` values from that tree. Navigation is restricted to the task's
exact allowed-origin set.

The native port sends a heartbeat every 20 seconds. Chrome alarms retry the
connection after a native-host disconnect, while the disconnect itself first
triggers an emergency detach of every controlled tab.

## Security boundaries

- No content script, externally connectable page, `eval`, or CDP
  `Runtime.evaluate` surface exists.
- Every mutation revalidates the task, tab, and current origin immediately
  before input is dispatched.
- Main-frame and tab URL changes are monitored and fail closed by detaching.
- The `tabs` permission is required because origin validation reads the assigned
  tab's URL before debugger attachment and again before every mutation. Using
  broad `<all_urls>` host access would expose more page access than this bridge
  needs.
- Requests, text, coordinates, node ids, origin counts, and observation sizes
  are bounded by `src/policy.ts`.
- Credentials in URLs and non-HTTP(S) schemes are rejected.
- The extension stores only ephemeral task/tab/origin bindings in
  `chrome.storage.session`.
