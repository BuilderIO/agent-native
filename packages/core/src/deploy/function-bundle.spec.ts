import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cloneServerBundleForFunction,
  pruneBrowserRuntimeFromNonAgentClone,
} from "./function-bundle.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-function-bundle-"));
  tmpRoots.push(root);
  return root;
}

describe("cloneServerBundleForFunction", () => {
  it("hard-links files instead of copying their bytes", () => {
    const root = makeTmpRoot();
    const src = path.join(root, "server");
    fs.mkdirSync(path.join(src, "_libs"), { recursive: true });
    fs.writeFileSync(path.join(src, "_libs", "yjs.mjs"), "bundle");

    const dest = path.join(root, "background");
    cloneServerBundleForFunction(src, dest);

    const clone = path.join(dest, "_libs", "yjs.mjs");
    expect(fs.statSync(clone).ino).toBe(
      fs.statSync(path.join(src, "_libs", "yjs.mjs")).ino,
    );
  });

  it("links a symlinked source's target, so the clone is never a symlink", () => {
    const root = makeTmpRoot();
    const target = path.join(root, "store", "dep.mjs");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "dep");

    const src = path.join(root, "server", "node_modules", "dep");
    fs.mkdirSync(src, { recursive: true });
    // A relative link, as a package manager writes: it would dangle in the
    // clone, which sits at a different depth than the source.
    fs.symlinkSync(
      path.relative(src, target),
      path.join(src, "index.mjs"),
      "file",
    );

    const dest = path.join(root, "background");
    cloneServerBundleForFunction(src, dest);

    const clone = path.join(dest, "index.mjs");
    // link(2) does not dereference on Linux, so linking the link itself would
    // ship a symlink here — every deploy reader is entitled to a regular file.
    expect(fs.lstatSync(clone).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(clone, "utf8")).toBe("dep");
    expect(fs.statSync(clone).ino).toBe(fs.statSync(target).ino);
  });
});

describe("pruneBrowserRuntimeFromNonAgentClone orphan closure", () => {
  let dir: string;

  const REWRITING_ENTRY =
    'const url = new URL(req.url);\nurl.pathname = "/api/dashboard-report-sweep";\n';

  beforeEach(() => {
    dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-function-bundle-orphans-"),
    );
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePackage(
    name: string,
    dependencies: Record<string, string> = {},
  ): void {
    const pkgDir = path.join(dir, "node_modules", ...name.split("/"));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name, dependencies }),
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "x".repeat(4096));
  }

  it("removes a package that exists only because the browser runtime needed it", () => {
    writePackage("@sparticuz/chromium-min", { "orphan-tar": "^1.0.0" });
    writePackage("playwright-core");
    writePackage("orphan-tar");

    const freed = pruneBrowserRuntimeFromNonAgentClone(dir, REWRITING_ENTRY);

    expect(freed).toBeGreaterThan(0);
    expect(
      fs.existsSync(path.join(dir, "node_modules", "orphan-tar")),
    ).toBe(false);
  });

  it("keeps a closure member an unrelated surviving package also depends on", () => {
    writePackage("@sparticuz/chromium-min", { "shared-lib": "^1.0.0" });
    writePackage("playwright-core");
    writePackage("shared-lib");
    // Not reachable from the browser runtime at all — an ordinary server
    // dependency that happens to need the same small utility package.
    writePackage("some-real-dependency", { "shared-lib": "^1.0.0" });

    pruneBrowserRuntimeFromNonAgentClone(dir, REWRITING_ENTRY);

    expect(fs.existsSync(path.join(dir, "node_modules", "shared-lib"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(dir, "node_modules", "some-real-dependency")),
    ).toBe(true);
  });

  it("throws instead of guessing when a closure member has no readable package.json", () => {
    writePackage("@sparticuz/chromium-min", { "broken-dep": "^1.0.0" });
    writePackage("playwright-core");
    // Present on disk but not a readable package — e.g. an install that never
    // finished. Reachability cannot be trusted past this point.
    fs.mkdirSync(path.join(dir, "node_modules", "broken-dep"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, "node_modules", "broken-dep", "index.js"),
      "x",
    );

    expect(() =>
      pruneBrowserRuntimeFromNonAgentClone(dir, REWRITING_ENTRY),
    ).toThrow(/no readable package\.json/);
  });
});
