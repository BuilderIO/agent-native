---
"@agent-native/core": patch
---

Fix Google sign-in being permanently blocked for cross-app SSO users with "This email has an unverified password account." JIT provisioning creates an unusable password credential plus an inert `agent-native` identity link, and the account-claim guard counted its own link as a competing third-party claim. The promote-to-Google path now accepts it (real third-party accounts are still refused), and an authority-verified federated identity is recorded as verified so pending invitations and domain auto-join are no longer withheld.
