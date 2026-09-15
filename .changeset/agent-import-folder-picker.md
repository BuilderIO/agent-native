---
"@agent-native/dispatch": patch
---

Fix the "Import an agent" pickers offering files the import cannot read. The
"Choose folder" input never received `webkitdirectory`, because the effect that
set it ran before Radix mounted the tab panel and left the ref null, so the
button opened an unfiltered multi-file picker instead of a folder picker. The
attribute is now set declaratively. "Choose file" also accepted any file the
user selected past the `accept` hint and pasted the decoded bytes into the
definition field; it now rejects unsupported files. Both pickers and
`normalizeAgentPack` share one list of importable extensions, and skipped
folder files are summarized instead of listed one per line.
