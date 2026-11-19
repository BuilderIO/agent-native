import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import { patchCloudflareModuleServerOutput } from "./build.js";

it("skips chunks that Babel cannot parse instead of failing the deploy", () => {
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
    'import {createRequire} from "node:module";\nexport const p = createRequire(import.meta.url)("process");\n',
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => patchCloudflareModuleServerOutput(dir)).not.toThrow();
    expect(fs.readFileSync(bad, "utf8")).toBe(badSource);
    expect(warn.mock.calls.flat().join("\n")).toContain("bad.mjs");
    expect(fs.readFileSync(good, "utf8")).not.toContain(
      'createRequire(import.meta.url)("process")',
    );
  } finally {
    warn.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
