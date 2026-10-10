---
"@agent-native/core": patch
---

Fix ChatGPT directory widgets (Slides, Design, Content) opening with "The original widget session ticket is unavailable." for connections authorized before OAuth tokens carried a grant time. Those tokens now use their signed issue time as the widget session anchor, a failed write grant degrades to a read-only session instead of dropping the ticket, and a result returned without a widget session ticket is logged.
