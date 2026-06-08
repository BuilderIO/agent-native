---
"@agent-native/core": patch
---

Re-add and redesign the `annotated-code` dev-doc block for Plans/Content (block
source, client/server registries, schema, slash menu, and skill guidance).

The read view now renders a standard syntax-highlighted code surface (shared
`code-highlight` lowlight palette, matching the `code-tabs` block) with a
highlight band + accent rail on annotated line ranges and the notes as
always-visible cards to the side (Stripe-docs "explain this code" layout).
Code lines render as spans rather than one `<pre>` per line, so they no longer
pick up document code/pre chrome, and the surface is theme-aware in light and
dark. Restores the block removed in the previous patch while keeping the SSR
cold-start smoke test.
