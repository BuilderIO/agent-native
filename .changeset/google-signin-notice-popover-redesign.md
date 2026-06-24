---
"@agent-native/core": patch
---

Redesign the Google sign-in preflight notice on the onboarding/sign-in screen
to match the in-app connect popover: an amber warning-icon chip beside a bold
heading and muted body copy, with the close affordance moved to the top-right.
The `googleSignInNotice.body` already accepts a string array, so reassurance
like "It's safe to continue." now renders on its own line. The Continue /
Run-locally action buttons no longer wrap their labels (`white-space: nowrap`).
Purely presentational — the host-gating, Continue, and Run-locally behaviors are
unchanged.
