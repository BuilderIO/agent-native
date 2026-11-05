---
"@agent-native/core": minor
---

`tool-search` finds the right tool more often in large apps. It now scores each field separately (name, then search hints, then the description's first sentence, then the rest, then parameters), drops conversational words such as "can you" and "my", matches tense ("archived" finds "archive") and joined words ("powerpoint" finds "PowerPoint"), counts common synonyms ("copy" for duplicate, "page" for document) at half weight, and ranks an app's own actions slightly above framework tools with the same words. `defineAction` accepts `searchHints`, a short list of words users say for the action, which `tool-search` ranks just below the name and never sends to the model.
