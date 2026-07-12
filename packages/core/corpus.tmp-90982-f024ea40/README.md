# Agent Native Source Corpus

This directory is generated when `@agent-native/core` is built for npm.
It gives coding agents a version-matched, searchable reference corpus
inside installed apps at `node_modules/@agent-native/core/corpus`.

## Contents

- `core/` -- source and package files for `@agent-native/core`.
- `templates/` -- source-only copies of first-party Agent Native templates.

Runtime data, local env files, dependency folders, caches, tests, and build
output are intentionally excluded. Use this corpus for framework APIs,
reusable patterns, and template best practices; use the app's own files as
the source of truth for app-specific behavior.

Binary assets and other files that runtime source-search cannot read are
also excluded.

## Lookup

```bash
pnpm action source-search --query "defineAction useActionQuery"
pnpm action source-search --path templates/plan/AGENTS.md
rg -n "defineAction|useActionQuery" node_modules/@agent-native/core/corpus
```

## Generated Counts

- core files: 2235
- template files: 5488
