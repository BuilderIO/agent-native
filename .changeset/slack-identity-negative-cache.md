---
"@agent-native/core": patch
---

Slack identity lookups no longer cache a failed users.info result for the full 10-minute TTL. Transient Slack API failures now use a short 30-second negative cache, so a brief blip cannot fail-close a sender's identity (and their DMs) for 10 minutes.
