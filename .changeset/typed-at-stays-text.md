---
"@agent-native/toolkit": patch
---

Keep a typed `@` in the agent composer. It now suggests mentions and the host's Add-menu context sources (such as Design context pickers and Integrations) inline, with focus left in the prompt. Picking a source runs it or opens its picker as a dialog. Otherwise the text stays plain, so a literal like `@builder.io` is sent as written. One Escape dismisses the suggestions for that `@`. Sent messages show chips only for real mentions, not for any `@word`.
