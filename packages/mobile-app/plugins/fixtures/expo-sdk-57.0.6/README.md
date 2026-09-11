# Expo AppDelegate fixture

`AppDelegate.swift` is the unmodified `package/ios/HelloWorld/AppDelegate.swift`
from `expo/template.tgz` in the package's pinned `expo@57.0.6` dependency. The
plugin test compares the fixture byte-for-byte with that archive before testing
the shortcut-routing anchors, so an Expo template change cannot silently pass
against a stale hand-written approximation.

When Expo is upgraded, extract the same archive entry into a newly versioned
fixture directory, update the path in `with-mobile-companion.test.ts`, and review
any failed anchors before accepting the new template.
