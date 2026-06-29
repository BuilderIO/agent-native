---
"@agent-native/core": patch
---

Pin Nitro's `nf3` file-tracer to `0.3.17` in scaffolded workspace/app `pnpm-workspace.yaml` overrides. `nf3@0.3.18` switched to a named ESM import of `nodeFileTrace` from the CJS-only `@vercel/nft`, which crashed `agent-native build` (Nitro production build) in freshly scaffolded workspaces with "Named export 'nodeFileTrace' not found. The requested module '@vercel/nft' is a CommonJS module". `0.3.17` does not pull in `@vercel/nft`, restoring a green scaffold + build.
