---
"@agent-native/core": patch
---

`create .` now scaffolds into the current directory and takes the project name
from the folder's basename, matching `create-react-app` / `npm init`. Previously
`.` was rejected as an invalid name. The current directory must be empty apart
from benign VCS/editor files (`.git`, `.gitignore`, `LICENSE`, `README.md`, …)
so an existing project is never merged over.

The scaffold is built in a private staging directory and only the files that
don't already exist are copied in, so a mid-scaffold failure can never delete
the current directory (including `.git`) and pre-existing files like
`README.md` and `.gitignore` are preserved. When the current directory is
already a git repo, `create .` skips `git init`/commit so it never writes an
unexpected commit into the user's history.
