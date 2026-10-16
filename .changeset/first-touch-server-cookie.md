---
"@agent-native/core": patch
---

Keep first-touch attribution for a year. The browser now sends its first touch to `POST /_agent-native/auth/attribution`, which keeps it in an `an_fts` cookie that our server sets, expiring 365 days after the first visit. That copy survives Safari's seven-day limit on cookies written by page JavaScript, restores the browser's own copies when they are cleared, and is the first touch signup reads unless the browser holds a better one. Last touch still lasts 30 days. Attribution is no longer stored for visitors in the EU, EEA, UK or Switzerland: the browser skips it by time zone, and the server refuses and clears it by request country.
