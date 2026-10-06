---
"@agent-native/core": patch
---

Hold sign-up until the org tables exist on a fresh database. Sign-up checks org sign-in policy inside its transaction, and a missing table failed it as "Enter a valid email address".
