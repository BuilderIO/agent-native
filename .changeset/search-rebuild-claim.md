---
"@agent-native/core": patch
---

Restart a search index rebuild that was still queueing rows or finishing when its index was discarded, instead of completing it without the writes made while change capture was missing.
