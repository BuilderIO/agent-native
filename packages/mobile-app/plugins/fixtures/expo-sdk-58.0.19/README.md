# Expo iOS lifecycle fixtures

`AppDelegate.swift` and `SceneDelegate.swift` are the unmodified
`package/ios/HelloWorld` templates from `expo/template.tgz` in the package's
pinned `expo@58.0.19` dependency. The plugin test compares both fixtures
byte-for-byte with that archive. Scene-based quick actions are persisted by the
AppDelegate callback and consumed by JavaScript after Expo Router is ready, so
the generated SceneDelegate remains Expo-owned.

When Expo is upgraded, extract both archive entries into a newly versioned
fixture directory, update the paths in `with-mobile-companion.test.ts`, and
review any failed anchors before accepting the new template.
