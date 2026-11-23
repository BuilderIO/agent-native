---
"@agent-native/core": patch
---

A Vercel workspace deploy with Content or another app of a few hundred assets now deploys. Each app's long-lived cache headers come from one short pattern route that applies only to files Vercel serves, instead of one route listing every asset, which Vercel rejected as longer than 4096 characters.
