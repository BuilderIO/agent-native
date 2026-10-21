import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("Fetch MCP entry point portability", () => {
  it("bundles its transitive graph for a Web runtime", async () => {
    const result = await build({
      entryPoints: [new URL("./fetch-handler.ts", import.meta.url).pathname],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
    });

    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0]?.text).not.toMatch(/(?:node:|from ["']h3)/);
  });
});
