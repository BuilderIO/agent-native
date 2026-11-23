---
"@agent-native/core": patch
---

Scrub the query and hash of every URL in a browser session's registered context, not only the top-level `url`. `route.search`, `route.hash`, `session.url`, `screen.url`, and `screen.route.search` and `.hash` went to the server and on to the agent as the page had them, so a token in the page's query or hash reached `view-browser-session`. They now go through the same allowlist as the page URL: attribution parameters keep their values and everything else is redacted.
