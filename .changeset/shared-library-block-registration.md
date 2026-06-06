---
"@agent-native/core": patch
---

Make the unified editor's block library "add a block in ONE place" by sharing the two pieces that were still duplicated between the plan and content editors.

- **`buildRegistryBlockSlashItems(registry, options)`** (exported from `@agent-native/core/client`) — the shared builder for the registry-derived block slash commands both editors offer. It owns the `registry.list("block")` source, the Notion-compatibility filter, and the one-item-per-spec mapping; each app injects only the parts that legitimately differ (its item shape, its Notion-compat predicate, and how it inserts the block node). Plan's `buildPlanSlashCommands` and content's `buildRegistrySlashItems` are now thin adapters over it.
- **`registerLibraryBlocks(registry, { overrides? })` + `libraryBlockSpecs`** (from `@agent-native/core/blocks`) — register the whole standard browser library (checklist, table, code-tabs, html, tabs + the eight dev-doc blocks: mermaid, api-endpoint, openapi-spec, data-model, diff, file-tree, json-explorer, annotated-code) in one call. Apps register it, then add only their app-specific blocks on top, passing small per-block `overrides` (e.g. content re-types `table` → `table-block`).
- **`registerLibraryBlockConfigs(registry, { overrides? })` + `libraryBlockConfigs`** (from `@agent-native/core/blocks/server`) — the React-free twin for server / shared registries, registering the same library as `Read: () => null` config stubs so the agent schema export and MDX round-trip share one source too.

Adding a 14th standard library block now means editing one core list instead of four app files. The set of registered blocks and the Notion-gating behavior in each app are unchanged.
