import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerOutDir = path.join(configDirectory, "out", "main");

function copyRunnerRuntimePackage(
  packageName: string,
  from: NodeRequire,
): void {
  const packagePath = from.resolve(`${packageName}/package.json`);
  const destination = path.join(runnerOutDir, "node_modules", packageName);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.dirname(packagePath), destination, { recursive: true });
}

function copyRunnerRuntimePackages(): Plugin {
  return {
    name: "agent-native:copy-code-agent-runner-runtime-packages",
    closeBundle() {
      const coreRequire = createRequire(
        path.join(configDirectory, "..", "core", "package.json"),
      );
      const sdkPackagePath = coreRequire.resolve(
        "@modelcontextprotocol/sdk/package.json",
      );
      copyRunnerRuntimePackage("ajv", coreRequire);
      copyRunnerRuntimePackage("ajv-formats", createRequire(sdkPackagePath));
    },
  };
}

export default defineConfig({
  ssr: { noExternal: true },
  plugins: [copyRunnerRuntimePackages()],
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
