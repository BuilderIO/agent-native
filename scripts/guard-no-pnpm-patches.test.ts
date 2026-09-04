import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { checkPnpmPatches } from "./guard-no-pnpm-patches";

describe("pnpm patch guard", () => {
  it("accepts a clean package manifest and lockfile", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-patches-clean-"));
    try {
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "fixture",
          scripts: { build: "pnpm build" },
        }),
      );
      writeFileSync(
        path.join(root, "pnpm-lock.yaml"),
        "lockfileVersion: 9.0\n",
      );

      assert.deepEqual(checkPnpmPatches(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects patch manifests, commands, lock metadata, and artifacts", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-patches-dirty-"));
    try {
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "fixture",
          pnpm: {
            patchedDependencies: {
              "@agent-native/core@1.0.0": "patches/core.patch",
            },
          },
          scripts: {
            patch: "pnpm patch @agent-native/core@1.0.0",
            commitPatch: "pnpm patch-commit /tmp/core",
          },
        }),
      );
      writeFileSync(
        path.join(root, "pnpm-lock.yaml"),
        [
          "patchedDependencies:",
          "  '@agent-native/core@1.0.0':",
          "    hash: abc123",
          "snapshots:",
          "  '@agent-native/core@1.0.0':",
          "    patch_hash: abc123",
        ].join("\n"),
      );
      mkdirSync(path.join(root, "patches"));
      writeFileSync(path.join(root, "patches", "core.patch"), "diff --git");

      const violations = checkPnpmPatches(root);

      assert.ok(
        violations.some(
          (violation) => violation.location === "pnpm.patchedDependencies",
        ),
      );
      assert.ok(
        violations.some((violation) => violation.location === "scripts.patch"),
      );
      assert.ok(
        violations.some(
          (violation) => violation.location === "scripts.commitPatch",
        ),
      );
      assert.equal(
        violations.filter((violation) => violation.file === "pnpm-lock.yaml")
          .length,
        2,
      );
      assert.ok(
        violations.some((violation) => violation.file === "patches/core.patch"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not treat prose or fixture strings as package configuration", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pnpm-patches-prose-"));
    try {
      writeFileSync(
        path.join(root, "README.md"),
        "Never run pnpm patch; use the upgrade workflow instead.\n",
      );
      writeFileSync(
        path.join(root, "fixture.ts"),
        readFileSync(new URL(import.meta.url), "utf8"),
      );

      assert.deepEqual(checkPnpmPatches(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
