import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  findBareErrorThrows,
  isActionSourcePath,
} from "./guard-no-bare-error-in-actions.js";

const FILE = "templates/plan/actions/update-visual-plan.ts";

function allLines(source: string) {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function flagged(source: string, added = allLines(source)) {
  return findBareErrorThrows(FILE, source, added).map(
    (finding) => `${finding.line}: ${finding.snippet}`,
  );
}

describe("bare Error in actions guard", () => {
  it("flags a literal sentence in every spelling of a bare Error", () => {
    const source = [
      'throw new Error("This destructive update was prepared from an outdated plan revision.");',
      "throw new Error(`Run ${id} was not found in this library.`);",
      'throw new Error("Cannot find " + name + " in the workspace");',
      'throw Error("Local plan folder preview is only available in local Plan runtime.");',
      "function helper() {",
      '  throw new Error("Not authenticated.");',
      "}",
    ].join("\n");

    assert.deepEqual(
      flagged(source).map((entry) => entry.split(":")[0]),
      ["1", "2", "3", "4", "6"],
    );
  });

  it("allows typed failures and messages with no literal sentence", () => {
    const source = [
      'fail("Generation run not found.", { errorCode: "not_found", statusCode: 404 });',
      "throw new Error(message);",
      "throw new Error(`${code}`);",
      "throw new Error(`${provider} failed`);",
      'throw new Error("unreachable");',
      'throw new Error("failed: " + detail);',
      "throw error;",
      'throw new HttpError("Some typed sentence here", 404);',
      'throw new TypeError("Expected a string but got something else");',
      "throw new Error(String(cause), { cause });",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("only reports statements this branch touched, at the throw's first line", () => {
    const source = [
      'throw new Error("An old unchanged sentence.");',
      "throw new Error(",
      '  "A multi line sentence here",',
      ");",
      'throw new Error("Another old unchanged sentence.");',
    ].join("\n");

    const found = findBareErrorThrows(FILE, source, new Set([3]));
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
    assert.deepEqual(findBareErrorThrows(FILE, source, new Set()), []);
  });

  it("honors the opt-out on the throw, within it, or on the line above", () => {
    const source = [
      'throw new Error("Invariant sentence one."); // guard:allow-bare-error — invariant: never reachable',
      "// guard:allow-bare-error — invariant: schema guarantees this",
      'throw new Error("Invariant sentence two.");',
      "throw new Error(",
      '  "Invariant sentence three.", // guard:allow-bare-error — invariant: x',
      ");",
      'throw new Error("This one has no opt-out.");',
    ].join("\n");

    assert.deepEqual(
      flagged(source).map((entry) => entry.split(":")[0]),
      ["7"],
    );
  });

  it("parses TSX and ignores throw-shaped text in strings and comments", () => {
    const source = [
      "export const view = <div />;",
      '// throw new Error("a commented sentence here");',
      'const text = "throw new Error(\\"a quoted sentence here\\")";',
    ].join("\n");

    assert.deepEqual(
      findBareErrorThrows(
        "templates/x/actions/view.tsx",
        source,
        allLines(source),
      ),
      [],
    );
  });
});

describe("action path scope", () => {
  it("covers template, app and package action directories", () => {
    for (const rel of [
      "templates/plan/actions/get-local-plan-folder.ts",
      "templates/plan/actions/nested/helper.ts",
      "apps/demo/actions/do-thing.ts",
      "packages/dispatch/src/actions/list-things.ts",
      "packages/core/src/agent/actions/check-provider-key.ts",
    ]) {
      assert.equal(isActionSourcePath(rel), true, rel);
    }
  });

  it("skips tests, other server code and look-alike names", () => {
    for (const rel of [
      "templates/plan/actions/get-local-plan-folder.spec.ts",
      "templates/plan/actions/__tests__/a.ts",
      "templates/plan/server/lib/plans.ts",
      "templates/plan/app/pages/Plans.tsx",
      "packages/dispatch/src/server/lib/thread-debug-store.ts",
      "packages/core/src/server/actions-registry.ts",
      "templates/plan/actions/readme.md",
    ]) {
      assert.equal(isActionSourcePath(rel), false, rel);
    }
  });
});

describe("guard command", () => {
  it("exits 2, not 0, when it cannot determine the added lines", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.resolve(import.meta.dirname, "guard-no-bare-error-in-actions.ts"),
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          GUARD_DIFF_BASE: "origin/branch-that-does-not-exist-for-this-test",
        },
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /could not determine which lines/);
  });
});
