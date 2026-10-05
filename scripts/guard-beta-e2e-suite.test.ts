import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const guard = path.join(repoRoot, "scripts", "guard-beta-e2e-suite.ts");
const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");

// Every file the guard reads, relative to the directory it runs in.
const GUARDED_FILES = [
  ".github/workflows/beta-e2e.yml",
  ".github/workflows/beta-e2e-scheduled.yml",
  ".github/actions/beta-e2e-setup/action.yml",
  ".github/workflows/deploy-production-sites-prebuilt.yml",
  "e2e/beta/lib/fleet.ts",
  "e2e/beta/lib/chat.ts",
  "e2e/beta/lib/provider-key.ts",
  "e2e/beta/playwright.config.ts",
  "e2e/beta/global-setup.ts",
  "scripts/netlify-beta-sites.json",
];

type Files = Record<string, string>;

function runGuard(mutate: (files: Files) => void = () => {}): {
  status: number | null;
  output: string;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "guard-beta-e2e-"));
  try {
    const files: Files = {};
    for (const file of GUARDED_FILES) {
      files[file] = readFileSync(path.join(repoRoot, file), "utf8");
    }
    mutate(files);
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(dir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const result = spawnSync(tsx, [guard], { cwd: dir, encoding: "utf8" });
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Replace text that must exist, so a renamed fixture cannot make a test pass vacuously. */
function edit(files: Files, file: string, from: string | RegExp, to: string) {
  const before = files[file] ?? "";
  const after = before.replace(from, to);
  assert.notEqual(after, before, `${file} no longer contains ${String(from)}`);
  files[file] = after;
}

function rejects(mutate: (files: Files) => void, expected: RegExp): void {
  const { status, output } = runGuard(mutate);
  assert.equal(status, 1, output);
  assert.match(output, expected);
}

describe("guard:beta-e2e-suite", () => {
  it("passes on the repository as it is", () => {
    const { status, output } = runGuard();
    assert.equal(status, 0, output);
    assert.match(output, /guard:beta-e2e-suite passed/);
  });

  it("caps the public matrix and the authenticated matrix", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "max-parallel: 8",
          "max-parallel: 16",
        ),
      /cap the public matrix at eight runners or fewer/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "max-parallel: 5",
          "max-parallel: 12",
        ),
      /cap the authenticated matrix at five runners or fewer/,
    );
  });

  it("keeps the authenticated shards behind the typecheck gate", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "needs: [discover, gate]",
          "needs: discover",
        ),
      /authed after the gate job/,
    );
  });

  it("requires chat to be sharded per app with unique slots", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /(slot: chat-slides\n\s+cluster: chat\n\s+project: chat\n\s+app: )slides/,
          '$1""',
        ),
      /authed chat slot chat-slides must name one app/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "slot: chat-content",
          "slot: chat-slides",
        ),
      /lists slot chat-slides more than once/,
    );
  });

  it("keeps the OpenAI key install to one chat slot per host", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /cluster: journeys(\n\s+project: journeys-core)/,
          "cluster: chat$1",
        ),
      /slot journeys-core must use cluster chat exactly when it runs the chat project/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /(slot: chat-dispatch\n\s+)cluster: chat/,
          "$1cluster: journeys",
        ),
      /slot chat-dispatch must use cluster chat exactly when it runs the chat project/,
    );
  });

  it("keeps every authenticated project and shard in a slot exactly once", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /- slot: journeys-credentials\n[\s\S]*?global_timeout: 25\n/,
          "",
        ),
      /defines project journeys-credentials, but no authed slot/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "shard: 2/2",
          "shard: 1/2",
        ),
      /in more than one slot, so those tests would run twice[\s\S]*must be exactly 1\/m through m\/m/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "shard: 2/2",
          "shard: 2/3",
        ),
      /must be exactly 1\/m through m\/m/,
    );
    rejects(
      (files) =>
        edit(files, ".github/workflows/beta-e2e.yml", /\n\s+shard: 2\/2/, ""),
      /mixes sharded and unsharded slots/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /      BETA_E2E_SHARD: \$\{\{ matrix\.shard \|\| '' \}\}\n/,
          "",
        ),
      /pass each slot's project and shard/,
    );
  });

  it("holds the authenticated discovery step to its skip rules", () => {
    for (const [from, to] of [
      ['select_args+=("--shard=$BETA_E2E_SHARD")', "true"],
      ['grep -q "Error: No tests found"', "true"],
      ['"$BETA_E2E_NARROWED" = "true"', "true"],
      ['exit "$selection_status"', "exit 0"],
    ] as const) {
      rejects(
        (files) => edit(files, ".github/workflows/beta-e2e.yml", from, to),
        /must capture and propagate failed authenticated discovery/,
      );
    }
  });

  it("requires every job and slot to end inside its own timeout", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /(name: \$\{\{ matrix\.app \}\} public sweep[\s\S]*?timeout-minutes: )10/,
          "$145",
        ),
      /public must set a numeric timeout-minutes of 15 or less/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /(slot: registry[\s\S]*?global_timeout: )7/,
          "$110",
        ),
      /authed slot registry needs a numeric timeout of 30 minutes or less and a smaller global_timeout/,
    );
    rejects(
      (files) =>
        edit(
          files,
          "e2e/beta/playwright.config.ts",
          /globalTimeout\s*:/,
          "noGlobalTimeout:",
        ),
      /sets no globalTimeout/,
    );
    rejects(
      (files) =>
        edit(
          files,
          "e2e/beta/playwright.config.ts",
          /maxFailures\s*:/,
          "noMaxFailures:",
        ),
      /sets no maxFailures/,
    );
  });

  it("keeps global setup bounded and loud", () => {
    rejects(
      (files) =>
        edit(files, "e2e/beta/global-setup.ts", /withHostDeadline/g, "runHost"),
      /no longer runs each host's setup under a deadline/,
    );
    rejects(
      (files) =>
        edit(
          files,
          "e2e/beta/lib/provider-key.ts",
          /AbortSignal\.timeout/g,
          "AbortSignal.any",
        ),
      /no longer bounds the in-page OpenAI key install/,
    );
    rejects(
      (files) =>
        edit(
          files,
          "e2e/beta/global-setup.ts",
          /throw new Error/g,
          "console.error",
        ),
      /global-setup\.ts no longer throws/,
    );
  });

  it("lets the production pre-flight run beside a scheduled run", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /group: beta-e2e-\$\{\{[^\n]*\}\}/,
          "group: beta-e2e",
        ),
      /concurrency group must depend on inputs\.lane/,
    );
  });

  it("stays a manual or called workflow", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "on:\n  workflow_call:",
          "on:\n  push:\n    branches: [main]\n  workflow_call:",
        ),
      /added automatic trigger\(s\): push/,
    );
  });

  it("holds the scheduled reporter to the issue, Slack, and permission contract", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-scheduled.yml",
          /QA_SLACK_BOT_TOKEN/g,
          "SOME_OTHER_TOKEN",
        ),
      /missing "QA_SLACK_BOT_TOKEN"/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-scheduled.yml",
          /slackapi\/slack-github-action@[0-9a-f]{40}/,
          "slackapi/slack-github-action@v4",
        ),
      /pin slackapi\/slack-github-action by full commit SHA/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-scheduled.yml",
          /(    permissions:\n      actions: read\n      contents: read\n      issues: write\n)/,
          "$1      pull-requests: write\n",
        ),
      /report job permissions must be exactly/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-scheduled.yml",
          /Slack notification not configured/g,
          "Slack skipped",
        ),
      /missing "Slack notification not configured"/,
    );
  });
});
