---
"@agent-native/core": patch
---

Stop writing the first-run onboarding eligibility marker for apps whose first-run onboarding is positively known to be off at build time (e.g. Plan), so "completed ÷ eligible" onboarding metrics no longer include rows that can never complete. Apps where the build couldn't resolve the mode keep writing the marker, matching today's behavior.
