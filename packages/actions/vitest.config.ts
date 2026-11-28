import { createRequire } from "node:module";
import path from "node:path";

import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const solidClientEntry = path.resolve(
  path.dirname(require.resolve("solid-js/package.json")),
  "dist/solid.js",
);

export default defineConfig({
  resolve: {
    alias: {
      "solid-js": solidClientEntry,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.test.ts"],
  },
});
