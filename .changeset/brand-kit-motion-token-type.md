---
"@agent-native/core": patch
---

Add `motion` to `BrandKitTokenType` so durations, easings, and transitions have
a real category. Extractors drop tokens they cannot classify, so the missing
bucket meant no imported design system ever carried its motion.
