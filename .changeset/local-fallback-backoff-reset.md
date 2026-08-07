---
"@agent-native/core": patch
---

Reset the poll backoff when sync health-gates from the hosted gateway to local. The failure count earned against an unreachable gateway was carried into local mode, delaying the first local poll by up to 8 minutes even though the app's own origin was reachable.
