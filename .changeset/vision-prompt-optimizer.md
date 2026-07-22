---
"@agent-native/core": minor
---

Add an automatic Prompt-to-Vision Optimizer to the composer: oversized user prompts and large pasted-text attachments are rendered onto high-DPI dark-mode PNG canvas frames with line numbers and sent as vision context instead of raw text, reducing input tokens on large pastes. Exposes `evaluatePromptOptimization`, `renderTextToImagePagesWeb`, and `optimizePromptSubmission` from the client composer surface.
