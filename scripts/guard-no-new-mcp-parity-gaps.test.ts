import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import {
  BASELINE_PATH,
  GUARD_PATH,
  readParityGaps,
  runParityGapGuard,
} from "./guard-no-new-mcp-parity-gaps.js";

// The comparison itself is shared with guard-no-new-legacy-mcp-hints, whose
// tests cover each outcome; these pin this guard's paths and advice.
const baseline = (sections: Record<string, string[]>) =>
  `${JSON.stringify(sections, null, 2)}\n`;

const BASE = baseline({ core: ["list-widgets"], mail: ["archive-label"] });

describe("MCP parity baseline guard in a repository", () => {
  const roots: string[] = [];
  const diffBaseVariables = ["GUARD_DIFF_BASE", "GITHUB_BASE_REF"] as const;
  let previousDiffBase: Array<[string, string | undefined]>;
  beforeEach(() => {
    // Fixture repos have their own main, not CI's stacked PR base branch.
    previousDiffBase = diffBaseVariables.map((name) => [
      name,
      process.env[name],
    ]);
    for (const name of diffBaseVariables) delete process.env[name];
  });
  afterEach(() => {
    for (const [name, value] of previousDiffBase) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]) {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=guard-test",
        "-c",
        "user.email=guard-test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  }

  function write(root: string, relative: string, text: string) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  function repo(base: { baseline: string | null; guard: boolean }) {
    const root = mkdtempSync(path.join(os.tmpdir(), "mcp-parity-guard-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    writeFileSync(path.join(root, "README.md"), "base\n");
    if (base.baseline !== null) write(root, BASELINE_PATH, base.baseline);
    if (base.guard) write(root, GUARD_PATH, "// the guard\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "checkout", "-q", "-b", "feature");
    return root;
  }

  it("fails and says to decide the action when a branch adds an id", () => {
    const root = repo({ baseline: BASE, guard: true });
    write(
      root,
      BASELINE_PATH,
      baseline({ core: ["list-widgets"], mail: ["archive-label", "snooze"] }),
    );
    git(root, "commit", "-q", "-am", "add");
    const outcome = runParityGapGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /`mcpTool: true`/);
    assert.match(outcome.message, /`mcpTool: false`/);
    assert.match(outcome.message, /mail\/snooze/);
  });

  it("passes a branch that only removes ids", () => {
    const root = repo({ baseline: BASE, guard: true });
    write(root, BASELINE_PATH, baseline({ core: [], mail: ["archive-label"] }));
    assert.equal(runParityGapGuard(root).code, 0);
  });

  it("reads the same list the spec reads, and refuses anything but JSON", () => {
    const root = repo({ baseline: BASE, guard: true });
    assert.deepEqual(readParityGaps(root), {
      core: ["list-widgets"],
      mail: ["archive-label"],
    });
    write(root, BASELINE_PATH, `${BASE}GAPS.core.push("new-action");\n`);
    assert.throws(() => readParityGaps(root));
    assert.equal(runParityGapGuard(root).code, 2);
  });

  it("allows, and says it is allowing, the PR that creates the guard and the baseline", () => {
    const root = repo({ baseline: null, guard: false });
    write(root, BASELINE_PATH, BASE);
    const outcome = runParityGapGuard(root);
    assert.equal(outcome.code, 0);
    assert.match(outcome.message, /BOOTSTRAP/);
  });

  it("fails, rather than starting over, when the guard exists but the baseline was not at its path", () => {
    const root = repo({ baseline: null, guard: true });
    write(root, BASELINE_PATH, BASE);
    const outcome = runParityGapGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /baseline path is fixed/);
  });
});
