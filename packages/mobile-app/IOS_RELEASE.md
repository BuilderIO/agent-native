# iOS signing and extension provisioning

The checked-in Expo config is contributor-neutral: it declares bundle IDs and
entitlements, but it does not contain an Apple Team ID or signing credentials.
All EAS profiles use remotely managed credentials. `app.config.ts` reads the
optional `AGENT_NATIVE_APPLE_TEAM_ID` build environment variable so release
builds can supply the team without tying every contributor's prebuild to it.
Local unsigned prebuilds do not require access to the release team.

`@bacons/apple-targets` adds the four extension targets to
`extra.eas.build.experimental.ios.appExtensions` during Expo config evaluation.
Verify the metadata before provisioning with:

```sh
pnpm exec expo config --type public
```

## One-time EAS bootstrap

An Apple Developer Program account with access to the intended team is required.
From `packages/mobile-app`:

1. Add `AGENT_NATIVE_APPLE_TEAM_ID` to the appropriate EAS environments using
   the intended release team's value. Do not put the value in `app.json`,
   `eas.json`, shell profiles, or documentation.
2. Run an interactive `eas build --platform ios --profile production` (or
   `eas credentials --platform ios`) and select that team. Let EAS create or
   validate the App IDs, distribution certificate, and provisioning profiles.
3. Confirm that credentials exist for the main app and every generated target:

   | Xcode target         | Bundle identifier                  | Required capability                    |
   | -------------------- | ---------------------------------- | -------------------------------------- |
   | AgentNative          | `com.agentnative.mobile`           | App Group                              |
   | AgentNativeWidgets   | `com.agentnative.mobile.widgets`   | App Group                              |
   | AgentNativeKeyboard  | `com.agentnative.mobile.keyboard`  | App Group                              |
   | AgentNativeBroadcast | `com.agentnative.mobile.broadcast` | App Group                              |
   | AgentNativeWatch     | `com.agentnative.mobile.watch`     | Watch app profile; no App Group needed |

4. In Apple Developer Certificates, Identifiers & Profiles, verify that
   `group.com.agentnative.mobile` is assigned to the main app, widgets,
   keyboard, and broadcast identifiers. The watch app transfers through
   WatchConnectivity and does not use the iOS App Group container.
5. Regenerate any profile created before its App Group capability was enabled.
   For internal development builds, register test devices before refreshing the
   development profiles.
6. Once this bootstrap succeeds, CI can use
   `eas build --platform ios --profile production --non-interactive` with EAS
   remote credentials. Never add team IDs, certificates, profiles, or
   `credentials.json` to source control.

For a signed local Xcode build, run prebuild, open `ios/AgentNative.xcworkspace`,
and select the same team under Signing & Capabilities for the main app and each
target. Those local Xcode choices are generated state and must remain untracked.
