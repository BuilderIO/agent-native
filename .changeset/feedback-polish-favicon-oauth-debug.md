---
"@agent-native/core": patch
---

Sign-in page polish: add a favicon `<link>` to the onboarding sign-in and reset-password HTML so tabs no longer show the default globe. Suppress the on-screen Google OAuth status overlay ("OAuth exchange redeemed; returning to the app (flow …)" and friends) for end users — diagnostics still log to the browser console, and the overlay can be opted back in with `#oauth-debug` or `?oauth_debug=1` for debugging. Refresh the feedback popover placeholder to lead with concrete examples ("e.g. 'The Send button isn't obvious'") so users have a clearer prompt than "Tell us what's on your mind…".
