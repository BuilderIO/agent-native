import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerOutDir = path.join(configDirectory, "out", "main");

export default defineConfig({
  ssr: { noExternal: true },
  build: {
    emptyOutDir: false,
    outDir: runnerOutDir,
    rollupOptions: {
      external: ["electron", /^electron\/.+/],
      input: path.join(
        configDirectory,
        "src",
        "main",
        "code-agent-runner-entry.ts",
      ),
      output: {
        entryFileNames: "code-agent-runner-entry.js",
        format: "cjs",
        codeSplitting: false,
      },
    },
    ssr: true,
  },
});
