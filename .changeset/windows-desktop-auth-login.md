---
"@agent-native/core": patch
---

Fix Windows desktop (Tauri) email/password sign-in. The login endpoint now
returns the session token to the Windows WebView2 origin
(`http://tauri.localhost` / `https://tauri.localhost`), which was missing from
the desktop token allowlist, so sign-in no longer silently bounces back to the
form. Also stop reporting wrong-password failures as "Enter a valid email
address" — credential errors now surface as "Invalid email or password" while
genuine malformed-email input still gets the friendly format message.
