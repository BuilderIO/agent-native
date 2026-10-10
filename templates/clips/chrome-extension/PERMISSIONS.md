# Permissions model

This file explains each declared permission and host in this build, and the two
behaviors that reach the most pages: the broad `<all_urls>` host permission with
its all-site content scripts, and the debugger scope. Sources:
`public/manifest.json`, `src/background.ts`, `src/debugger-scope.ts`, and
`templates/clips/shared/browser-diagnostics.ts`.

## Declarations

| Declaration                                                                 | Used for                                                                  | When                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------- |
| `activeTab`                                                                 | Start a recording from the tab the user clicks                            | Toolbar click                |
| `debugger`                                                                  | Console, exception, and fetch/XHR metadata for up to five tabs            | Recording, developer logs on |
| `scripting`                                                                 | Resource-timing lookback reads on attached tabs; content-script injection | Recording                    |
| `offscreen`                                                                 | Screen, window, camera, and microphone capture                            | Recording                    |
| `clipboardWrite`                                                            | Copy the Clips link when a recording finishes                             | Recording completion         |
| `downloads`                                                                 | Local copy of a recording if finishing its upload fails                   | Failure path only            |
| `storage`                                                                   | Settings and in-progress recording state                                  | Always                       |
| `https://clips.agent-native.com/*`, `https://beta.clips.agent-native.com/*` | Sign-in, uploads, and diagnostics for the Clips app                       | Recording                    |
| `https://forms.agent-native.com/*`                                          | Popup feedback form                                                       | When the user sends feedback |
| `http://localhost/*`, `http://127.0.0.1/*`                                  | Local Clips instances                                                     | Development                  |
| `<all_urls>`                                                                | See [Broad host permission](#broad-host-permission-all_urls)              | See below                    |
| Content scripts on `<all_urls>`                                             | See [Broad host permission](#broad-host-permission-all_urls)              | Every page                   |
| Content script on GitHub, Atlassian, and Jira hosts                         | Clips link previews (`github-preview-content.js`)                         | Those hosts only             |

## Broad host permission: `<all_urls>`

`<all_urls>` is needed in this build for three reasons:

1. The Clips app URL is a setting. `readForm` in `src/options.ts` accepts any
   `http` or `https` origin, so the service worker and popup must be able to
   reach whichever origin is configured.
2. `scripting.executeScript` runs in attached debugger tabs, which need not be
   the active tab. `activeTab` covers only the tab the user clicked.
3. The all-site content scripts below run on every page.

Content scripts on `<all_urls>` (manifest `content_scripts`):

- `assets/content-history-bridge.js`, world `MAIN`, `document_start`. Wraps
  `history.pushState` and `history.replaceState` to notice in-page navigations.
  The isolated script forwards them only while a recording is active.
- `assets/content-script.js`, `document_idle`. Hosts the recording overlay. While
  a recording is active, it reports click, input, scroll, and navigation events
  as element descriptors (tag, plus id, `data-testid`, or name when present) and
  sanitized URLs. It does not send typed text or input values.

## Cross-tab overlay (`CROSS_TAB_FOLLOW`)

`src/background.ts` declares `const CROSS_TAB_FOLLOW: boolean = true;`. This is
the value in this build (checked 2026-10-10).

With `true`:

- `broadcastMount()` and `broadcastUnmount()` send to every open tab
  (`chrome.tabs.query({})`).
- The `chrome.tabs.onActivated` listener mounts the overlay on the tab the user
  switches to during a recording.
- The start tab remounts the overlay after navigation.

With `false`:

- Broadcasts go only to the start tab.
- The `onActivated` listener returns early.
- The start tab still remounts the overlay after navigation.

The overlay iframes load from `src/overlay.html`, which is in
`web_accessible_resources` for `<all_urls>`. That entry does not grant host
access.

Changing the flag does not change the manifest. `<all_urls>` stays declared
either way, because the debugger-tab lookback and content-script injection need
it.

Capture is independent of the overlay. Screen, window, and camera capture run in
the offscreen document (`getDisplayMedia` / `getUserMedia`), so the captured media
does not depend on any tab's content script.

## Debugger scope

The debugger attaches when a recording starts, if developer logs are on
(`includeDeveloperLogs`, default `true`), to:

- the tab the recording started from;
- tabs active in the last 10 minutes, most recent first (`RECENT_TAB_WINDOW_MS`);
- tabs the user switches to while recording.

The cap is `MAX_DEBUGGED_TABS = 5` (`src/debugger-scope.ts`). Over the cap, the
least recently active tab other than the focused one is detached. Its logs so far
stay in the recording.

Attached tabs are detached when the recording stops or is cancelled
(`stopRecording` / `cancelRecording`, through `deleteSession` and
`detachSession`).

The extension enables the `Runtime`, `Log`, and `Network` debugger domains.
`Network.enable` is called with `maxTotalBufferSize`, `maxResourceBufferSize`, and
`maxPostDataSize` all set to `0`. The debugger therefore does not collect request
or response bodies.

When developer logs are off, the debugger does not attach.

## Lookback

- Lookback covers up to 30 seconds before the recording started
  (`BROWSER_DIAGNOSTIC_LOOKBACK_MS = 30_000`, `templates/clips/shared/browser-diagnostics.ts`).
- Console lookback comes from the page's own console history.
- Network lookback comes from the page's Performance resource timing entries,
  read with `scripting` on each attached tab. It has URL, status, duration, and
  request type. It has no HTTP method, so the method is recorded as `UNKNOWN`. It
  has no headers or bodies.
- The page's own history limits how far back lookback reaches. The extension
  cannot see entries the page has already discarded.

## Other permissions

- `clipboardWrite`: when a recording completes, the offscreen document writes the
  Clips link with `navigator.clipboard.writeText`.
- `downloads`: `chrome.downloads.download` with `saveAs: false`, called only on
  the path where finishing the upload fails. Cancelled recordings, recordings too
  large to buffer, and very small recordings are not saved.
- `offscreen`: hosts the capture document.
- `storage`: settings (`clipsBaseUrl`, `captureSurface`, `includeCamera`,
  `includeMicrophone`, `includeDeveloperLogs`, and device IDs) in `storage.sync`.
  In-progress recording state is kept in `storage.session` and `storage.local`.

## Host permissions

- `https://clips.agent-native.com/*` and `https://beta.clips.agent-native.com/*`:
  the default and beta Clips apps.
- `https://forms.agent-native.com/*`: the popup feedback form. The popup loads
  the form schema from this host and posts feedback to it (`FEEDBACK_URL` in
  `src/popup.ts`).
- `http://localhost/*` and `http://127.0.0.1/*`: local Clips instances.
- Any other configured Clips origin is covered by `<all_urls>`.

## Chrome Web Store review

Google's review documentation says broad host permissions such as `<all_urls>`
lengthen review, and that each permission is checked for necessity:
https://developer.chrome.com/docs/webstore/review-process

The "in-depth review" dashboard banner that some third-party guides describe is
not documented by Google. This file does not rely on it.

## After a change

Run `pnpm package` in `templates/clips/chrome-extension`. It runs `pnpm build`
and then the packaging script.
