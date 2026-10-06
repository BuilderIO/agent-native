---
"@agent-native/core": patch
---

Keep a session in one replay recording when the user reloads or navigates while an upload is in flight. Previously the next page resent the last chunk's number, the server rejected it with HTTP 409, and the recorder restarted under a new recording, splitting the session in two. An upload too large to outlive the page is no longer started as the page hides or closes; its events stay queued for the next upload of a page that survives.
