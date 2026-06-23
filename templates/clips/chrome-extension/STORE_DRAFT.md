# Chrome Web Store Draft

## Listing

Name: Agent-Native Clips

Chrome Web Store item ID: `baoipacpchggcdigagnajakiidcgcffn`

Chrome Web Store URL: `https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`

Summary: Start Clips recordings from Chrome with optional redacted console and network diagnostics.

Category: Productivity

Description:

Agent-Native Clips lets you start a Clips recording from the Chrome toolbar and optionally attach browser diagnostics from the tab where you launched the recording.

Use it to:

- Record the current tab, a window, your full screen, or camera-only video.
- Include your camera bubble and microphone through the Clips recorder.
- Optionally capture redacted console logs and fetch/XHR request metadata.
- Keep browser recording permissions explicit: Chrome still asks before screen, camera, or microphone capture starts.

Diagnostics are bounded and redacted before they are saved. Clips does not collect request or response bodies, request headers, cookies, authorization headers, or full query values.

## Permission Justification

- `activeTab`: lets the toolbar action identify the user-selected active tab after the user clicks the extension.
- `debugger`: attaches to only the user-selected tab while a Clips recording is active, then detaches on stop/cancel. It is used to collect console messages, JavaScript exceptions, and fetch/XHR method, URL, status, timing, and failure metadata. It does not read request or response bodies.
- `storage`: remembers the user's default Clips app URL, capture source, camera toggle, and developer-log preference.

## Privacy Notes

- The extension only starts when the user clicks the toolbar button.
- The extension only sends diagnostics to the configured Clips app after the user starts and finishes a Clips recording.
- Developer logs are on by default and can be turned off from the popup or settings page.
- Network data is limited to fetch/XHR metadata and redacted URLs; headers and bodies are never captured.

## Review Notes

The extension opens `https://clips.agent-native.com/record` by default. Local development can point the settings page to a localhost Clips instance.

## Submission Artifact

Build the latest Chrome Web Store ZIP from the repo root:

```bash
pnpm --filter clips-chrome-extension package
```

Upload the generated artifact:

```txt
templates/clips/chrome-extension/releases/clips-chrome-extension-0.1.0.zip
```

## Web App Rollout Gate

Keep the web app's Chrome extension UI hidden until the Web Store listing is
approved and there is a stable public URL.

- `VITE_CLIPS_CHROME_EXTENSION_ENABLED=1` reveals the Chrome option beside
  Clips desktop prompts.
- `VITE_CLIPS_CHROME_EXTENSION_URL` overrides the default install URL
  (`https://chromewebstore.google.com/detail/baoipacpchggcdigagnajakiidcgcffn`)
  if a deployment uses a different listing.
- Leave both unset while submitting the draft so production continues to send
  users directly to the desktop app.
