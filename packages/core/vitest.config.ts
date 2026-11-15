import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import corePackage from "./package.json";
import baseConfig from "./src/vitest-config";
import { workspaceRoot } from "./vitest.workspace-root";

const templatesRoot = path.join(workspaceRoot, "templates");

function defaultExport(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (target && typeof target === "object" && "default" in target) {
    return defaultExport(target.default);
  }
  return undefined;
}

// External template imports must reach Stryker's copied Core, not installed dist.
const sandboxCoreAliases =
  path.resolve(__dirname) === path.join(workspaceRoot, "packages/core")
    ? []
    : Object.entries(corePackage.exports).flatMap(([subpath, target]) => {
        const runtime = defaultExport(target);
        if (!runtime?.startsWith("./dist/") || !runtime.endsWith(".js")) {
          return [];
        }
        const stem = path.join(__dirname, "src", runtime.slice(7, -3));
        const source = [`${stem}.ts`, `${stem}.tsx`].find(existsSync);
        if (!source) {
          throw new Error(`Missing Core source for export ${subpath}`);
        }
        const name = `@agent-native/core${subpath === "." ? "" : subpath.slice(1)}`;
        return [
          {
            find: new RegExp(
              `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            ),
            replacement: source,
          },
        ];
      });

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: { alias: sandboxCoreAliases },
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
          // Only importers inside the repo's templates folder: core also
          // bundles its own `src/templates`, which must keep resolving normally.
          const relative = importer
            ? path.relative(templatesRoot, importer.split("?")[0]!)
            : "..";
          const template =
            relative.startsWith("..") || path.isAbsolute(relative)
              ? undefined
              : relative.split(path.sep)[0];
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
