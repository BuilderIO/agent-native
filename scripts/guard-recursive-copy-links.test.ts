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

  it("flags a copier imported, destructured or assigned under another name", () => {
    const source = [
      'import { cpSync as copyTree } from "node:fs";',
      'import { cp as copyAsync } from "node:fs/promises";',
      "const { cpSync: copyAll } = fs;",
      "copyTree(src, dest, { recursive: true });",
      "await copyAsync(src, dest, { recursive: true });",
      "copyAll(src, dest, { recursive: true });",
      "copyTree(src, dest, { recursive: true, dereference: true, filter: () => true });",
      "copyOther(src, dest, { recursive: true });",
      "const copyBound = fs.cpSync.bind(fs);",
      "let copyLater;",
      "copyLater = copyTree;",
      "copyBound(src, dest, { recursive: true });",
      "copyLater(src, dest, { recursive: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), [4, 5, 6, 12, 13]);
  });

  it("flags a copier aliased before the name it copies is assigned", () => {
    const source = [
      "let first, second;",
      "first = second;",
      "second = fs.cpSync;",
      "first(src, dest, { recursive: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), [4]);
  });

  it("flags computed access and computed option keys", () => {
    const source = [
      'fs["cpSync"](src, dest, { recursive: true });',
      'const copyTree = fs["cpSync"];',
      "copyTree(src, dest, { recursive: true });",
      'fs.cpSync(src, dest, { ["recursive"]: true });',
      "fs.cpSync(src, dest, { [option]: true });",
      'fs.cpSync(src, dest, { recursive: true, ["verbatimSymlinks"]: true });',
      'fs.cpSync(src, dest, { recursive: true, dereference: true, ["filter"]() { return true; } });',
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 3, 4, 5]);
  });

  it("flags a copy made through call or apply", () => {
    const source = [
      "fs.cpSync.call(fs, src, dest, { recursive: true });",
      "fs.cpSync.apply(fs, [src, dest, { recursive: true }]);",
      "fs.cpSync.apply(fs, copyArgs);",
      "fs.cpSync.call(...callArgs);",
      "const copyTree = fs.cpSync;",
      'copyTree["call"](fs, src, dest, { recursive: true });',
      "fs.cpSync.call(fs, src, dest, { recursive: true, verbatimSymlinks: true });",
      "fs.cpSync.apply(fs, [src, dest]);",
      "fs.readFileSync.call(fs, src, { recursive: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3, 4, 6]);
  });

  it("accepts a copy that chooses dereference or verbatimSymlinks", () => {
    const source = [
      "fs.cpSync(src, dest, { recursive: true, dereference: true, filter: () => true });",
      "fs.cpSync(src, dest, { recursive: true, dereference: true, filter(path) { return keep(path); } });",
      "fs.cpSync(backup, target, { recursive: true, verbatimSymlinks: true });",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("flags dereference without a filter, which Node applies only at the top", () => {
    const source = [
      "fs.cpSync(src, dest, { recursive: true, dereference: true });",
      "fs.cpSync(src, dest, { recursive: true, dereference: true, filter: undefined });",
      "fs.cpSync(src, dest, { filter: () => true, ...copyOptions, recursive: true, dereference: true });",
      "fs.cpSync(src, dest, { recursive: true, dereference: true, filter: keep });",
      "fs.cpSync(src, dest, { recursive: true, dereference: true, filter });",
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3, 4, 5]);
  });

  it("counts a choice only when it is written as true", () => {
    const source = [
      "fs.cpSync(src, dest, { recursive: true, dereference: false });",
      "fs.cpSync(src, dest, { recursive: true, dereference });",
      "fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: keepLinks });",
      "fs.cpSync(src, dest, { recursive: true, dereference: true, dereference: follow });",
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3, 4]);
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
      "fs.cpSync(src, dest, { ...copyOptions, recursive: true, dereference: true, filter: () => true });",
      "fs.cpSync(...copyArgs);",
      "fs.cpSync(src, ...rest);",
      "fs.cpSync(src, dest, ...rest);",
      "fs.cp(src, dest, { recursive: true, verbatimSymlinks: true }, ...rest);",
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3, 5, 6, 7]);
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
