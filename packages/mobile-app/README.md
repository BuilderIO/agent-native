# Agent-Native mobile app

## CI build checks

Pull requests that change the mobile app or its shared workspace dependencies
run `.github/workflows/mobile-build-check.yml`. The workflow exports production
JavaScript bundles for both platforms and compiles an Android debug APK on
Linux. It does not publish artifacts or require store credentials.

The iOS pull-request lane stops at the production bundle. Expo SDK 57.0.6 has a
known native compile failure with the Xcode 26.x toolchains available to hosted
CI, so an iOS compile job would currently be a permanently red gate rather than
useful validation. Restore an unsigned Simulator `xcodebuild` lane after the app
upgrades to an Expo patch that supports the selected hosted Xcode version.

The pull-request check disables remote-push entitlements and Apple app
extensions so forks and contributors can run it without signing access. Use an
EAS `preview` or `production` build to verify signing, push entitlements,
widgets, the keyboard, broadcast upload, Watch target, and installability on a
physical device. See `IOS_RELEASE.md` for the iOS credential bootstrap.

## Local iOS auth harness

The production app targets Expo SDK 57. With Xcode 26.1, a fresh native build can fail inside `expo-modules-jsi` with Swift compiler errors around `weak let`. Do not patch `node_modules` or add a pnpm dependency patch. The repository intentionally forbids that workaround.

For local parent-session and workspace-app fanout checks, use an isolated temporary Expo project instead. The proven harness used Expo `~53.0.27`, React Native `0.79.6`, `expo-secure-store ~14.0.1`, and `expo-web-browser ~14.0.2`. It copied only the current mobile auth modules into the temporary project and left the production app unchanged.

The harness has two local processes:

- `node fanout-server.mjs` starts a fake Dispatch server on `http://127.0.0.1:8089`.
- `pnpm exec expo start --dev-client --port 8084` serves the harness bundle to the installed iOS development client.

On the iPhone 17 Pro simulator running iOS 26.1, create one local parent session as `simulator@example.test`, then run the Mail, Calendar, Content, and Analytics fanout action. The harness should show a distinct ticket minted and consumed for every app, no child Authorization header, and the same parent token before and after the four exchanges. The server trace should also show that replaying a consumed ticket returns HTTP 401.

This is a native JavaScript and session-boundary harness. It proves parent-session retention and app-ticket consumption without compiling the production SDK 57 target. It does not prove Google OAuth or the production WebView rendering path. Verify those separately in the real app or a compatible production build.
