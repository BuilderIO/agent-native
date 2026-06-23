---
"@agent-native/core": patch
---

Fix the "Sign in with Google" button getting stuck disabled when the OAuth
window is closed without finishing (e.g. to retry in a different browser
profile). The button was only ever re-enabled on an explicit OAuth error or
the 5-minute poll timeout, so a cancelled sign-in left the primary CTA greyed
out with no way to retry short of refreshing. The sign-in screen now re-enables
the button (and stops the pending exchange poll) when the window regains focus
or becomes visible again — mirroring the existing email-verification recovery.
