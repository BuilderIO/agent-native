---
"@agent-native/core": patch
---

Make the Cloudflare Worker module preset stub browser-driver and PDF packages
fail-closed, and apply those stubs through Nitro's alias layer so an installed
package (`@playwright/test`) can no longer be linked into the Worker whole.
The generated `_libs/` stub for an unresolved native dependency now throws on
use instead of answering as an idle capability.
