# Planning a breaking package change

This checklist is for changes that remove, rename, or replace a public package
API. Keep the installed, version-matched copy with the package so an app's agent
can read the migration steps next to the code it is changing.

## Before changing the API

1. Inventory public entrypoints, exported values and types, runtime behavior,
   examples, templates, and downstream owners. Mark each item as supported,
   moved, replaced, or removed. A name that remains as a compatibility alias
   must not be described or linted as removed.
2. Write the old-to-new map and migration steps before deleting the old owner.
   State which application contracts stay stable, which need changes, and when
   there is no one-to-one replacement.
3. Add migration manifest moves and codemods only for deterministic changes.
   Record removed exports so `agent-native doctor --only migration-manifest`
   can report them with the guide. Keep runtime tombstones for fully retired
   module paths; do not tombstone a barrel that still has supported exports.
4. Update the changelog, public docs, installed agent docs, examples, and
   generated or localized copies in the same change. Give app authors a
   Markdown guide they can pass directly to a coding agent.

## Before publishing

- Search the whole repository for old imports, symbols, props, and behavioral
  ownership. Update first-party apps and add a guard when the old pattern must
  not return.
- Run the migration doctor against representative moved and removed imports.
  The error should name the old API, say whether an automatic rewrite exists,
  and link the exact migration guide.
- Verify the migration guide against the new types and working examples. Test
  the codemod and diagnostics, and keep the package changeset aligned with the
  release impact.
- Review claims separately: source/API removal, migration tooling, docs,
  package release, and any deployment or live behavior have different proof.

TypeScript's missing-export diagnostic cannot be customized by the package.
Use the migration doctor for named exports that no longer exist, and provide a
typed deprecated property or a runtime tombstone when the API shape allows a
more direct message.

## Installed copy

The published package includes this file at
`node_modules/@agent-native/core/docs/migrations/README.md`. Add specific guides
beside it and link them from the package docs index so agents can find the
version-matched instructions.
