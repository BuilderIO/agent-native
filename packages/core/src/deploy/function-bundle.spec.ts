import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cloneServerBundleForFunction } from "./function-bundle.js";

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
