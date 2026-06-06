---
"@agent-native/core": minor
---

Add a standard `tabs` block to the core block library
(`@agent-native/core/blocks`): a horizontal pill-tab container whose tabs each
hold their own list of child blocks. It exports `tabsBlock` (the full React
spec), `TabsBlockReader`/`TabsBlockEditor`, and the React-free
`tabsSchema`/`tabsMdx` config (from `@agent-native/core/blocks/server`). The MDX
encoding matches the legacy `<TabsBlock … tabs={[…]} />` form — labels and
nested child blocks are one JSON `tabs` prop (not nested MDX) — so stored
documents round-trip byte-compatibly.

Container blocks render their children through a new optional
`BlockRenderContext.renderBlock` capability (with a `NestedBlock` shape): the app
wires it to its own block dispatcher so registered children render via their spec
and unconverted children fall through the app's legacy path. This is the
coexistence seam that lets a core container block render app-specific child
blocks without importing them.
