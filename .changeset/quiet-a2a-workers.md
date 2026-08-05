---
"@agent-native/core": patch
---

Keep Neon connection pools bounded in concurrent durable background workers so async A2A tasks do not starve the database before they can complete.
