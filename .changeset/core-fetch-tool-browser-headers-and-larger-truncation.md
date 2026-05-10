---
"@agent-native/core": minor
---

feat(extensions/fetch-tool): the `web-request` tool now sends realistic Chrome-on-macOS headers (User-Agent, Accept, Sec-Fetch-*, Upgrade-Insecure-Requests, etc.) by default so sites with anti-bot middleware (Cloudflare, PerimeterX, Akamai) respond normally instead of returning challenge pages. Caller-supplied headers always win, so API calls with Authorization keep their values untouched.

Also raise the response truncation cap from 8k to 32k chars so the agent can read a full article or scraped table in one shot.
