# Local File Mode Reference

Content has one database-backed document model with optional folder sources.
This file covers the folder-source workflow, the manifest/CLI bridge, and
local MDX components in full; the `content` skill's "Local Folder Sources"
section is the short version.

## Local folder sources

The `/local-files` view links one or more browser or Agent Native Desktop
folders to SQL-backed documents. The UI uses folder rows: **Pull** calls
`sync-local-folder-source`, **Check** runs the same action with
`dryRun: true`, and **Push** uses the source-scoped `export-content-source`.
Imported files become ordinary SQL documents in the target space's canonical
Files database. Preserve frontmatter `id` across renames; missing files and
concurrent changes become reviewable incoming change sets instead of
silently deleting or overwriting a page. SQL stores only opaque connection
identity, relative paths, and hashes. Disconnecting a folder keeps both the
Content pages and disk files.

## Manifest/CLI bridge

`agent-native content local-files <target>` remains as a compatibility
spelling, but it launches normal database-backed Content. `agent-native.json`
declares `source.type: "local-folder"` and an opaque `connectionId`; it does
not select a separate application mode. The trusted local server bridge
materializes that source through `sync-manifest-local-folder-source`.

Launch Content directly against a local folder or file with:

```bash
agent-native content local-files docs --profile docs/no-bookkeeping
agent-native content local-files docs/guide.mdx --profile docs/no-bookkeeping
```

Minimal `agent-native.json`:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "profile": "docs/no-bookkeeping",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "profile": "docs/no-bookkeeping",
          "extensions": [".md", ".mdx"]
        },
        { "name": "Blog", "path": "blog", "extensions": [".md", ".mdx"] },
        {
          "name": "Resources",
          "path": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components"
    }
  }
}
```

In Local File Mode, use the normal document actions (`list-documents`,
`get-document`, `create-document`, `update-document`, `delete-document`)
instead of raw filesystem writes when operating through the app. To share a
local file, call `share-local-file-document --id <local-file-document-id>`
first; it creates or refreshes a database-backed copy and returns the
shareable document id. Provider sync such as Builder.io pull/push should
remain a Content-specific explicit sync action.

## Local MDX components

Local file workspaces can expose React components from the configured
`components` folder. Export PascalCase components such as `ImpactCounter`
from `.tsx` files, then use `<ImpactCounter />` in MDX or pick it from the
editor slash menu under Local components. Simple string props are previewed.
Components can export editable input metadata such as `ImpactCounterInputs`
with `string`, `textarea`, `number`, `boolean`, and `select` fields;
selecting the component in the editor shows a corner edit button that
rewrites the MDX props. JSX expression props are preserved in source but
shown as an unsupported preview.

## Reusable MDX references

Local-file MDX can embed another local document with
`<ContentReference sourcePath="./shared/example.mdx" />`. The editor resolves
`sourcePath` relative to the current file, previews the referenced MDX
read-only in place, and preserves the original tag in source. Use this for
reusable docs fragments instead of copy/pasting shared content.

## Builder Symbols

Builder MDX pulls preserve Symbol blocks as `<BuilderSymbol ... />`. When
Builder returns enriched symbol content, the pull also writes a referenced
`.builder.mdx` file under `content/builder/symbols/` and sets the Symbol
block's `source` attribute. Edit reusable symbol content in that emitted
source file; do not retarget `entry`, `model`, or `source` in the parent MDX
unless a dedicated Builder retargeting workflow is added.

## Builder source components

Builder CMS database body hydration renders unsupported provider-native body
blocks as `<SourceComponent ... />` markers. These markers include
`mappingStatus` and `sourceEditState`: `mapped` / `safe-to-edit` content has
an explicit Markdown/NFM mapper, `preserved` / `needs-review` content keeps a
known Builder/source component intact for review, and `unknown` /
`preserved-only` content is an unmapped provider block that must round-trip
as-is. Treat source-component markers as read-only preservation anchors, not
editable local blocks. Agents may edit surrounding prose, but must not
delete, duplicate, move, or rewrite `rawRef`, `rawHash`, mapping metadata, or
marker ids unless a dedicated provider conversion workflow exists. Guarded
Builder write-back refuses missing, tampered, or structurally moved markers
so source-native components are not lost. Readable bodies hydrated before
source-component mapping may need a fresh Builder body hydration pass before
guarded push, because newly preserved markers are intentionally treated as
structure changes.

## Picked folders and components

Browser-picked folders can be the source of truth for `.md`/`.mdx` files, but
the browser does not expose an absolute path that Vite can compile. Component
previews from a picked `components/` folder require Agent Native Desktop or a
local Content dev server. Desktop-selected folders register their workspace
path with the local dev server so Vite can import and hot reload
`components/*.tsx`.

## Agent component edits

Use `list-local-component-files` to find the registered workspace id, then
`write-local-component-file` to add or edit `.tsx`, `.jsx`, `.ts`, or `.js`
files under that workspace's `components/` folder. The Vite component
registry reloads after file additions/removals; edits to already-loaded files
hot reload through Vite.
