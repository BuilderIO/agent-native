import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

const docsRoot = path.resolve(import.meta.dirname, "..");
const coreRequire = createRequire(
  path.resolve(docsRoot, "../core/package.json"),
);

it("embeds the copied production public assets, including client-generated markdown", async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "docs-nitro-assets-"));
  const publicDir = path.join(output, "public");
  fs.mkdirSync(path.join(publicDir, "extra"), { recursive: true });
  fs.writeFileSync(path.join(publicDir, "extra", "generated.md"), "# Extra\n");
  fs.writeFileSync(path.join(publicDir, "README.md"), "# Public\n");
  const { createNitro } = await import(
    pathToFileURL(coreRequire.resolve("nitro/builder")).href
  );
  const nitro = await createNitro({
    rootDir: docsRoot,
    dev: false,
    preset: "netlify",
    output: { dir: output, publicDir },
  });
  try {
    await nitro.hooks.callHook("build:before", nitro);
    const virtual = nitro.options.virtual["virtual:docs-markdown-inventory"];
    const source = typeof virtual === "function" ? await virtual() : virtual;
    const { default: inventory } = await import(
      `data:text/javascript,${encodeURIComponent(source)}`
    );
    expect(inventory).toContain("extra/generated.md");
    expect(inventory).toContain("README.md");
    expect(inventory).not.toContain("mcp.md");
  } finally {
    await nitro.close();
    fs.rmSync(output, { recursive: true, force: true });
  }
});
