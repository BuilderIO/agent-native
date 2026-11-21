---
"@agent-native/core": patch
---

The extension render route now serves its document under a header `sandbox` policy (`allow-scripts allow-forms allow-downloads`) and answers 403 when loaded as a top-level page; extensions continue to render inside the app's frames.
