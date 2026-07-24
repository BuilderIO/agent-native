---
"@agent-native/core": minor
---

The runtime agent can now actually read skill `references/*.md` sub-files it is told about. Previously only `SKILL.md` content was bundled — sub-file names were advertised in the skills prompt block and via `docs-search`, but their content was never read into the bundle, so `docs-search --slug "skill-<name>"` could never return them. `readSkillsDir` now inlines eligible text sub-files (`.md`/`.txt`/`.json`, capped at 64KB/file and 256KB/skill) into a new `Skill.files` map, `docs-search` exposes each one under a resolvable `skill-<name>--<subpath>` slug, the skills prompt block hints at those resolvable slugs instead of bare filenames, and the Vite dev-server HMR watcher invalidates the bundle for any file under a skills directory (not just `SKILL.md`).
