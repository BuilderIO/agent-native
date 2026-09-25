---
"@agent-native/core": patch
---

Keep app-driven continuations in their original chat, reopening closed tabs and waiting for delivery confirmation. `useGuidedQuestionFlow` also exposes `refetchPendingQuestion` so a caller can force a fresh check instead of racing the reactive app-state read before dropping run correlation.
