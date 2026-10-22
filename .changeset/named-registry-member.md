---
"@agent-native/core": patch
---

Sign a signed-in member's workspace registry request with the deployment secret again, so Dispatch keeps the member's identity. Signing it with the organization secret made the receiver drop the user and refuse every workspace app's registry check with "Workspace app access is temporarily unavailable". The organization secret now signs only delegated org-member requests.
