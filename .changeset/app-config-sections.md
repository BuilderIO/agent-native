---
"@agent-native/core": minor
---

Add `defineAppConfigSection(key, schema)` so an app can register its own typed server config section. Its fields resolve like the framework's (declared default, `.meta({ env })` aliases, then `defineAppConfig()`), and `getAppConfig()[key]` or the returned `read()` reads it. Declare the section's type by augmenting `AppConfigSections`. Keys that collide with framework sections and env aliases another field already reads are refused at registration.
