---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Attached text files and SVGs now reach the model as text instead of being dropped, reduced to a filename, or treated as reference-only images. A stored markdown or other text file is decoded on the server rather than sent as a file part that most engines replace with a placeholder. SVG source is sent as untrusted text alongside its reference URL.

When an attachment is longer than the inline budget, the model gets its head plus a `<chat-attachment-truncated>` note that requires reading the rest with `read-attachment` before acting on it or reporting the work as done. If the full text could not be stored, the note is a `<chat-attachment-processing-error code="truncated-remainder-unavailable">` that tells the model to say so up front. A text file that is not valid UTF-8 gets `code="undecodable-text"`. `persistTextAttachmentsAsResources` now returns a typed `stored` or `failed` result for each attachment instead of skipping failures. For an upload already in file storage it saves only a reference, and `read-attachment` re-reads the file from storage. A body copy in SQL is kept only for text with no storage URL, up to 1,000,000 characters.

In the composer, `readAgentPromptAttachment` reads SVG as text, keeps the head of a long file with its `totalChars`, and sets `readError` (`read-failed`, `too-large`, or `not-utf8`) instead of sending a file's name alone or text with replacement characters. `formatPromptWithAttachments` turns these into a truncation note or an `<attached-file-error>` block. Text and SVG files up to 8 MB are readable in both hosted chat and the composer; hosted chat previously stopped at about 750 KB. The attachment chip shows "Couldn't read this file", "File is over 8 MB", or "File isn't UTF-8 text" before you send.

`AgentKitComposer` now defaults `inlineTextAttachments` to `false`. AgentKit always uploads attached files and the server reads their text, so a text file is no longer also pasted into the message with only a weak truncation note. Pass `inlineTextAttachments` to opt back in.
