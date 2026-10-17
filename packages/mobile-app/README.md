# Agent-Native mobile app

## CI build checks

Pull requests that change the mobile app or its shared workspace dependencies
run `.github/workflows/mobile-build-check.yml`. The workflow exports production
JavaScript bundles for both platforms and compiles an Android debug APK on
Linux. It does not publish artifacts or require store credentials.

The iOS pull-request lane stops at the production bundle. The app now uses
Expo 57.0.29 and React Native 0.86.3, with an unsigned Simulator build verified
locally using Xcode 27.1. An iOS native compile lane has not been added to CI.

The pull-request check disables remote-push entitlements and Apple app
extensions so forks and contributors can run it without signing access. Use an
EAS `preview` or `production` build to verify signing, push entitlements,
widgets, the keyboard, broadcast upload, Watch target, and installability on a
physical device. See `IOS_RELEASE.md` for the iOS credential bootstrap.

## Local iOS auth harness

The production app stays on Expo SDK 57 and enables `ios.enableSceneSupport`
through `expo-build-properties`. A fresh prebuild uses Expo's built-in
`EXExpoAppSceneDelegate` and moves React Native startup out of `AppDelegate`.
See [Expo's SDK 57 scene migration guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27).
The updated upstream dependencies build without an app-owned JSI interface
cleanup hook. Do not patch `node_modules` or add a pnpm dependency patch.

Earlier local parent-session and workspace-app fanout checks used an isolated temporary Expo project. That harness used Expo `~53.0.27`, React Native `0.79.6`, `expo-secure-store ~14.0.1`, and `expo-web-browser ~14.0.2`. It copied only the mobile auth modules into the temporary project and left the production app unchanged.

The harness has two local processes:

- `node fanout-server.mjs` starts a fake Dispatch server on `http://127.0.0.1:8089`.
- `pnpm exec expo start --dev-client --port 8084` serves the harness bundle to the installed iOS development client.

On the iPhone 17 Pro simulator running iOS 26.1, create one local parent session as `simulator@example.test`, then run the Mail, Calendar, Content, and Analytics fanout action. The harness should show a distinct ticket minted and consumed for every app, no child Authorization header, and the same parent token before and after the four exchanges. The server trace should also show that replaying a consumed ticket returns HTTP 401.

This is a native JavaScript and session-boundary harness. It proves parent-session retention and app-ticket consumption without compiling the production SDK 57 target. It does not prove Google OAuth or the production WebView rendering path. Verify those separately in the real app or a compatible production build.
