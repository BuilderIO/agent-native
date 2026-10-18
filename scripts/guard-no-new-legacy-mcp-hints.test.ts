import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  BASELINE_PATH,
  GUARD_PATH,
  checkLegacyBaseline,
  legacyIds,
  parseLegacyBaseline,
  readLegacyBaseline,
  runLegacyBaselineGuard,
} from "./guard-no-new-legacy-mcp-hints.js";

const baseline = (sections: Record<string, string[]>) =>
  `${JSON.stringify(sections, null, 2)}\n`;

const BASE = baseline({ core: ["manage-widgets"], mail: ["send-email"] });
const GUARDED = { baseline: BASE, guardExists: true };

describe("legacy MCP hint baseline comparison", () => {
  it("reads ids as section/name", () => {
    assert.deepEqual([...legacyIds(parseLegacyBaseline(BASE))].sort(), [
      "core/manage-widgets",
      "mail/send-email",
    ]);
  });

  it("refuses anything but sections of action names instead of reading it as empty", () => {
    for (const text of [
      "",
      "[]",
      "null",
      '{ "core": "manage-widgets" }',
      '{ "core": [1] }',
      'export const LEGACY_UNREVIEWED = { core: ["manage-widgets"] };',
    ]) {
      assert.throws(() => parseLegacyBaseline(text), text);
    }
  });

  it("allows removals and an unchanged list", () => {
    assert.deepEqual(checkLegacyBaseline(GUARDED, BASE), {
      status: "ok",
      count: 2,
    });
    assert.deepEqual(
      checkLegacyBaseline(
        GUARDED,
        baseline({ core: [], mail: ["send-email"] }),
      ),
      { status: "ok", count: 1 },
    );
  });

  it("rejects an added id", () => {
    assert.deepEqual(
      checkLegacyBaseline(
        GUARDED,
        baseline({
          core: ["manage-widgets"],
          mail: ["send-email", "drop-inbox"],
        }),
      ),
      { status: "added", added: ["mail/drop-inbox"] },
    );
  });

  it("rejects an added id even when a stale id is removed in the same change", () => {
    assert.deepEqual(
      checkLegacyBaseline(
        GUARDED,
        baseline({ core: ["manage-widgets"], mail: ["drop-inbox"] }),
      ),
      { status: "added", added: ["mail/drop-inbox"] },
    );
  });

  it("treats an id moved to another section as added", () => {
    assert.deepEqual(
      checkLegacyBaseline(
        GUARDED,
        baseline({ core: ["manage-widgets", "send-email"], mail: [] }),
      ),
      { status: "added", added: ["core/send-email"] },
    );
  });

  it("allows the initial list only while the guard itself is new", () => {
    assert.deepEqual(
      checkLegacyBaseline({ baseline: null, guardExists: false }, BASE),
      { status: "bootstrap", count: 2 },
    );
    assert.deepEqual(
      checkLegacyBaseline({ baseline: null, guardExists: true }, BASE),
      { status: "moved" },
    );
  });
});

describe("legacy MCP hint baseline guard in a repository", () => {
  const roots: string[] = [];
  // These repositories compare against their own main. In CI the guard would
  // otherwise read the PR's base branch, which a stacked PR's scratch repo lacks.
  const inheritedBase = {
    GITHUB_BASE_REF: process.env.GITHUB_BASE_REF,
    GUARD_DIFF_BASE: process.env.GUARD_DIFF_BASE,
  };
  before(() => {
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GUARD_DIFF_BASE;
  });
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    for (const [key, value] of Object.entries(inheritedBase)) {
      if (value !== undefined) process.env[key] = value;
    }
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

  function repo(base: { baseline: string | null; guard: boolean }) {
    const root = mkdtempSync(path.join(os.tmpdir(), "legacy-mcp-guard-"));
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

  function write(root: string, relative: string, text: string) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  const guarded = () => repo({ baseline: BASE, guard: true });

  it("fails and says to declare mcpAnnotations when a branch adds an id", () => {
    const root = guarded();
    write(
      root,
      BASELINE_PATH,
      baseline({
        core: ["manage-widgets"],
        mail: ["send-email", "drop-inbox"],
      }),
    );
    git(root, "commit", "-q", "-am", "add");
    const outcome = runLegacyBaselineGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /declare `mcpAnnotations/i);
    assert.match(outcome.message, /mail\/drop-inbox/);
  });

  it("passes a branch that only removes ids", () => {
    const root = guarded();
    write(root, BASELINE_PATH, baseline({ core: [], mail: ["send-email"] }));
    assert.equal(runLegacyBaselineGuard(root).code, 0);
  });

  it("reads the same list the spec reads, with nothing appended by code", () => {
    const root = guarded();
    assert.deepEqual(readLegacyBaseline(root), {
      core: ["manage-widgets"],
      mail: ["send-email"],
    });
    write(
      root,
      BASELINE_PATH,
      `${BASE}LEGACY_UNREVIEWED.core.push("brand-new-mutating-probe");\n`,
    );
    assert.throws(() => readLegacyBaseline(root));
    assert.equal(runLegacyBaselineGuard(root).code, 2);
  });

  it("allows, and says it is allowing, the PR that creates the guard and the baseline", () => {
    const root = repo({ baseline: null, guard: false });
    write(root, BASELINE_PATH, BASE);
    const outcome = runLegacyBaselineGuard(root);
    assert.equal(outcome.code, 0);
    assert.match(outcome.message, /BOOTSTRAP/);
  });

  it("fails, rather than starting over, when the guard exists but the baseline was not at its path", () => {
    // What a branch that moves the baseline (and points the guard at the new
    // path) looks like to the guard after it merges.
    const root = repo({ baseline: null, guard: true });
    write(
      root,
      BASELINE_PATH,
      baseline({ core: ["manage-widgets", "brand-new-mutating-probe"] }),
    );
    const outcome = runLegacyBaselineGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /baseline path is fixed/);
  });

  it("exits 2, not 0, when no base ref resolves", () => {
    const root = guarded();
    git(root, "update-ref", "-d", "refs/remotes/origin/main");
    git(root, "branch", "-D", "main");
    const previous = { ...process.env };
    delete process.env.GUARD_DIFF_BASE;
    delete process.env.GITHUB_BASE_REF;
    try {
      assert.equal(runLegacyBaselineGuard(root).code, 2);
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it("exits 2 when the base baseline blob cannot be read", () => {
    const root = guarded();
    const objectId = git(root, "rev-parse", `HEAD:${BASELINE_PATH}`).trim();
    const objectPath = path.join(
      root,
      ".git",
      "objects",
      objectId.slice(0, 2),
      objectId.slice(2),
    );
    unlinkSync(objectPath);

    const outcome = runLegacyBaselineGuard(root);
    assert.equal(outcome.code, 2);
    assert.match(outcome.message, /could not read .* at merge-base/);
  });

  it("exits 2 when the branch's baseline is missing", () => {
    const root = guarded();
    unlinkSync(path.join(root, BASELINE_PATH));
    assert.equal(runLegacyBaselineGuard(root).code, 2);
  });
});
