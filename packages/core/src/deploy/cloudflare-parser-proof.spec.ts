import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import { patchCloudflareModuleServerOutput } from "./build.js";

it("skips chunks that Babel cannot parse instead of failing the deploy", async () => {
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
  const dir = fs.mkdtempSync(path.join(root, "worker-parser-proof-"));
  const bad = path.join(dir, "bad.mjs");
  const badSource = 'import x from "./y.mjs";\nconst a = @@@;\n';
  fs.writeFileSync(bad, badSource);
  const good = path.join(dir, "good.mjs");
  fs.writeFileSync(
    good,
    'import {createRequire} from "node:module";\nimport process from "node:process";\nexport default {fetch() { return Response.json({ process: createRequire(import.meta.url)("process") === process }); }};\n',
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => patchCloudflareModuleServerOutput(dir)).not.toThrow();
    expect(fs.readFileSync(bad, "utf8")).toBe(badSource);
    expect(warn.mock.calls.flat().join("\n")).toContain("bad.mjs");
    expect(fs.readFileSync(good, "utf8")).toContain(
      "/*__cf_process_require_shim__*/",
    );
    const worker = new Miniflare({
      modules: true,
      scriptPath: good,
      modulesRoot: dir,
      compatibilityDate: "2026-04-01",
      compatibilityFlags: ["nodejs_compat"],
    });
    try {
      const response = await worker.dispatchFetch("http://localhost/");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ process: true });
    } finally {
      await worker.dispose();
    }
  } finally {
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
