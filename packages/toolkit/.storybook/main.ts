import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import remarkGfm from "remark-gfm";
import type { Manifests } from "storybook/internal/types";
import { mergeConfig } from "vite";

import { migrationStatus } from "../dev/migration-status/vite-plugin.js";
import { withImportTags } from "./manifest-imports.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig & {
  experimental_manifests?: (manifests: Manifests) => Manifests;
} = {
  stories: ["../dev/stories/**/*.mdx", "../dev/stories/**/*.stories.tsx"],
  addons: [
    {
      name: "@storybook/addon-docs",
      options: {
        mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } },
      },
    },
    "@storybook/addon-a11y",
    "@storybook/addon-mcp",
    "@storybook/addon-vitest",
  ],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  features: { componentsManifest: true },
  experimental_manifests: (manifests) =>
    withImportTags(
      manifests,
      [
        path.resolve(here, "../src/ui/base-ui"),
        path.resolve(here, "../src/app/shared"),
      ],
      "@agent-native/toolkit",
      path.resolve(here, ".."),
    ),
  typescript: {
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
