---
"@agent-native/core": patch
---

Scrub the other places a page URL leaves the app: the hash of the `__url__` state the agent reads, the page URL sent with the Builder waitlist form, and the URL registered by browser-session and WebMCP sessions, so a token in a query or fragment no longer travels to the model, to Builder, or to an external agent host.
