---
name: plan-local-codebase-chat
description: >-
  How Ask Plan links a browser-selected local codebase and how to answer
  questions from its indexed snapshots instead of guessing from file names. Use
  when the user asks about their linked local codebase or `localCodebase` is in
  application state.
---

# Local Codebase Chat

The `local-codebase` application-state key is written by the Ask Plan browser
folder picker when a user links a local codebase. It includes the selected
folder name plus personal resource paths for the latest code index, file tree,
and captured source snapshots.

- The Ask Plan page can link a browser-selected local codebase folder. The UI
  indexes safe text files, skips generated/secret-looking paths, writes a small
  personal instruction resource under `instructions/local-codebases/`, and
  stores captured file snapshots under `codebases/<id>/snapshots/<timestamp>/`.
- For live codebase questions, call `view-screen` when context is unclear and
  inspect `localCodebase`. First read its `indexPath` with the `resources` tool
  using `scope: "personal"`, then read relevant captured file `resourcePath`s
  before making claims. Do not infer API contracts, schema shape, or UI behavior
  from file names alone.
- If the file needed to answer is absent or skipped, ask the user to sync again
  or attach the file instead of guessing.
- For API/schema/UI visualization from a local codebase, call
  `get-plan-blocks` or `list-plan-components` before `visual-answer`, then
  publish blocks such as `openapi-spec`, `api-endpoint`, `data-model`,
  `diagram`, `file-tree`, `tabs`, and `annotated-code` grounded in the files
  you read.

## Related Skills

- **visualize-repo** — durable repo-backed visual documentation from local plan
  MDX files.
- **plan-source-sync** — reading and writing local plan folders.
