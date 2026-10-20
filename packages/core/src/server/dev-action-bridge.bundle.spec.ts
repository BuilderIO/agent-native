import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("dev migration bundle boundary", () => {
  it("does not add local PGlite adapters to the deploy dependency graph", async () => {
    const result = await build({
      entryPoints: [
        fileURLToPath(new URL("./dev-action-bridge.ts", import.meta.url)),
      ],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      write: false,
      metafile: true,
    });
    const imports = Object.values(result.metafile!.inputs).flatMap((input) =>
      input.imports.map((entry) => entry.path),
    );
    expect(imports).not.toContain("drizzle-orm/pglite");
    expect(imports).not.toContain("drizzle-orm/pglite/migrator");
    expect(imports).not.toContain("@electric-sql/pglite");
  });
});
