---
"@agent-native/core": patch
---

Stop telling readers their own provider key was rejected when it was not theirs

A 401 proves the credential a request carried was refused. It does not prove
whose credential it was, and the reader is often someone with no saved key to
fix — the rejected credential can be a workspace or deployment one they cannot
see. The copy named "the saved provider key" as the cause and sent everyone to
Settings, which is why one shared credential cost two days of chasing key
configuration.

The message now says only what the 401 proves, and the rejected-credential card
offers a retry alongside the setup flow. That retry used to be withheld because
it would "replay the same rejected credential and loop"; that stopped being true
once a 401 began fingerprinting the credential and skipping it for a backing-off
window, so the next attempt reaches for a different one or fails closed as
missing credentials. Previously this rendered a setup panel for a connection
already marked good, with no action available at all.
