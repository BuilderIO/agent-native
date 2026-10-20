import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

import { createBoundedTaskRunner } from "./index.js";

describe("collab runtime bundle", () => {
  it("keeps the task compiler out of the runtime dependency graph", async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      packages: "external",
      metafile: true,
      logLevel: "silent",
    });

    const imports = Object.values(result.metafile!.outputs).flatMap((output) =>
      output.imports.map((entry) => entry.path),
    );
    const inputImports = Object.values(result.metafile!.inputs).flatMap(
      (input) => input.imports.map((entry) => entry.path),
    );
    expect(imports).not.toContain("esbuild");
    expect(inputImports).not.toContain("esbuild");
    expect(createBoundedTaskRunner).toBeTypeOf("function");
  });
});
