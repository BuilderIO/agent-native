---
"@agent-native/core": patch
---

Switch the builder-agent-native-starter sync to the vendor-branch model: a new `push-starter-template` workflow materializes the post-processed `templates/chat` and pushes it to the starter's `template` branch (which the starter git-merges into `main`). Removes the obsolete dispatch workflow and the `sync-builder-starter-manifest` CLI (the `merge`/`generate`/`paths` allowlist sync), superseded by `agent-native template materialize` + git-native merge.
