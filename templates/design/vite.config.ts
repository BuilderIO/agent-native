import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      // A Cloudflare Worker may not exceed 3 MB gzipped on Workers Free or
      // 10 MB on Workers Paid, counted across every uploaded module. SSR's
      // noExternal policy pulls each of these into the React Router server
      // graph even though every one of them is reached only from a browser
      // effect — together ~7 MB of that budget:
      //   shiki          — AssistantChat's useEffect
      //   monaco-editor  — code workbench editor host, mounted in useEffect
      //   prettier       — workbench format-on-save, plus per-language plugins
      //   html2canvas    — canvas capture, needs a real DOM
      //   jspdf          — PDF assembled from that capture, in the browser
      // This covers the React Router SSR graph only. Nitro builds `server/`
      // and `actions/` on its own, so core's extension content patcher still
      // links the real Prettier for its server-side HTML formatting.
      // Dropping an entry reintroduces the size failure at deploy time rather
      // than at build time, so re-check `wrangler deploy --dry-run` against
      // .output/server before shortening this list.
      ssrStubs: ["shiki", "monaco-editor", "prettier", "html2canvas", "jspdf"],
    }),
  ],
});
