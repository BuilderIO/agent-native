import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.shared";
import { buildMarkdownInventory } from "./app/vite-sitemap-plugin";

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      {
        name: "docs-test-markdown-inventory",
        resolveId(id) {
          if (id === "virtual:docs-markdown-inventory") return `\0${id}`;
        },
        load(id) {
          if (id === "\0virtual:docs-markdown-inventory") {
            return `export default ${JSON.stringify(buildMarkdownInventory(process.cwd()))};`;
          }
        },
      },
    ],
    test: {
      passWithNoTests: true,
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.output/**",
        "**/.{idea,git,cache,output,temp}/**",
      ],
    },
  }),
);
