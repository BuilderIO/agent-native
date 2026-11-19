---
"@agent-native/core": patch
---

Adding the same connected account again now refreshes its saved sign-in instead of listing it twice, including when the email differs only in capitalization or spacing. Accounts that were already listed twice now show once, and disconnecting an account removes every copy of it.
