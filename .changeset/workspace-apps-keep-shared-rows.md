---
"@agent-native/dispatch": patch
---

Stop deleting workspace app registry rows when an app is missing from the current deployment's manifest. Deployments that share one database (production, beta, local development) each see a different app list, so this removed access for apps that were still live elsewhere. Removing an app from the registry is now only done by archiving it.
