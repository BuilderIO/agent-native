import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerOutDir = path.join(configDirectory, "out", "main");
const smokeEntry =
  process.env.AGENT_NATIVE_PACKAGED_MULTI_FRONTIER_SMOKE === "1";

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
        smokeEntry
          ? "packaged-multi-frontier-smoke-entry.ts"
          : "code-agent-runner-entry.ts",
      ),
      output: {
        entryFileNames: smokeEntry
          ? "packaged-multi-frontier-smoke-entry.js"
          : "code-agent-runner-entry.js",
        format: "cjs",
        codeSplitting: false,
      },
    },
    ssr: true,
  },
});
