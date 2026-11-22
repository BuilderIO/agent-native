---
"@agent-native/core": patch
---

A route chunk that fails to load while the browser is offline no longer reloads the page into the browser offline error page. The app stays mounted and navigates to the clicked route once the connection returns.
