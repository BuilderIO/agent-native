---
"@agent-native/core": patch
---

Keep OAuth popups navigable from app pages and the MCP sign-in form. Framework pages now send `Cross-Origin-Opener-Policy: same-origin-allow-popups`, so a popup opened on the inert waiting page is no longer severed from its opener and left blank with an "allow popups" error. Validated embed-session responses keep `same-origin`.
