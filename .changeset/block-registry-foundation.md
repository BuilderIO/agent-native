---
"@agent-native/core": minor
---

Add a first-party block registry (`@agent-native/core/blocks`). A `BlockSpec`
describes one document block end to end — a zod `schema` for its data, an `mdx`
config for byte-stable MDX round-trip, a `Read` renderer, an optional `Edit`
(auto-generated from the schema when omitted), and `placement` (top-level
and/or inline). Apps create a `BlockRegistry`, register their specs, and render
through `BlockView` inside a `BlockRegistryProvider`.

- `defineBlock` / `BlockRegistry` / `registerBlocks` — author and register blocks.
- `BlockRegistryProvider` / `useBlockRegistry` — thread the registry + runtime
  render context (asset resolver, action caller, inline markdown editor) into React.
- `SchemaBlockEditor` + the `markdown()` zod helper — a schema-driven auto-editor
  that renders shadcn-style controls per field, with `markdown()`-tagged string
  fields editing inline via the app's rich-markdown editor.
- `serializeSpecBlock` / `parseSpecBlock` + the shared `prop()` encoder and
  estree attribute reader (exported from the React-free
  `@agent-native/core/blocks/server` entry) — registry-driven MDX round-trip that
  reproduces the existing component/attribute encoding for backward compatibility.
- `describeBlocksForAgent` — generate the agent's block vocabulary from the registry.

The registry is designed to run alongside existing per-block code: renderers and
the MDX adapter check the registry first and fall back to legacy paths for
unregistered block types, so existing documents keep working unchanged.
