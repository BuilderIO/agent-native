---
"@agent-native/core": patch
---

`create .` now scaffolds into the current directory and takes the project name
from the folder's basename, matching `create-react-app` / `npm init`. Previously
`.` was rejected as an invalid name. The current directory must be empty apart
from benign VCS/editor files (`.git`, `.gitignore`, `LICENSE`, `README.md`, …)
so an existing project is never merged over.
