---
"@agent-native/core": patch
---

Load `describe-workspace-apps` and `call-agent` on the first model request. The
`<available-apps>` prompt block names both tools by name, but the lazy initial
tool surface omitted their schemas, so an agent asked "which app should I use
for this?" answered from assumption instead of reading its peers' live agent
cards.
