import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runParityOracleGuard } from "./guard-parity-oracle.ts";

describe("guard:parity-oracle test boundaries", () => {
  it("does not count the next test's oracle comment as a change to its predecessor", async () => {
    const repoRoot = mkdtempSync(
      path.join(os.tmpdir(), "parity-oracle-boundary-"),
    );
    try {
      const relativePath = "templates/design/e2e/example.spec.ts";
      const testPath = path.join(repoRoot, relativePath);
      mkdirSync(path.dirname(testPath), { recursive: true });
      mkdirSync(path.join(repoRoot, "templates/design/parity/oracle"), {
        recursive: true,
      });
      writeFileSync(
        testPath,
        [
          'test("existing test", () => {});',
          "",
          "// oracle: none — this applies only to the changed test",
          'it("changed test", () => {',
          "  expect(true).toBe(true);",
          "});",
          "",
        ].join("\n"),
      );

      const result = await runParityOracleGuard({
        repoRoot,
        addedLines: new Map([[testPath, new Set([3, 5])]]),
        today: new Date("2026-10-06T00:00:00Z"),
      });

      assert.equal(result.exitCode, 0, result.message);
      assert.match(result.message, /0 entries, 1 citation/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
