---
name: library-management
description: Schema, CRUD, sharing, URL style imports, and cascade-delete patterns for asset libraries, collections, and assets. Use when managing a library or importing visual brand evidence from a URL.
---

# Library management

Use this skill before adding fields, changing access checks, or modifying delete behavior.

## User surface

The human Library workspace is canonical at `/library`. The root selects
"All assets" and browses assets across every accessible brand kit; `/library/:id`
opens one kit's management detail. Legacy `/brand-kits` URLs redirect here.
Embedded picker hosts still load `/library` in an iframe and keep the existing
bridge contract.

## Schema overview

```
image_libraries           — top-level library, has ownableColumns + shares
  ├─ custom_instructions  — durable free-text prompt guidance
  └─ image_collections    — optional sub-grouping (categories), inherits access
  └─ image_assets         — every image (refs + generated), inherits access
  └─ image_generation_runs — one per generate call, inherits access
```

`image_assets` and `image_collections` and `image_generation_runs` do **NOT** carry `ownableColumns` themselves. They inherit access from their parent `library_id` via `assertAccess("asset-library", libraryId, ...)`.

## Access control

Every action that touches an ownable resource must scope its queries:

- **List queries**: `accessFilter(schema.assetLibraries, schema.assetLibraryShares)` in WHERE.
  Cross-kit asset lists must first resolve the accessible library IDs, then
  query `image_assets` by those IDs and include the parent kit title for UI chips.
- **Read by id**: `await resolveAccess("asset-library", libraryId)`. The `requireLibrary(id)` helper in `_helpers.ts` wraps this.
- **Write**: `await assertAccess("asset-library", libraryId, "editor")` for updates / inserts; `"admin"` for deletes.

All assets / runs derive `libraryId` first, then assert against the parent library. Never query `image_assets` without also pinning `library_id` to a value the caller has access to.

## Adding a new field

The schema is **strictly additive**. Hosted templates share their prod DB across every deploy context, so destructive changes wipe live user data. Rules:

- Add a column via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` in `server/plugins/db.ts` with a new migration version.
- Never rename or drop. If a column is wrong, add the replacement alongside it.
- Never use `drizzle-kit push` against production. The framework guard will fail the build.

Example: adding `image_libraries.icon`:

1. Bump the migration version array in `server/plugins/db.ts`:
   ```ts
   {
     version: 6,
     sql: `ALTER TABLE image_libraries ADD COLUMN IF NOT EXISTS icon TEXT`,
   },
   ```
2. Add `icon: text("icon")` to `schema.ts` for `image_libraries`.
3. Read it in actions. Done.

## Sharing

Libraries follow the standard framework sharing model:

- `visibility: "private" | "org" | "public"`
- Per-user / per-org grants in `image_library_shares` with `viewer | editor | admin` roles.
- Use the framework actions `share-resource`, `unshare-resource`, `set-resource-visibility` with `--resourceType=asset-library`. The legacy `image-library` alias remains registered for existing grants.

Generated assets and references inherit the parent library's visibility. v1 doesn't support per-asset overrides; the schema is forward-compatible (`image_generated_image_shares` could be added without disturbing existing rows) but not surfaced in the UI.

## Duplicating a brand kit

Use `duplicate-library` when a user wants a Brand Kit copy. The action creates a
private, current-user-owned copy with durable kit contents remapped, without
copying shares, visibility, generation runs, or handoff sessions.

## Cascade delete

`delete-library` deletes in order:

1. `image_assets WHERE library_id = ?`
2. `image_generation_runs WHERE library_id = ?`
3. `image_collections WHERE library_id = ?`
4. `image_library_shares WHERE resource_id = ?`
5. `image_libraries WHERE id = ?`

The asset rows are deleted from SQL but the underlying objects in S3 / local fallback are **not** automatically reaped — that's a v2 background job. For now, the orphaned blobs are tolerable since the framework's asset URLs all check access via the asset row.

## Reference vs. generated

Reference images and generated images live in the **same** `image_assets` table, distinguished by:

- `role` — what kind of evidence: `style_reference` / `logo_reference` / `product_reference` / `diagram_reference` / `generated`
- `status` — what to do with it: `reference` (uploaded by user) / `candidate` (just generated, ephemeral) / `saved` (user kept it) / `archived` (hidden) / `failed` (errored)

The unified table simplifies access control (one `library_id`, one access check) and makes "use a saved generation as a reference for a future generation" a first-class operation — just bump its `role` to `prior-candidate` (planned for v2; v1 just selects from any non-archived asset).

## Importing external references

Ingest external brand or blog imagery with `import-asset-from-url`, then pin the
returned asset to preset reference boards or set it as the canonical logo.

Use `import-asset-from-url` when the agent has found a public HTTPS image that
belongs in a brand kit, such as a blog hero, product shot, logo, campaign image,
or diagram. Choose the narrowest reference `role` (`style_reference`,
`subject_reference`, `product_reference`, `background_reference`,
`logo_reference`, or `diagram_reference`) and preserve a useful title or
description when known. The deliverable `category` defaults to match the role
(logo → `logo`, product → `product`, diagram → `diagram`); pass an explicit
`category` such as `hero` or `campaign` when the image belongs in one of those
filtered views.

For a blog-to-brand-kit workflow: inspect the page, pick the strongest image
URLs, import each URL into the target `libraryId`, then wire the returned
`assetId`s into generation preset reference fills or call `set-canonical-logo`
for the exact logo. Imported assets are stored as `status: "reference"` with
`sourceUrl` provenance, so downstream generation, preset boards, and logo
compositing can use them like uploaded reference assets.

## Importing a rendered visual system

Use `import-style-from-url` when a public website should contribute more than
images to a library or collection. It uses the same layered browser extractor
as Design and Slides, so CSS-in-JS, Tailwind, hydration, web fonts, computed
colors, component styles, spacing, radii, shadows, CSS variables, and logo
references are captured from the live cascade. The action persists a bounded
`designMd` summary plus structured fields in `styleBrief`, with the source URL
and any browser/static-fallback warnings preserved for provenance.

Prefer this action over copying raw HTML into a style brief. If the result is
`partial`, the structured values are still usable but the warnings must remain
visible to the agent; `failed` is an error and must not be treated as an empty
style brief.

## When to add a collection

Collections are optional. Most users won't create them. Use them when:

- A library has multiple distinct visual systems (e.g. "blog heroes" vs "landing imagery" within one brand library).
- The user wants per-collection defaults (aspect ratio, image size, style brief layered on top of the library's).

Skip them otherwise. A flat library with category-tagged assets covers most cases.
