import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  FIXTURE_PATH,
  checkLegacyBaseline,
  parseLegacyIds,
  runLegacyBaselineGuard,
} from "./guard-no-new-legacy-mcp-hints.js";

const fixture = (sections: Record<string, string[]>) =>
  `export const LEGACY_UNREVIEWED: Record<string, readonly string[]> = {\n${Object.entries(
    sections,
  )
    .map(
      ([section, names]) =>
        `  ${section}: [\n${names.map((name) => `    "${name}",`).join("\n")}\n  ],\n`,
    )
    .join("")}};\nexport const OTHER = ["not-an-id"];\n`;

const BASE = fixture({ core: ["manage-widgets"], mail: ["send-email"] });

describe("legacy MCP hint baseline comparison", () => {
  it("reads ids as section/name and ignores other exports", () => {
    assert.deepEqual([...parseLegacyIds(BASE)].sort(), [
      "core/manage-widgets",
      "mail/send-email",
    ]);
  });

  it("refuses a fixture it cannot read instead of reading it as empty", () => {
    assert.throws(() => parseLegacyIds("export const LEGACY_UNREVIEWED = [];"));
    assert.throws(() =>
      parseLegacyIds("export const LEGACY_UNREVIEWED = { core: [name], };"),
    );
    assert.throws(() => parseLegacyIds("export const SOMETHING_ELSE = {};"));
  });

  it("allows removals and an unchanged list", () => {
    assert.deepEqual(checkLegacyBaseline(BASE, BASE), {
      status: "ok",
      count: 2,
    });
    assert.deepEqual(
      checkLegacyBaseline(BASE, fixture({ core: [], mail: ["send-email"] })),
      { status: "ok", count: 1 },
    );
  });

  it("rejects an added id", () => {
    assert.deepEqual(
      checkLegacyBaseline(
        BASE,
        fixture({
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
        BASE,
        fixture({ core: ["manage-widgets"], mail: ["drop-inbox"] }),
      ),
      { status: "added", added: ["mail/drop-inbox"] },
    );
  });

  it("treats an id moved to another section as added", () => {
    assert.deepEqual(
      checkLegacyBaseline(
        BASE,
        fixture({ core: ["manage-widgets", "send-email"], mail: [] }),
      ),
      { status: "added", added: ["core/send-email"] },
    );
  });

  it("allows the initial list when the fixture is new", () => {
    assert.deepEqual(checkLegacyBaseline(null, BASE), {
      status: "bootstrap",
      count: 2,
    });
  });
});

describe("legacy MCP hint baseline guard in a repository", () => {
  const roots: string[] = [];
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

  function repo(baseFixture: string | null) {
    const root = mkdtempSync(path.join(os.tmpdir(), "legacy-mcp-guard-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    writeFileSync(path.join(root, "README.md"), "base\n");
    if (baseFixture !== null) write(root, baseFixture);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(root, "checkout", "-q", "-b", "feature");
    return root;
  }

  function write(root: string, source: string) {
    const file = path.join(root, FIXTURE_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }

  it("fails and says to declare mcpAnnotations when a branch adds an id", () => {
    const root = repo(BASE);
    write(
      root,
      fixture({ core: ["manage-widgets"], mail: ["send-email", "drop-inbox"] }),
    );
    git(root, "commit", "-q", "-am", "add");
    const outcome = runLegacyBaselineGuard(root);
    assert.equal(outcome.code, 1);
    assert.match(outcome.message, /declare `mcpAnnotations/i);
    assert.match(outcome.message, /mail\/drop-inbox/);
  });

  it("passes a branch that only removes ids", () => {
    const root = repo(BASE);
    write(root, fixture({ core: [], mail: ["send-email"] }));
    assert.equal(runLegacyBaselineGuard(root).code, 0);
  });

  it("allows, and says it is allowing, the PR that creates the fixture", () => {
    const root = repo(null);
    write(root, BASE);
    const outcome = runLegacyBaselineGuard(root);
    assert.equal(outcome.code, 0);
    assert.match(outcome.message, /BOOTSTRAP/);
  });

  it("exits 2, not 0, when no base ref resolves", () => {
    const root = repo(BASE);
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
});
