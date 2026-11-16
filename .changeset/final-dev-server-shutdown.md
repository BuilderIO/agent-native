---
"@agent-native/core": patch
---

Keep an explicit dev server shutdown final. A restart that Vite requested while the shutdown was still closing the database, such as a second change event from one `.env` save, cleared the shutdown and brought the closed server back a few seconds later.
