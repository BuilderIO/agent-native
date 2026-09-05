---
"@agent-native/core": patch
---

Job and automation status writes keep application-owned frontmatter (such as a Factory Slack channel) instead of dropping those YAML extras when a run completes.
