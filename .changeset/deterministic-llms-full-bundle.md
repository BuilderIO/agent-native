---
"@agent-native/scheduling": patch
---

Generate `docs/llms-full.txt` in a locale-independent order. The bundle sorted its sections with `localeCompare`, so a full-ICU Node produced a different order than the small-ICU build that generated the committed file — leaving the tracked artifact modified after every `pnpm install`.
