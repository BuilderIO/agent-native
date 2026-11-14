import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";
import { expect, it } from "vitest";

import { patchCloudflareModuleServerOutput } from "./build.js";

it("loads process through createRequire without changing other require behavior in workerd", async () => {
  const requireFromWrangler = createRequire(
    createRequire(import.meta.url).resolve("wrangler/package.json"),
  );
  const { Miniflare } = requireFromWrangler("miniflare") as {
    Miniflare: new (options: {
      modules: boolean;
      scriptPath: string;
      modulesRoot: string;
      compatibilityDate: string;
      compatibilityFlags: string[];
    }) => {
      dispatchFetch(url: string): Promise<Response>;
      dispose(): Promise<void>;
    };
  };
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    ".tmp",
  );
  fs.mkdirSync(root, { recursive: true });
  const serverDir = fs.mkdtempSync(path.join(root, "worker-process-proof-"));
  const imports = [
    ['import { createRequire as factory } from "node:module";', "factory"],
    ['import * as module from "node:module";', "module.createRequire"],
    ['import module from "node:module";', "module.createRequire"],
  ];

  try {
    for (const minify of [false, true]) {
      for (const [moduleImport, factory] of imports) {
        const source = `${moduleImport}
          import process from "node:process";
          const __cf_process = "collision";
          const require = ${factory}(import.meta.url);
          require.extra = 42;
          const shadow = (factory) => factory("process");
          export default { fetch() {
            let missing;
            try { require("not-a-real-module"); } catch (error) { missing = error.message; }
            return Response.json({
              bare: require("process") === process,
              node: require("node:process") === process,
              dynamic: require(["pro", "cess"].join("")) === process,
              direct: ${factory}(import.meta.url)("node:process") === process,
              buffer: typeof require("node:buffer").Buffer,
              extra: require.extra,
              shadow: shadow((value) => "local:" + value),
              collision: __cf_process,
              missing: missing.includes("not-a-real-module"),
            });
          } };`;
        const file = path.join(serverDir, "worker.mjs");
        const built = await transform(source, { format: "esm", minify });
        fs.writeFileSync(file, built.code);
        patchCloudflareModuleServerOutput(serverDir);
        const once = fs.readFileSync(file, "utf8");
        patchCloudflareModuleServerOutput(serverDir);
        expect(fs.readFileSync(file, "utf8")).toBe(once);

        const worker = new Miniflare({
          modules: true,
          scriptPath: file,
          modulesRoot: serverDir,
          compatibilityDate: "2026-04-01",
          compatibilityFlags: ["nodejs_compat"],
        });
        try {
          const response = await worker.dispatchFetch("http://localhost/");
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({
            bare: true,
            node: true,
            dynamic: true,
            direct: true,
            buffer: "function",
            extra: 42,
            shadow: "local:process",
            collision: "collision",
            missing: true,
          });
        } finally {
          await worker.dispose();
        }
      }
    }
  } finally {
    fs.rmSync(serverDir, { recursive: true, force: true });
  }
});
