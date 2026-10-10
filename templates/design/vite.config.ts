import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

export default defineConfig({
  optimizeDeps: {
    include: [
      "mediabunny",
      "monaco-editor/esm/vs/editor/editor.api.js",
      "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js",
      "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js",
      "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js",
      "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js",
      "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js",
      "monaco-editor/esm/vs/language/css/monaco.contribution.js",
      "monaco-editor/esm/vs/language/html/monaco.contribution.js",
      "monaco-editor/esm/vs/language/json/monaco.contribution.js",
      "monaco-editor/esm/vs/language/typescript/monaco.contribution.js",
    ],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
    }),
  ],
});
