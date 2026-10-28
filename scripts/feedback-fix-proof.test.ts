import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { parseReports } from "./feedback-fix-proof.ts";

const SCRIPT = resolve(import.meta.dirname, "feedback-fix-proof.ts");
const repo = mkdtempSync(join(tmpdir(), "feedback-fix-proof-"));
after(() => rmSync(repo, { recursive: true, force: true }));

const git = (...args: string[]) =>
  spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();
git("init", "-q", "-b", "main");
git("config", "user.email", "t@example.com");
git("config", "user.name", "t");
writeFileSync(join(repo, "app.txt"), "broken\n");
git("add", "-A");
git("commit", "-qm", "base");
const base = git("rev-parse", "--short=9", "HEAD");
writeFileSync(join(repo, "app.txt"), "fixed\n");
git("add", "-A");
git("commit", "-qm", "fix");
const fix = git("rev-parse", "--short=9", "HEAD");

const proven = (command: string) =>
  `  \`fix-proof: proven, red at 000000000 (exit 1), green at ${fix}: ${command}\``;
const gate = (body: string) =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PR_BODY: body, BASE_SHA: base },
  });

describe("parseReports", () => {
  it("reads proof and visual lines under each report until the next heading", () => {
    const reports = parseReports(
      [
        "## Summary",
        "- https://example.com/not-a-report",
        "## Reports",
        "- [Voice report](https://app.slack.com/archives/C1/p1)",
        proven("grep -q fixed app.txt"),
        "- https://app.slack.com/archives/C1/p2",
        "  visual: https://example.com/before.png https://example.com/after.png",
        "- https://app.slack.com/archives/C1/p3",
        "## Verification",
        proven("ignored"),
      ].join("\r\n"),
    );
    assert.deepEqual(reports, [
      {
        link: "https://app.slack.com/archives/C1/p1",
        proven: [`${fix}\tgrep -q fixed app.txt`],
        visual: false,
      },
      {
        link: "https://app.slack.com/archives/C1/p2",
        proven: [],
        visual: true,
      },
      {
        link: "https://app.slack.com/archives/C1/p3",
        proven: [],
        visual: false,
      },
    ]);
  });

  it("reads numbered and bare-URL reports under a decorated heading", () => {
    const reports = parseReports(
      [
        "### Reports (3)",
        "1. https://app.slack.com/a",
        "  visual: n/a",
        "https://app.slack.com/b",
        "  visual: https://example.com/after.png",
        "- https://app.slack.com/c",
        "  - visual: https://example.com/before.png https://example.com/after.png",
      ].join("\n"),
    );
    assert.deepEqual(
      reports?.map((r) => [r.link, r.visual]),
      [
        ["https://app.slack.com/a", false],
        ["https://app.slack.com/b", false],
        ["https://app.slack.com/c", true],
      ],
    );
  });

  it("reads a lowercase reports heading", () => {
    assert.equal(
      parseReports("## reports\n- https://app.slack.com/a")?.length,
      1,
    );
  });

  it("returns null without a Reports section", () => {
    assert.equal(parseReports("## Summary\n- https://example.com"), null);
  });
});

describe("feedback-fix-proof", () => {
  it("passes when every report's proof holds on re-run", () => {
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven("grep -q fixed app.txt")}`,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("fails a report with no proof line", () => {
    const r = gate("## Reports\n- https://app.slack.com/a\n");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /NO PROOF: https:\/\/app.slack.com\/a/);
  });

  it("fails a pasted proof that does not hold", () => {
    const r = gate(`## Reports\n- https://app.slack.com/a\n${proven("true")}`);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /also passes without the fix/);
  });

  it("fails a proof whose commit is not on this branch", () => {
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven("grep -q fixed app.txt").replace(fix, base)}`,
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /NOT IN THIS PR/);
  });

  it("tells the workflow whether to install and re-run", () => {
    const has = (body: string) =>
      spawnSync(process.execPath, [SCRIPT, "--has-reports"], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PR_BODY: body },
      }).stdout.trim();
    assert.equal(
      has("##\treports\n- https://app.slack.com/a"),
      "has_reports=true",
    );
    assert.equal(
      has("   ## Reports\n- https://app.slack.com/a"),
      "has_reports=true",
    );
    assert.equal(has("see # Reports below"), "has_reports=false");
  });

  it("cannot run on a Reports section with no links", () => {
    assert.equal(gate("## Reports\nnone\n").status, 2);
  });

  it("has nothing to check without a Reports section", () => {
    assert.equal(gate("## Summary\nhi\n").status, 0);
  });
});
