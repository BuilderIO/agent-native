---
"@agent-native/core": patch
---

Add a Google sign-in credential self-check at `/_agent-native/health/google`.

The callback returns an identical error page for a wrong client secret and a
stale authorization code, so a broken credential is invisible from outside
while `/_agent-native/health` keeps reporting `ok:true`. The new route asks
Google directly and reports `valid`, `invalid`, `unconfigured`, or `unknown` —
a transport failure is never reported as valid — plus whether the deploy
carries two credential pairs naming different Google clients.
