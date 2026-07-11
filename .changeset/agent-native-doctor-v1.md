---
"@agent-native/core": minor
---

Add `agent-native doctor` — a CLI command that scans an app's source for seven security-critical code-safety guards (unscoped credentials, unscoped queries against ownable tables, `process.env` credential reads, raw-DB tool table scoping, `process.env` mutation, `local@localhost` identity fallback, and `drizzle-kit push` in build/deploy scripts). Configurable via an optional `"doctor"` key in `agent-native.json`. `agent-native build` now runs doctor as a warn-only pre-step by default; pass `--strict` or set `agent-native.json`'s `doctor.failOnBuild: true` to make findings fail the build. The scaffolded app gets a `pnpm doctor` script and a `self-modifying-code` skill update recommending it after source edits.
