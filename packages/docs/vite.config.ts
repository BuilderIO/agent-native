import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vite";

import { sitemapPlugin } from "./app/vite-sitemap-plugin";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    tailwindcss(),
    wgslVitePlugin(),
    ...reactRouterPlugins(),
    sitemapPlugin(),
    ...agentNativePlugins({
      tailwind: false,
      // Syntax highlighting is hydrated after the document loads. Keeping
      // Shiki out of the SSR graph avoids loading its language catalog on a
      // cold docs Function just to render the initial Markdown shell.
      // These render in the browser only — the server just passes the fence
      // source through (app/components/docBlocks.tsx), and MermaidBlock draws
      // it in a post-mount effect. Core already classifies all three as
      // browser-only (BROWSER_ONLY_SERVER_LIBS), but that list stubs Nitro's
      // graph, and Vite's SSR build resolves them to relative chunk paths
      // first, so Nitro never sees the bare specifier. Stubbing here is what
      // actually reaches them. Measured on the netlify preset: server function
      // 62.8MB -> 55.9MB, and the deploy uploads two copies of it, so 125.6MB
      // -> 111.8MB. Excalidraw does not resolve from this package directly; it
      // arrives through @agent-native/core, which is why naming it still works.
      // Do not stub Tiptap or ProseMirror: Toolkit editor modules call them at
      // module scope, and SSR chunking can place them in an eagerly imported
      // server chunk even though docs do not render the editor UI.
      // lowlight stays real (core's doc block highlighter runs server-side via
      // preloadDocBlocksContent), and so do yjs/y-protocols/lib0 (core collab
      // uses yjs on the server).
      // Deliberately NOT stubbing "vgpu": the hero ocean renderer imports its
      // named exports at module scope, and a stub exports nothing, so the SSR
      // build fails on MISSING_EXPORT rather than tree-shaking cleanly. It is
      // also unnecessary -- the Dawn native adapter is reachable only through
      // the `vgpu/node` entry, which nothing here imports. The browser runtime
      // that does land in the server graph is inert JS, and
      // tests/hero-background-bundle.test.ts holds the line that matters:
      // no @vgpu/adapter-node and no .node binary in dist/server.
      ssrStubs: [
        "shiki",
        "mermaid",
        "@excalidraw/excalidraw",
        "@excalidraw/mermaid-to-excalidraw",
        "@assistant-ui/react",
      ],
      routeWarmup: {
        strategy: "viewport",
        data: true,
        modules: true,
        maxConcurrent: 8,
      },
    }),
  ],
});
