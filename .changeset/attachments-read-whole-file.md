---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Attached text files and SVGs now reach the model as text instead of being dropped, reduced to a filename, or treated as reference-only images. A stored markdown or other text file is decoded on the server rather than sent as a file part that most engines replace with a placeholder. SVG source is sent as untrusted text alongside its reference URL.

When an attachment is longer than the inline budget, the model gets its head plus a `<chat-attachment-truncated>` note that requires reading the rest with `read-attachment` before acting on it or reporting the work as done. If the full text could not be stored, the note is a `<chat-attachment-processing-error code="truncated-remainder-unavailable">` that tells the model to say so up front. A text file that is not valid UTF-8 gets `code="undecodable-text"`. `persistTextAttachmentsAsResources` now returns a typed `stored` or `failed` result for each attachment instead of skipping failures.

In the composer, `readAgentPromptAttachment` reads SVG as text, keeps the head of a long file with its `totalChars`, and sets `readError` (`read-failed` or `too-large`) instead of sending a file's name alone. `formatPromptWithAttachments` turns these into a truncation note or an `<attached-file-error>` block. The attachment chip shows "Couldn't read this file" or "File is over 20 MB" before you send.
