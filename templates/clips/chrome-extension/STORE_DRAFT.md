# Chrome Web Store Draft

## Listing

Name: Agent-Native Clips

Chrome Web Store item ID: `baoipacpchggcdigagnajakiidcgcffn`

Chrome Web Store URL: `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`

Summary: Start Clips recordings from Chrome with optional redacted console and network diagnostics.

Category: Productivity

Description:

Agent-Native Clips lets you start a Clips recording from the Chrome toolbar and optionally attach browser diagnostics from up to five tabs: the tab where you started, tabs you used in the last 10 minutes, and tabs you switch to during the recording.

Use it to:

- Record the current tab, a window, your full screen, or camera-only video.
- Include your camera bubble and microphone through the Clips recorder.
- Optionally capture redacted console logs and fetch/XHR request metadata from those tabs.
- Keep browser recording permissions explicit: Chrome still asks before screen, camera, or microphone capture starts.

Diagnostics are bounded and redacted before they are saved. They can include up to 30 seconds from before the recording started, when the page still holds that history. Clips does not collect request or response bodies, request headers, cookies, authorization headers, or full query values.

## Permission Justification

- `activeTab`: grants access to the tab the user clicks the toolbar action on, so a recording can start from that tab.
- `debugger`: attaches Chrome's debugger to up to five tabs while a recording is active and developer logs are on: the tab the recording started from, tabs used in the last 10 minutes (most recent first), and tabs the user switches to during the recording. If more than five are attached, the least recently active tab other than the focused one is detached. All attached tabs are detached when the recording stops or is cancelled. It reads console messages, JavaScript exceptions, and fetch/XHR metadata (method, URL, status, timing, failure). It does not read or buffer request or response bodies.
- `scripting`: runs `chrome.scripting.executeScript` for two purposes. It reads the Performance resource timing entries of each debugger-attached tab to add fetch/XHR lookback from before the recording started (URL, status, duration, and request type only). It also injects the extension's content scripts into a tab when the overlay message does not reach it. Attached tabs are not necessarily the active tab, so this needs host access that `activeTab` does not provide.
- `offscreen`: runs an offscreen document that performs screen, window, and camera/microphone capture with `getDisplayMedia` and `getUserMedia`, which a service worker cannot call directly.
- `clipboardWrite`: copies the Clips link to a recording to the clipboard when that recording finishes.
- `downloads`: saves a local copy of a recording to the Downloads folder only when finishing its upload fails, so the recording is not lost. Cancelled recordings, recordings too large to buffer locally, and very small recordings are not saved.
- `storage`: remembers settings (Clips app URL, capture source, camera and microphone toggles, developer-log preference, selected devices) and in-progress recording state.
- Host `https://clips.agent-native.com/*` and `https://beta.clips.agent-native.com/*`: the Clips app the extension signs in to and uploads recordings and diagnostics to.
- Host `https://forms.agent-native.com/*`: the popup's feedback form, which loads its schema and submits feedback there.
- Hosts `http://localhost/*` and `http://127.0.0.1/*`: local Clips instances used for development.
- Host `<all_urls>`: the Clips app URL is a setting and can be any http or https origin, so the extension must be able to reach it. `scripting` also runs in attached tabs that may not be active. The all-site content scripts below run on every page.
- Content scripts on all sites (`<all_urls>`):
  - The history bridge runs in the page's own JavaScript context at document start. It wraps `history.pushState` and `history.replaceState` to notice in-page navigations. The extension is told about them only while a recording is active.
  - The overlay content script mounts the recording overlay (countdown, camera bubble, recording controls). While a recording is active, the overlay follows the user across open tabs. It also reports clicks, input, scroll, and navigation to the extension as element descriptors (tag, plus id, `data-testid`, or name when present) and sanitized URLs. It does not send typed text or input values.
- Content script on GitHub, Atlassian, and Jira hosts: `github-preview-content.js` shows link previews for Clips recordings in issue, PR, and Jira markdown.

## Privacy Notes

- Nothing is captured until the user clicks the toolbar button and starts a recording. Between recordings, the content scripts do not send page activity to the extension.
- Diagnostics come only from up to five tabs during a recording. Other tabs are not attached.
- Developer logs are on by default. They can be turned off on the extension's settings page (not the popup). When they are off, the debugger is not attached.
- Network data is limited to fetch/XHR metadata and redacted URLs. Lookback network entries have no HTTP method, so their method is recorded as `UNKNOWN`. Headers and bodies are never captured.
- Console and network entries are redacted before upload, and each records the tab it came from.
- Diagnostics are sent only to the configured Clips app, after the user starts and finishes a recording.

## Review Notes

The extension opens `https://clips.agent-native.com/record` by default. The settings page can point it at any http or https Clips instance, including a localhost instance for development.

Broad host access (`<all_urls>`) and the all-site content scripts are described under Permission Justification. The debugger is limited to up to five tabs during a recording.

## Submission Artifact

Build the latest Chrome Web Store ZIP from the repo root:

```bash
pnpm --filter clips-chrome-extension package
```

Upload the generated artifact (the version matches `public/manifest.json`; the
Chrome Web Store requires each upload to use a higher version than the last):

```txt
templates/clips/chrome-extension/releases/clips-chrome-extension-<manifest-version>.zip
```

## Automated release

Use the **Publish Clips Chrome extension** workflow in GitHub Actions and run
it from `main`. It runs the extension tests, typecheck, build, version guard,
package upload, and Store publication submission. Anyone with permission to
run repository workflows can start it; Chrome Web Store access is held by the
short-lived GitHub OIDC identity.

The repository must have these variables configured once:

- `CLIPS_CWS_ITEM_ID`
- `CLIPS_CWS_PUBLISHER_ID`
- `CLIPS_CWS_SERVICE_ACCOUNT_EMAIL`
- `CLIPS_CWS_WORKLOAD_IDENTITY_PROVIDER`

Before the first run, add
`clips-cws-publisher@builder-3b0a2.iam.gserviceaccount.com` to the Chrome Web
Store Developer Dashboard under **Account** so the workflow can manage this
listing. This is a one-time publisher-account grant, not a GitHub secret.

Keep `public/manifest.json` at a version higher than the currently published
version before running the workflow. Google review can still leave the Store
submission in `PENDING_REVIEW` after the workflow succeeds.

## Web App Rollout Gate

The Web Store listing is live, and the web app shows the Chrome extension
option by default on hosts supported by the published manifest
(`clips.agent-native.com`, `localhost`, and `127.0.0.1`). Other deployments hide
the option unless they explicitly opt in with a matching extension/listing.

- `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` shows the Chrome option on custom
  deployments that have a compatible extension.
- `VITE_CLIPS_CHROME_EXTENSION_ENABLED=0` (or `false`/`no`/`off`) hides the
  Chrome option even on supported first-party/local hosts.
- `VITE_CLIPS_CHROME_EXTENSION_URL` overrides the default install URL
  (`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`)
  if a deployment uses a different listing.
