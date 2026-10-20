import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findUntrackedImports,
  resolveImport,
} from "./guard-no-untracked-imports.mjs";

const guardPath = path.resolve(
  import.meta.dirname,
  "guard-no-untracked-imports.mjs",
);

function writeFiles(root: string, files: Record<string, string>) {
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
}

function withTempDir(prefix: string, run: (root: string) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(root: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

describe("no-untracked-imports guard", () => {
  it("resolves imports to forward-slash repo-relative paths", () => {
    withTempDir("untracked-imports-resolve-", (root) => {
      writeFiles(root, {
        "src/shared/util.ts": "export const util = 1;\n",
        "src/shared/nested/index.tsx": "export const nested = 1;\n",
      });

      // "../shared/util.js" is the ESM spelling of util.ts.
      assert.equal(
        resolveImport(root, "src/deep/a.ts", "../shared/util.js"),
        "src/shared/util.ts",
      );
      assert.equal(
        resolveImport(root, "src/deep/a.ts", "../shared/nested"),
        "src/shared/nested/index.tsx",
      );
      assert.equal(
        resolveImport(root, "src/deep/a.ts", "../shared/missing"),
        undefined,
      );
    });
  });

  it("accepts a tracked file that imports only tracked files", () => {
    withTempDir("untracked-imports-clean-", (root) => {
      writeFiles(root, {
        "src/deep/a.ts": [
          'import { util } from "../shared/util";',
          'export * from "../shared/nested";',
          'export const lazy = () => import("../shared/util.js");',
          "",
        ].join("\n"),
        "src/shared/util.ts": "export const util = 1;\n",
        "src/shared/nested/index.ts": "export const nested = 1;\n",
      });

      const tracked = new Set([
        "src/deep/a.ts",
        "src/shared/util.ts",
        "src/shared/nested/index.ts",
      ]);
      assert.deepEqual(findUntrackedImports(root, tracked), []);
    });
  });

  it("reports a tracked file that imports an untracked file", () => {
    withTempDir("untracked-imports-dirty-", (root) => {
      writeFiles(root, {
        "src/deep/a.ts": 'import { util } from "../shared/util";\n',
        "src/shared/util.ts": "export const util = 1;\n",
      });

      assert.deepEqual(findUntrackedImports(root, new Set(["src/deep/a.ts"])), [
        {
          file: "src/deep/a.ts",
          specifier: "../shared/util",
          resolved: "src/shared/util.ts",
        },
      ]);
    });
  });

  it("ignores untracked .generated modules and imports that do not exist", () => {
    withTempDir("untracked-imports-generated-", (root) => {
      writeFiles(root, {
        "src/a.ts": [
          'import { g } from "./.generated/types";',
          'import { m } from "./missing";',
          "",
        ].join("\n"),
        "src/.generated/types.ts": "export const g = 1;\n",
      });

      assert.deepEqual(findUntrackedImports(root, new Set(["src/a.ts"])), []);
    });
  });

  it("fails in a real git checkout until the imported file is tracked", () => {
    withTempDir("untracked-imports-cli-", (root) => {
      git(root, ["init", "--quiet"]);
      writeFiles(root, {
        "src/deep/a.ts": 'import { util } from "../shared/util";\n',
        "src/shared/util.ts": "export const util = 1;\n",
      });
      git(root, ["add", "src/deep/a.ts"]);

      const failing = spawnSync(process.execPath, [guardPath], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(failing.status, 1, failing.stdout + failing.stderr);
      assert.match(
        failing.stderr,
        /src\/deep\/a\.ts imports "\.\.\/shared\/util" -> src\/shared\/util\.ts/,
      );

      git(root, ["add", "src/shared/util.ts"]);
      const passing = spawnSync(process.execPath, [guardPath], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(passing.status, 0, passing.stdout + passing.stderr);
      assert.match(passing.stdout, /clean \(2 tracked files scanned\)/);
    });
  });
});
