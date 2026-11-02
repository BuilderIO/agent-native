---
"@agent-native/toolkit": patch
---

Opening a menu or popover no longer restyles the whole page in Safari. A message-queue rule in the AgentKit styles used `:first-of-type`, which made WebKit recompute every element's style whenever an overlay inserted its focus guards at the top of `<body>`.
