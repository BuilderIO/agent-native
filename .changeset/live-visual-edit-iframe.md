---
"@agent-native/core": patch
---

Visual edit: never render a source snapshot in place of the running app. A localhost screen now always loads a live document — the proxied `/live-edit` frame for viewers holding the connection's `previewToken`, and the plain dev-server URL for everyone else. Previously a viewer without a token (signed-out session, public link, inline browser with no cookies) got the `/snapshot` HTML as `srcdoc`: a frozen copy that looked exactly like the app but had no live DOM behind it, so selection, the layers panel, and edits all silently addressed stale markup.
