---
"@agent-native/core": patch
---

The Twitter/X provider in the provider API catalog now calls the official X API (`https://api.x.com/2`) with `TWITTER_BEARER_TOKEN` as a Bearer token, matching the X Bearer token the Analytics data source asks for, instead of sending that token to twitterapi.io.
