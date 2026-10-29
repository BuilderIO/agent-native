import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import {
  isTrackedRepositoryTest,
  parseProofCommand,
  parseReports,
} from "./feedback-fix-proof.ts";

const SCRIPT = resolve(import.meta.dirname, "feedback-fix-proof.ts");
const repo = mkdtempSync(join(tmpdir(), "feedback-fix-proof-"));
after(() => rmSync(repo, { recursive: true, force: true }));

const git = (...args: string[]) =>
  spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();
git("init", "-q", "-b", "main");
git("config", "user.email", "t@example.com");
git("config", "user.name", "t");
writeFileSync(join(repo, "app.txt"), "broken\n");
writeFileSync(
  join(repo, "app.test.mjs"),
  'import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { test } from "node:test";\ntest("app is fixed", () => assert.match(readFileSync("app.txt", "utf8"), /fixed/));\n',
);
writeFileSync(
  join(repo, "always.test.mjs"),
  'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("always passes", () => assert.ok(true));\n',
);
mkdirSync(join(repo, "packages/demo/src"), { recursive: true });
writeFileSync(
  join(repo, "packages/demo/package.json"),
  JSON.stringify({ name: "demo", version: "1.0.0" }),
);
writeFileSync(join(repo, "packages/demo/src/example.test.mjs"), "");
git("add", "-A");
git("commit", "-qm", "base");
const base = git("rev-parse", "--short=9", "HEAD");
writeFileSync(join(repo, "app.txt"), "fixed\n");
git("add", "-A");
git("commit", "-qm", "fix");
const fix = git("rev-parse", "--short=9", "HEAD");

const proven = (command: string) =>
  `  \`fix-proof: proven, red at 000000000 (exit 1), green at ${fix}: ${command}\``;
const gate = (body: string) => {
  const env = { ...process.env, PR_BODY: body, BASE_SHA: base };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env,
  });
};

describe("parseReports", () => {
  it("reads proof and visual lines under each report", () => {
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
        "## Reports (3)",
        "### Slack",
        "1. https://app.slack.com/a",
        "  visual: n/a",
        "  https://app.slack.com/b",
        "  visual: https://example.com/after.png",
        "   - https://app.slack.com/c",
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

  it("counts any line with a URL as a report, whatever its format", () => {
    const reports = parseReports(
      "## Reports\nReport 1: https://app.slack.com/a\n        https://app.slack.com/b",
    );
    assert.deepEqual(
      reports?.map((r) => r.link),
      ["https://app.slack.com/a", "https://app.slack.com/b"],
    );
  });

  it("counts every URL after the Reports heading, whatever follows it", () => {
    const reports = parseReports(
      [
        "## Summary",
        "- https://example.com/not-a-report",
        "## Reports",
        "- https://app.slack.com/a and https://app.slack.com/b",
        "```sh",
        "## Notes",
        "```",
        "### Sentry",
        "- https://sentry.io/issues/1",
      ].join("\n"),
    );
    assert.deepEqual(
      reports?.map((r) => r.link),
      [
        "https://app.slack.com/a",
        "https://app.slack.com/b",
        "https://sentry.io/issues/1",
      ],
    );
  });

  it("finds the Reports heading after an unclosed fence-like line", () => {
    const reports = parseReports(
      "```pnpm test``` was run\n## Reports\n- https://app.slack.com/a",
    );
    assert.deepEqual(
      reports?.map((r) => r.link),
      ["https://app.slack.com/a"],
    );
  });

  it("reads a proof written on the report's own line", () => {
    const [report] = parseReports(
      `## Reports\n- https://app.slack.com/a ${proven("grep -q fixed app.txt").trim()}`,
    )!;
    assert.equal(report.link, "https://app.slack.com/a");
    assert.deepEqual(report.proven, [`${fix}\tgrep -q fixed app.txt`]);
  });

  it("returns null without a Reports section", () => {
    assert.equal(parseReports("## Summary\n- https://example.com"), null);
  });
});

describe("parseProofCommand", () => {
  it("allows repository Vitest tests and Node test files", () => {
    assert.deepEqual(
      parseProofCommand(
        "pnpm --filter @agent-native/toolkit exec vitest run src/composer/useRealtimeVoiceMode.spec.ts --maxWorkers=2",
      ),
      [
        "pnpm",
        "--filter",
        "@agent-native/toolkit",
        "exec",
        "vitest",
        "run",
        "src/composer/useRealtimeVoiceMode.spec.ts",
        "--maxWorkers=2",
      ],
    );
    assert.deepEqual(
      parseProofCommand("node --test scripts/feedback-fix-proof.test.ts"),
      ["node", "--test", "scripts/feedback-fix-proof.test.ts"],
    );
  });

  it("rejects arbitrary executables, inline code, and traversal paths", () => {
    for (const command of [
      "node -e process.exit(0)",
      "curl https://example.com/payload",
      "pnpm exec node -e process.exit(0)",
      "pnpm --filter ../../outside exec vitest run test.spec.ts",
      "node --test ../outside.test.ts",
      "pnpm --filter design exec vitest run app.spec.ts --config vitest.config.ts",
    ])
      assert.equal(parseProofCommand(command), null, command);
  });
});

describe("isTrackedRepositoryTest", () => {
  it("requires a tracked test path within the selected workspace", () => {
    assert.equal(
      isTrackedRepositoryTest(
        [
          "pnpm",
          "--filter",
          "demo",
          "exec",
          "vitest",
          "run",
          "src/example.test.mjs",
        ],
        repo,
      ),
      true,
    );
    assert.equal(
      isTrackedRepositoryTest(["node", "--test", "missing.test.mjs"], repo),
      false,
    );
    assert.equal(
      isTrackedRepositoryTest(
        [
          "pnpm",
          "--filter",
          "demo",
          "exec",
          "vitest",
          "run",
          "src/missing.test.mjs",
        ],
        repo,
      ),
      false,
    );
  });

  it("surfaces malformed workspace manifests instead of treating them as absent", () => {
    const manifest = join(repo, "packages/demo/package.json");
    const contents = readFileSync(manifest, "utf8");
    writeFileSync(manifest, "{");
    try {
      assert.throws(
        () =>
          isTrackedRepositoryTest(
            [
              "pnpm",
              "--filter",
              "demo",
              "exec",
              "vitest",
              "run",
              "src/example.test.mjs",
            ],
            repo,
          ),
        SyntaxError,
      );
    } finally {
      writeFileSync(manifest, contents);
    }
  });
});

describe("feedback-fix-proof", () => {
  it("passes when every report's proof holds on re-run", () => {
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven("node --test app.test.mjs")}`,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it("fails a report with no proof line", () => {
    const r = gate("## Reports\n- https://app.slack.com/a\n");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /NO PROOF: https:\/\/app.slack.com\/a/);
  });

  it("fails a pasted proof that does not hold", () => {
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven("node --test always.test.mjs")}`,
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /also passes without the fix/);
  });

  it("does not execute an inline command supplied in the PR body", () => {
    const marker = join(repo, "proof-ran");
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven(`node -e require('fs').writeFileSync('${marker}','yes')`)}`,
    );
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /unsupported proof command/);
    assert.equal(existsSync(marker), false);
  });

  it("does not execute an untracked test supplied in the PR body", () => {
    const marker = join(repo, "untracked-proof-ran");
    writeFileSync(
      join(repo, "untracked.test.mjs"),
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "yes");\n`,
    );
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven("node --test untracked.test.mjs")}`,
    );
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /must be tracked inside its repository workspace/);
    assert.equal(existsSync(marker), false);
  });

  it("fails a proof whose commit is not on this branch", () => {
    const r = gate(
      `## Reports\n- https://app.slack.com/a\n${proven("node --test app.test.mjs").replace(fix, base)}`,
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
