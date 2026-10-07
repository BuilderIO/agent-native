import path from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "./src/vitest-config";

const templatesRoot = path.resolve(__dirname, "../../templates");

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      {
        // Specs that load template modules (a template's action registry)
        // reach files that import `@/` and `@shared/`. Each template's own
        // vitest config maps those to its own folders, so resolve them
        // against the importing template here.
        name: "template-path-aliases",
        enforce: "pre",
        async resolveId(source, importer, options) {
          const alias = /^@(shared)?\/(.*)$/.exec(source);
          const template = /[\\/]templates[\\/]([^\\/]+)[\\/]/.exec(
            importer ?? "",
          )?.[1];
          if (!alias || !template) return null;
          return this.resolve(
            path.join(
              templatesRoot,
              template,
              alias[1] ? "shared" : "app",
              alias[2]!,
            ),
            importer,
            { ...options, skipSelf: true },
          );
        },
      },
    ],
    test: {
      globalSetup: ["./vitest.global-setup.ts"],
      setupFiles: ["./vitest.setup.ts"],
    },
  }),
);
