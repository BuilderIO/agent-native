---
"@agent-native/core": patch
---

Add a `materialize --out <dir>` subcommand to `agent-native template` that writes the post-processed standalone template tree (e.g. `--template chat`, with the template's own identity, `_gitignore`→`.gitignore`, resolved deps, standalone `netlify.toml`) to a directory — no existing app required. This is the monorepo half of the vendor-branch starter mirror: the public monorepo materializes `templates/chat` and pushes it to the private starter's `template` branch, which the starter merges into `main` with git. Reuses the existing `materializeTemplate` engine.
