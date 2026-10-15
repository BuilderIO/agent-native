---
"@agent-native/core": patch
---

Add TwittrAPI as a built-in provider API for X/Twitter data, next to the existing twitterapi.io provider. It uses `TWITTRAPI_API_KEY` in the `X-API-KEY` header against `https://api.twittrapi.com`, and the analytics template lists it as a data source.
