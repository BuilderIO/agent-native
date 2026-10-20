---
"@agent-native/core": patch
---

`agent-native template status`, `diff` and `sync` no longer report every file as changed when git converts line endings (`core.autocrlf=true`, the Git for Windows default): the template baseline is written and read without `core.autocrlf`/`core.eol` conversion, and app files checked out with CRLF on paths where git normalizes line endings are compared and merged as the template's LF, and written back with CRLF when every line had it.
