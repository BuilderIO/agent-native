---
"@agent-native/core": patch
---

Inbound email now counts a sender as verified only when the provider's DKIM result passes for a domain aligned with the From address; a bare SPF pass or an Authentication-Results header carried in the message no longer does.
