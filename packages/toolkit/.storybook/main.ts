import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import type { Manifests } from "storybook/internal/types";
import { mergeConfig } from "vite";

import { migrationStatus } from "../dev/migration-status/vite-plugin.js";
import { withImportTags } from "./manifest-imports.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev-only: renders toolkit parts from source under every theme, appearance,
// density, radius and brand. Not part of the published package.
const config: StorybookConfig & {
  experimental_manifests?: (manifests: Manifests) => Manifests;
} = {
  stories: ["../dev/stories/**/*.mdx", "../dev/stories/**/*.stories.tsx"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    // Serves the MCP tools agents read the components from, at /mcp.
    "@storybook/addon-mcp",
    // Runs every story as a Vitest browser test (vitest.storybook.config.ts).
    "@storybook/addon-vitest",
  ],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  // /manifests/components.json: each component's props, stories and docs.
  features: { componentsManifest: true },
  // Each component's import, from the `@import` tag on its doc comment.
  experimental_manifests: (manifests) =>
    withImportTags(
      manifests,
      [
        path.resolve(here, "../src/ui/base-ui"),
        path.resolve(here, "../src/app/shared"),
      ],
      "@agent-native/toolkit",
    ),
  typescript: {
    // Reads each prop's JSDoc, which the catalog's generated prop types
    // carry; react-docgen's faster parse drops it.
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      tsconfigPath: path.resolve(here, "../dev/tsconfig.json"),
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
    },
  },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      plugins: [tailwindcss(), migrationStatus(path.resolve(here, "../../.."))],
      resolve: {
        // Exact match only: CSS subpaths (tokens.css, themes/*) resolve
        // through the package's exports.
        alias: [
          {
            find: /^@agent-native\/design-system$/,
            replacement: path.resolve(here, "../../design-system/src/index.ts"),
          },
        ],
      },
    }),
};

export default config;
