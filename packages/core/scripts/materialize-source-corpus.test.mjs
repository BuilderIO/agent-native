// Focused tests for the corpus-directory swap step in
// materialize-source-corpus.mjs. This exercises the fix for a concurrency bug:
// two overlapping `materializeSourceCorpus()` runs (e.g. two overlapping
// `scripts/dev-lazy.ts` prebuilds) used to `rmSync`/repopulate the shared
// `packages/core/corpus` directory directly, which could throw ENOTEMPTY out
// of the recursive rm/rename when one process's writes landed mid-walk of
// another's, crashing the caller. `swapCorpusDirIntoPlace` now builds into a
// unique temp dir and swaps it into place with a bounded retry that accepts
// "a concurrent run already produced an equivalent corpus" instead of
// crashing.
//
// A genuine two-process OS-level race for the exact rm-then-rename window is
// inherently timing-dependent and not worth making a CI test depend on (see
// the PR description for a real repro using an artificially slowed process).
// These tests instead force the same code paths deterministically: an
// absent/renamed-away temp dir reliably reproduces the "our rename lost"
// outcome (ENOENT is one of the tolerated codes), letting the accept/reject
// branches be exercised without flaky timing.
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";

import {
  looksLikeMaterializedCorpus,
  swapCorpusDirIntoPlace,
} from "./materialize-source-corpus.mjs";

const scratchDirs = [];

function makeScratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "materialize-corpus-test-"));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("looksLikeMaterializedCorpus", () => {
  it("is true once README.md is present", () => {
    const dir = makeScratchDir();
    writeFileSync(join(dir, "README.md"), "generated");
    assert.equal(looksLikeMaterializedCorpus(dir), true);
  });

  it("is false for a directory with no README.md", () => {
    const dir = makeScratchDir();
    writeFileSync(join(dir, "other-file.txt"), "not a marker");
    assert.equal(looksLikeMaterializedCorpus(dir), false);
  });

  it("is false for a directory that does not exist", () => {
    const dir = join(makeScratchDir(), "missing");
    assert.equal(looksLikeMaterializedCorpus(dir), false);
  });
});

describe("swapCorpusDirIntoPlace", () => {
  it("renames a fresh temp dir into an empty target", () => {
    const root = makeScratchDir();
    const tempDir = join(root, "corpus.tmp-1-aaa");
    const targetDir = join(root, "corpus");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "README.md"), "fresh build");

    const applied = swapCorpusDirIntoPlace(tempDir, targetDir);

    assert.equal(applied, true);
    assert.equal(existsSync(tempDir), false);
    assert.equal(looksLikeMaterializedCorpus(targetDir), true);
  });

  it("replaces a stale target directory with the new temp dir's contents", () => {
    const root = makeScratchDir();
    const tempDir = join(root, "corpus.tmp-2-bbb");
    const targetDir = join(root, "corpus");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "README.md"), "stale build");
    writeFileSync(join(targetDir, "stale-only.txt"), "should be replaced");
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "README.md"), "fresh build");

    const applied = swapCorpusDirIntoPlace(tempDir, targetDir);

    assert.equal(applied, true);
    assert.equal(existsSync(join(targetDir, "stale-only.txt")), false);
    assert.equal(looksLikeMaterializedCorpus(targetDir), true);
  });

  it("accepts a concurrent run's equivalent corpus instead of crashing when the rename loses", () => {
    const root = makeScratchDir();
    // Simulates the losing side of a real race: a concurrent run has already
    // produced a valid, fully-materialized corpus at targetDir. Making
    // targetDir read-only stands in for the real race window (another
    // process's write landing between our rmSync and renameSync) by making
    // our own rmSync unable to clear it, so renameSync fails with a tolerated
    // code (EPERM/EACCES surface through renameSync here since the directory
    // entry itself can't be unlinked) instead of the swap silently destroying
    // the winner's output first.
    const missingTempDir = join(root, "corpus.tmp-3-ccc-already-gone");
    const targetDir = join(root, "corpus");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "README.md"), "produced by the winner");
    chmodSync(targetDir, 0o555);

    try {
      const applied = swapCorpusDirIntoPlace(missingTempDir, targetDir);

      assert.equal(applied, false);
      assert.equal(looksLikeMaterializedCorpus(targetDir), true);
      assert.equal(
        readFileSync(join(targetDir, "README.md"), "utf8"),
        "produced by the winner",
      );
    } finally {
      chmodSync(targetDir, 0o755);
    }
  });

  it("still throws when the target never becomes a valid corpus", () => {
    const root = makeScratchDir();
    const missingTempDir = join(root, "corpus.tmp-4-ddd-never-existed");
    const targetDir = join(root, "corpus-never-created");

    assert.throws(
      () => swapCorpusDirIntoPlace(missingTempDir, targetDir),
      (error) => error.code === "ENOENT",
    );
  });
});
