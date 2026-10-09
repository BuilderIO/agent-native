# Figma interoperability

Design can import Figma content, accept clipboard content, export SVG, and use
connected Figma tools for file context or native canvas writes. These paths use
different APIs and data, so their capabilities and limitations differ.

## Import

- **Frame URL or file key:** `import-figma-frame` reads a file or node through
  Figma's REST API and saves the supported content as a new Design screen. The
  action uses the saved, user-scoped `FIGMA_ACCESS_TOKEN` secret with
  `current_user:read` and `file_content:read`; do not put tokens in chat or
  source code. If no node id is supplied, the importer chooses the first
  `FRAME` node on the file's first page.
- **Clipboard:** `import-figma-clipboard` uses selection metadata to identify
  nodes when the clipboard provides it. With a token, it can fetch those nodes
  through the REST path. Without a token, the local decoder supports a subset of
  geometry, text, and styles; image references can remain unresolved until the
  user supplies a token or the source file.
- **`.fig` upload:** the local decoder handles supported file variants without
  a REST request. It is best-effort input. Browser imports accept files up to
  2 GiB (`BROWSER_FIG_LIMITS`); server-side decoding stays capped at 50 MiB
  uploads and 96 MiB of decompressed data (`SERVER_FIG_LIMITS`).

Imported screens can contain approximations or image fallbacks for constructs
that the Design HTML/CSS representation cannot express. The import action
returns a report describing these cases. Review that report before relying on
an imported result.

### Image and file handling

The REST importer fetches remote images through the shared SSRF-safe fetch
helper, validates their MIME type and byte signature, applies per-image and
total import budgets, and stores successful images in the user's configured
durable file storage. Provider image URLs can expire, so the importer does not
use them as durable asset references. Current limits are defined in
`templates/design/server/lib/figma-node-import.ts` and
`templates/design/server/lib/fig-file-limits.ts`.

## Export and connected tools

- Design's SVG export creates a vector handoff for supported content. Images
  remain raster, and unsupported content may be approximated or omitted; the
  export report describes those cases.
- SVG export and Figma-native canvas writes are separate paths. Use Figma's
  official connected MCP write tools when available and authorized; the REST
  file endpoints used for import provide file and node data.
- Figma library, component, style, and variable context is available through
  the connected provider actions when the connection has the required scopes.
  Figma REST token scopes include `library_content:read` for file libraries,
  `team_library_content:read` for team libraries, and Enterprise-only
  `file_variables:read` for file variables. Figma can change scope and rate
  limit policies; see its current documentation.

## Implementation entry points

- Frame import: `templates/design/actions/import-figma-frame.ts` and
  `templates/design/server/lib/figma-node-import.ts`.
- Clipboard import: `templates/design/actions/import-figma-clipboard.ts` and
  `templates/design/app/lib/figma-clipboard.ts`.
- `.fig` upload: `templates/design/server/handlers/import-design-file.ts` and
  `templates/design/server/lib/fig-file-limits.ts`.
- SVG export: `templates/design/actions/export-design-as-figma-svg.ts` and
  `templates/design/server/lib/design-to-figma-svg.ts`.
- Connected file context: `templates/design/actions/get-figma-design-context.ts`
  and `templates/design/actions/list-figma-library-assets.ts`.

## Figma documentation

- [REST API file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)
- [REST API node types](https://developers.figma.com/docs/rest-api/file-node-types/)
- [REST API scopes](https://developers.figma.com/docs/rest-api/scopes/)
- [REST API rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)
- [MCP write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)
- [MCP code to canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/)
