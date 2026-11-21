---
"@agent-native/core": patch
---

The frame host handshake from an unlisted parent now needs a signed-in embed session, OAuth callbacks refuse a session that differs from the account that started the flow, and the Slack workspace install keeps a configuration owned by another organization.
