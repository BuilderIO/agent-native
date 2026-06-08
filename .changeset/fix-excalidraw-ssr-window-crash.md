---
"@agent-native/core": patch
---

Fix production 502s on SSR apps (docs, slides, content, assets) caused by the
browser-only Excalidraw/Mermaid renderers leaking into the Nitro server bundle.
Nitro re-bundles the server from node_modules and Rolldown merged
`@excalidraw/excalidraw` into a shared vendor chunk that the SSR render path
(tiptap, radix-ui, recharts) imported statically, so its top-level `window`
access ran at function cold-start and crashed every request with
`ReferenceError: window is not defined`. The Vite SSR build already stubbed these
libs for `build/server`, but that plugin didn't run during Nitro's separate
bundle. The deploy build now mirrors the same stub as a Rolldown plugin, replacing
`@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, and `mermaid` with
an inert proxy in the server bundle (they only ever render client-side).
