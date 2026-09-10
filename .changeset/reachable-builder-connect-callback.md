---
"@agent-native/core": patch
---

Keep the Builder connect OAuth callback on the preview origin the popup was opened on. In a workspace deploy behind a Builder-hosted preview, the callback origin resolved to the loopback workspace gateway, so Builder returned the authorization code to the visitor's own machine instead of the preview server holding the pending flow, and the connect popup failed with "No active Builder connect flow found. Restart the connection from Settings."
