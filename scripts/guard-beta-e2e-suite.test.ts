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

import { parse } from "yaml";

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
  ".github/workflows/beta-e2e-report.yml",
  "scripts/beta-e2e-digest.ts",
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
type WorkflowStep = {
  name?: unknown;
  uses?: unknown;
  if?: unknown;
  run?: unknown;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};
type WorkflowJob = {
  if?: unknown;
  permissions?: Record<string, unknown>;
  strategy?: { matrix?: unknown };
  env?: Record<string, unknown>;
  steps?: WorkflowStep[];
};
type ParsedWorkflow = {
  permissions?: Record<string, unknown>;
  on?: Record<
    string,
    { inputs?: Record<string, { required?: unknown; default?: unknown }> }
  >;
  jobs?: Record<string, WorkflowJob>;
};

function runGuard(mutate: (files: Files) => void = () => {}): {
  status: number | null;
  output: string;
} {
  const dir = mkdtempSync(path.join(tmpdir(), "guard-beta-e2e-"));
  try {
    const files: Files = {};
    for (const file of GUARDED_FILES) {
      files[file] = readFileSync(path.join(repoRoot, file), "utf8"); // source-read-ok: checks the live workflow text contract
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

  it("reports opted-in production pre-flight failures through the shared Slack reporter", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/deploy-production-sites-prebuilt.yml",
          "uses: ./.github/workflows/beta-e2e-report.yml",
          "uses: ./.github/workflows/missing-report.yml",
        ),
      /must send the opted-in production Beta E2E result, including failed or cancelled runs/,
    );
  });

  it("guards the configured low-cost model constants", () => {
    for (const name of ["LUNA_OPENAI_MODEL", "LUNA_BUILDER_MODEL"] as const) {
      rejects(
        (files) =>
          edit(
            files,
            "e2e/beta/lib/chat.ts",
            `export const ${name} = "gpt-6-luna";`,
            `export const ${name} = "claude-opus-4-6";`,
          ),
        new RegExp(`${name} must be set to gpt-6-luna`),
      );
    }
  });

  it("checks the exported model initializers instead of matching source text", () => {
    for (const name of ["LUNA_OPENAI_MODEL", "LUNA_BUILDER_MODEL"] as const) {
      rejects(
        (files) =>
          edit(
            files,
            "e2e/beta/lib/chat.ts",
            `export const ${name} = "gpt-6-luna";`,
            `export const ${name} = selectModel("claude-opus-4-6");\nconst staleExpected = 'export const ${name} = "gpt-6-luna";';`,
          ),
        new RegExp(`${name} must be set to gpt-6-luna`),
      );
    }
  });

  it("guards the model acceptance pattern", () => {
    rejects(
      (files) =>
        edit(
          files,
          "e2e/beta/lib/chat.ts",
          "export const LUNA_MODEL_PATTERN = /^(?:openai\\/)?gpt-(?:5[.-]6|6)-luna$/i;",
          "export const LUNA_MODEL_PATTERN = /^.*$/i;",
        ),
      /LUNA_MODEL_PATTERN must accept only the current low-cost model aliases/,
    );
  });

  it("checks the exported pattern initializer instead of matching source text", () => {
    const expectedDeclaration = String.raw`export const LUNA_MODEL_PATTERN = /^(?:openai\/)?gpt-(?:5[.-]6|6)-luna$/i;`;
    rejects(
      (files) =>
        edit(
          files,
          "e2e/beta/lib/chat.ts",
          expectedDeclaration,
          `export const LUNA_MODEL_PATTERN = /^.*$/i;\nconst staleExpected = "${expectedDeclaration}";`,
        ),
      /LUNA_MODEL_PATTERN must accept only the current low-cost model aliases/,
    );
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

  it("keeps saved-thread recovery opt-in and validates its manual request", () => {
    const workflow = parse(
      readFileSync(
        path.join(repoRoot, ".github/workflows/beta-e2e.yml"),
        "utf8",
      ),
    ) as ParsedWorkflow;
    const dispatchInputs = workflow.on?.workflow_dispatch?.inputs;
    const callInputs = workflow.on?.workflow_call?.inputs;
    assert.equal(dispatchInputs?.diagnostic_run?.required, false);
    assert.equal(dispatchInputs?.diagnostic_run?.default, "");
    assert.equal(callInputs?.diagnostic_run, undefined);

    const jobs = workflow.jobs ?? {};
    for (const name of [
      "public",
      "fleet",
      "authed",
      "advisory",
      "signup",
      "report",
    ]) {
      assert.match(String(jobs[name]?.if), /inputs\.diagnostic_run == ''/);
    }
    assert.match(String(jobs.gate?.if), /inputs\.diagnostic_run != ''/);
    const gateSteps = jobs.gate?.steps ?? [];
    const checkoutIndex = gateSteps.findIndex(
      (step) =>
        typeof step.uses === "string" && step.uses.includes("actions/checkout"),
    );
    const validationIndex = gateSteps.findIndex(
      (step) => step.name === "Validate read-only recovery request",
    );
    const gateSetupIndex = gateSteps.findIndex(
      (step) => step.uses === "./.github/actions/beta-e2e-setup",
    );
    const typecheckIndex = gateSteps.findIndex(
      (step) => step.name === "Typecheck the suite",
    );
    const helperTestIndex = gateSteps.findIndex(
      (step) => step.name === "Test beta E2E helper contracts",
    );
    assert.ok(checkoutIndex >= 0);
    assert.equal(validationIndex, checkoutIndex + 1);
    assert.ok(gateSetupIndex > validationIndex);
    assert.ok(typecheckIndex > gateSetupIndex);
    assert.ok(helperTestIndex > typecheckIndex);
    assert.match(
      String(gateSteps[validationIndex]?.if),
      /diagnostic_run != ''/,
    );
    assert.equal(gateSteps[typecheckIndex]?.if, undefined);
    assert.equal(gateSteps[helperTestIndex]?.if, undefined);

    assert.match(
      String(jobs.authed?.if),
      /needs\.discover\.result == 'success'/,
    );
    assert.match(
      String(jobs.authed?.env?.SHARD_SELECTED),
      /needs\.discover\.outputs\.apps/,
    );

    const steps = jobs.authed?.steps ?? [];
    const browserSetup = steps.find(
      (step) => step.uses === "./.github/actions/beta-e2e-setup",
    );
    const regular = steps.find(
      (step) => step.name === "Authenticated ${{ matrix.slot }}",
    );
    const diagnosticJob = jobs["saved-thread-diagnostics"];
    const diagnostic = diagnosticJob?.steps?.find(
      (step) => step.name === "Read saved thread provenance",
    );
    const upload = steps.find(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.includes("actions/upload-artifact"),
    );
    assert.ok(browserSetup);
    assert.equal(browserSetup.with?.browser, undefined);
    assert.equal(regular?.if, "${{ env.SHARD_SELECTED == 'true' }}");
    assert.match(String(diagnosticJob?.if), /inputs\.diagnostic_run != ''/);
    assert.equal(upload?.if, "${{ always() && env.SHARD_SELECTED == 'true' }}");
    assert.equal(jobs.authed?.env?.BETA_E2E_OPENAI_API_KEY, undefined);
    assert.equal(
      regular?.env?.BETA_E2E_OPENAI_API_KEY,
      "${{ secrets.BETA_E2E_OPENAI_API_KEY }}",
    );
    assert.equal(diagnostic?.env?.BETA_E2E_OPENAI_API_KEY, undefined);
    assert.equal(diagnostic?.env?.BETA_E2E_SESSION_TOKEN_CONTENT, undefined);
    assert.equal(diagnostic?.env?.BETA_E2E_SESSION_TOKEN_DISPATCH, undefined);

    const validationStep = (jobs.gate?.steps ?? []).find(
      (step) => step.name === "Validate read-only recovery request",
    );
    assert.ok(validationStep);
    const script = String(validationStep.run).match(
      /node <<'NODE'\n([\s\S]*?)\nNODE\s*$/,
    )?.[1];
    assert.ok(
      script,
      "manual recovery validation script must remain extractable",
    );

    const invoke = (
      inputs: Record<string, unknown>,
      repository = "BuilderIO/agent-native",
    ) => {
      const dir = mkdtempSync(path.join(tmpdir(), "beta-recovery-input-"));
      try {
        const eventPath = path.join(dir, "event.json");
        writeFileSync(
          eventPath,
          JSON.stringify({ repository: { full_name: repository }, inputs }),
        );
        return spawnSync(process.execPath, ["-e", script], {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            GITHUB_EVENT_NAME: "workflow_dispatch",
            GITHUB_REPOSITORY: "BuilderIO/agent-native",
            GITHUB_EVENT_PATH: eventPath,
          },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    const valid = (apps: string) => ({
      diagnostic_run: "123456789",
      apps,
      lane: "authed",
      grep: String.raw`\[chat-reliability\] refresh mid-run restores the complete answer`,
    });
    assert.equal(invoke(valid("content")).status, 0);
    assert.equal(invoke(valid("content,dispatch")).status, 0);
    assert.equal(invoke({ ...valid("slides") }).status, 2);
    assert.equal(invoke({ ...valid("content"), lane: "public" }).status, 2);
    assert.equal(invoke({ ...valid("content"), grep: "other test" }).status, 2);
    assert.equal(invoke(valid("content"), "other/repository").status, 2);
    assert.equal(
      invoke({ ...valid("content"), diagnostic_run: "123; echo bad" }).status,
      2,
    );
  });

  it("isolates Actions read permission and execution to the optional diagnostic job", () => {
    const workflow = parse(
      readFileSync(
        path.join(repoRoot, ".github/workflows/beta-e2e.yml"),
        "utf8",
      ),
    ) as ParsedWorkflow;
    const jobs = workflow.jobs ?? {};
    const normal = jobs.authed;
    const diagnostic = jobs["saved-thread-diagnostics"];
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.equal(normal?.permissions, undefined);
    assert.equal(
      normal?.if,
      "${{ always() && !cancelled() && inputs.diagnostic_run == '' && inputs.lane != 'public' && inputs.lane != 'signup' && needs.gate.result == 'success' && needs.discover.result == 'success' }}",
    );
    assert.equal(
      normal?.env?.SHARD_SELECTED,
      "${{ matrix.app == '' && needs.discover.outputs.apps != 'design' || matrix.app != '' && contains(format(',{0},', needs.discover.outputs.apps), format(',{0},', matrix.app)) }}",
    );
    assert.ok(normal?.steps?.length);
    for (const step of normal.steps) {
      assert.equal(step.env?.GH_TOKEN, undefined);
      assert.doesNotMatch(String(step.run), /read-saved-thread/);
    }
    assert.equal(
      jobs.discover?.steps?.find(
        (step) => step.name === "Build the host matrix",
      )?.env?.REQUESTED_APPS,
      "${{ inputs.apps }}",
    );
    assert.equal(
      diagnostic?.if,
      "${{ always() && !cancelled() && inputs.diagnostic_run != '' && needs.gate.result == 'success' && needs.discover.result == 'success' }}",
    );
    assert.deepEqual(diagnostic.permissions, {
      actions: "read",
      contents: "read",
    });
    assert.equal(diagnostic.env, undefined);
    assert.equal(
      diagnostic.strategy?.matrix,
      "${{ fromJSON(needs.discover.outputs.matrix) }}",
    );
    const steps = diagnostic.steps ?? [];
    assert.equal(steps.length, 3);
    assert.match(String(steps[0].uses), /^actions\/checkout@/);
    assert.equal(steps[1].uses, "./.github/actions/beta-e2e-setup");
    assert.deepEqual(steps[1].with, { browser: "false" });
    assert.equal(steps[2].name, "Read saved thread provenance");
    assert.equal(steps[2].run, "pnpm exec tsx e2e/beta/read-saved-thread.ts");
    assert.deepEqual(steps[2].env, {
      GH_TOKEN: "${{ github.token }}",
      BETA_E2E_APPS: "${{ matrix.app }}",
      BETA_E2E_EMAIL: "${{ secrets.BETA_E2E_EMAIL }}",
      BETA_E2E_SESSION_TOKENS: "${{ secrets.BETA_E2E_SESSION_TOKENS }}",
    });
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
      [
        'rm -rf "e2e/beta/playwright-report/$BETA_E2E_REPORT_SLOT" "e2e/beta/test-results/$BETA_E2E_REPORT_SLOT"',
        "true",
      ],
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

  it("reports only direct beta dispatches and waits for every lane", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "github.workflow == 'Beta E2E (browser)'",
          "github.workflow == 'Deploy production sites'",
        ),
      /must report direct manual runs/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "needs: [discover, gate, public, fleet, authed, advisory, signup]",
          "needs: [discover]",
        ),
      /must wait for every lane and pass the aggregate result/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          /needs\.\*\.result/g,
          "needs.gate.result",
        ),
      /must wait for every lane and pass the aggregate result/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e.yml",
          "always()\n      && github.event_name == 'workflow_dispatch'",
          "!cancelled()\n      && github.event_name == 'workflow_dispatch'",
        ),
      /including canceled lanes/,
    );
  });

  it("holds the shared reporter to the artifact, Slack, and permission contract", () => {
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          /QA_SLACK_BOT_TOKEN/g,
          "SOME_OTHER_TOKEN",
        ),
      /missing "QA_SLACK_BOT_TOKEN"/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          /slackapi\/slack-github-action@[0-9a-f]{40}/,
          "slackapi/slack-github-action@v4",
        ),
      /pin slackapi\/slack-github-action by full commit SHA/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          /(    permissions:\n      actions: read\n      contents: read\n)/,
          "$1      pull-requests: write\n",
        ),
      /report job permissions must be exactly/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          "      actions: read\n      contents: read\n",
          "      actions: read\n      contents: read\n      issues: write\n",
        ),
      /must not use GitHub Issues/,
    );
    rejects(
      (files) =>
        edit(
          files,
          "scripts/beta-e2e-digest.ts",
          "import { createHash }",
          "const issueNumber = 3986;\nimport { createHash }",
        ),
      /must use artifact-backed state and reports/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          "      - name: Build the report",
          "      - name: Create finding issue\n        run: gh issue create\n\n      - name: Build the report",
        ),
      /must not use GitHub Issues/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          "          method: chat.postMessage",
          "          method: chat.postMessage\n          method: chat.postMessage",
        ),
      /must post one batched Slack message/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          "COLLECT_OUTCOME: ${{ steps.collect.outcome }}",
          "COLLECT_OUTCOME: skipped",
        ),
      /missing "COLLECT_OUTCOME: \$\{\{ steps\.collect\.outcome \}\}"/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          /actions\/upload-artifact@[0-9a-f]{40}/,
          "actions/upload-artifact@v7",
        ),
      /pin actions\/upload-artifact by full commit SHA/,
    );
    rejects(
      (files) =>
        edit(
          files,
          ".github/workflows/beta-e2e-report.yml",
          /Slack notification not configured/g,
          "Slack skipped",
        ),
      /missing "Slack notification not configured"/,
    );
  });
});
