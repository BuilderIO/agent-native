import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findRecursiveCopies,
  isGuardedSourcePath,
} from "./guard-recursive-copy-links.js";

const FILE = "packages/core/src/cli/example.ts";

function flagged(source: string) {
  return findRecursiveCopies(FILE, source).map((finding) => finding.line);
}

describe("recursive copy links guard", () => {
  it("flags recursive copies that leave links to Node's default", () => {
    const source = [
      "fs.cpSync(src, dest, { recursive: true });",
      "cpSync(src, dest, { recursive: true, force: true });",
      "await fs.promises.cp(src, dest, { recursive: true });",
      "await cp(src, dest, { recursive: true, filter: keep });",
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3, 4]);
  });

  it("accepts a copy that chooses dereference or verbatimSymlinks", () => {
    const source = [
      "fs.cpSync(src, dest, { recursive: true, dereference: true });",
      "fs.cpSync(backup, target, { recursive: true, verbatimSymlinks: true });",
      "fs.cpSync(src, dest, { recursive: true, dereference });",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("does not count an explicit false as a choice", () => {
    const source =
      "fs.cpSync(src, dest, { recursive: true, dereference: false });";

    assert.deepEqual(flagged(source), [1]);
  });

  it("leaves single-file copies alone", () => {
    const source = [
      "fs.cpSync(src, dest);",
      "fs.cpSync(src, dest, { recursive: false });",
      "fs.cpSync(src, dest, { force: true });",
      "fs.cp(src, dest, (error) => done(error));",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("flags options it can't read", () => {
    const source = [
      "fs.cpSync(src, dest, copyOptions);",
      "fs.cpSync(src, dest, { ...copyOptions });",
      "fs.cpSync(src, dest, { recursive: true, dereference: true, ...copyOptions });",
      "fs.cpSync(src, dest, { ...copyOptions, recursive: true, dereference: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3]);
  });

  it("accepts the pragma on the call or the line above it", () => {
    const source = [
      "// guard:allow-copy-links — the test fixture needs the link itself",
      "fs.cpSync(src, dest, { recursive: true });",
      "fs.cpSync(src, dest, {",
      "  recursive: true, // guard:allow-copy-links — same",
      "});",
      'fs.cpSync(a, b, { recursive: true }); // guard:allow-copy-links — "a"',
      "fs.cpSync(c, d, { recursive: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), [7]);
  });

  it("scans the published packages' source, not tests or scripts", () => {
    assert.equal(isGuardedSourcePath("packages/core/src/cli/skills.ts"), true);
    assert.equal(isGuardedSourcePath("packages/skills/src/install.ts"), true);
    assert.equal(
      isGuardedSourcePath("packages/core/src/cli/skills.spec.ts"),
      false,
    );
    assert.equal(
      isGuardedSourcePath("packages/core/scripts/finalize-build.mjs"),
      false,
    );
    assert.equal(isGuardedSourcePath("scripts/sync-skills.ts"), false);
  });
});
