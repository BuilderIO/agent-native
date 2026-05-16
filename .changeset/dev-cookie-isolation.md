---
"@agent-native/core": patch
---

Fix cross-app auth interference when running two templates side-by-side in local dev. Browsers scope cookies by host only (not port), so two `localhost:*` dev servers previously stomped on the same `an_session` cookie and Better Auth `an.*` cookies, signing each other out. The framework now derives a per-app cookie suffix from `npm_package_name` / `package.json:name` in dev (`NODE_ENV !== "production"`), producing `an_session_<app>` and Better Auth prefix `an_<app>`. Production is unchanged — explicit `APP_NAME`, `COOKIE_DOMAIN`, and workspace mode still drive cookie naming as before.
