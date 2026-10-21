---
"@agent-native/toolkit": patch
---

Add `UnsupportedDeviceGate` and an `unsupportedDevice` option on `AppProviders`. On touch screens smaller than an iPad it replaces the signed-in app, before the sign-in screen, with a short notice that offers the OS share sheet and an "Email me the link" action, so someone who opens the app on a phone can continue on a larger device.
