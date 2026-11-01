---
"@agent-native/core": patch
---

Share a session answer only between reads sent with the same credentials, so a read that carries an embed token is never answered with the page's cookie session, or the reverse.
