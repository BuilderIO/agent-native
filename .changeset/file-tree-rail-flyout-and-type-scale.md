---
"@agent-native/core": patch
---

Refine the `file-tree` block for the recap "Files touched" rail. Folder/file
rows and the summary title drop a touch (14px → 13px) so the dense explorer
reads a step below body text. The block now sets `data-files-expanded` on its
root while a file's note/snippet is the reader's active focus, which the plan
left rail uses to widen into a flyout over the document and collapse back to a
slim rail when focus leaves or the last open file is closed.
