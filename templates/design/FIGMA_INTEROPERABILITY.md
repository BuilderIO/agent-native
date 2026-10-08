# Figma interoperability

Design supports importing content from Figma, pasting clipboard content into
the canvas, and exporting designs for use in other tools.

## Import

- Import a frame from a Figma share URL through the Import panel or
  import-figma-frame action.
- Paste supported clipboard content into the Design canvas.
- Upload a local .fig file through the Import panel.
- Use the connected Figma MCP tools to read files, components, variables, and
  design context when the connection provides those capabilities.

Imported content is saved as editable Design screens where supported. Some
source constructs may be omitted, approximated, or represented as an image.
Review the import report for warnings before relying on the result.

## Export

- Download PNG and PDF renders from the Design editor.
- Export an editable SVG document for tools that accept SVG content.
- Use the coding handoff action when continuing implementation in a codebase.

Export output depends on the selected format and the content being exported.
Use the Design editor's export report and preview when reviewing generated
files.

## Implementation entry points

- Frame and file import: templates/design/actions/import-figma-frame.ts and
  templates/design/server/lib/figma-node-import.ts.
- Clipboard import: templates/design/actions/import-figma-clipboard.ts and
  templates/design/app/lib/figma-clipboard.ts.
- SVG export: templates/design/actions/export-design-as-figma-svg.ts and
  templates/design/server/lib/design-to-figma-svg.ts.
- Connected file context: templates/design/actions/get-figma-design-context.ts
  and templates/design/actions/list-figma-library-assets.ts.
