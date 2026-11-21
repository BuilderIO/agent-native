---
"@agent-native/core": patch
---

When a provider key is saved only as teammates' Personal keys, the missing-key error no longer blames an integration, job or automation, which was wrong in a person's own chat. Every run now gets the same shared-key fix, then a short explanation, both ahead of the list of keys tried, so the fix stays in a stop's one-line reason even for the longest key names; and a request on a selected workspace connection no longer gets shared-key advice that can't fix it. A stop's one-line reason now ends on a whole sentence or word, never mid-word, and fits in 240 characters with its closing punctuation.
