---
"@agent-native/toolkit": patch
---

Wait for a new chat tab to render a submitted model override before handing it the prompt, so a first prompt sent with a model choice (such as a new Slides deck) is no longer rejected while the model list is still loading.
