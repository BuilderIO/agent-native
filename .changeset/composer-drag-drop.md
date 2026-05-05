---
"@agent-native/core": patch
---

Composer accepts file drops directly. Previously, dragging a file (PDF, PPTX, image, etc.) into the prompt composer triggered the browser's default behavior (navigating to the file), even though the "+" button accepted the same file types. The composer now intercepts drops, mirroring the existing paste handler — drag a deck or screenshot in and it attaches like a normal upload.
