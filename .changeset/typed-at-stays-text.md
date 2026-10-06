---
"@agent-native/toolkit": patch
---

Keep a typed `@` in the agent composer. It now suggests mentions and the host's Add-menu context sources (such as Design context pickers and Integrations) inline, with focus left in the prompt. Picking a source runs it or opens its picker as a dialog. Only an explicit pick makes a chip: Enter or Tab on a highlighted suggestion, or a click. Otherwise the text stays plain, so a literal like `@builder.io` is sent as written, Enter sends the text even while a search is still running, and typing Space after an exact name no longer converts it. One Escape dismisses the suggestions for that `@`. Sent messages show chips only for real mentions, not for any `@word`.
