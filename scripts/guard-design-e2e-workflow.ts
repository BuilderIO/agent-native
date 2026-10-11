import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parse } from "yaml";

const workflow = parse(
  readFileSync(".github/workflows/design-e2e.yml", "utf8"),
) as {
  on?: {
    pull_request?: { paths?: unknown };
    push?: unknown;
    schedule?: unknown;
    workflow_dispatch?: unknown;
  };
  concurrency?: {
    group?: unknown;
    "cancel-in-progress"?: unknown;
    queue?: unknown;
  };
  jobs?: {
    e2e?: {
      name?: unknown;
      "timeout-minutes"?: unknown;
      strategy?: { matrix?: { shard?: unknown; include?: unknown } };
      steps?: Array<{
        id?: unknown;
        name?: unknown;
        uses?: unknown;
        "timeout-minutes"?: unknown;
        run?: unknown;
        if?: unknown;
        env?: Record<string, unknown>;
        with?: {
          name?: unknown;
          overwrite?: unknown;
          path?: unknown;
          "if-no-files-found"?: unknown;
          "retention-days"?: unknown;
        };
      }>;
    };
    report?: {
      name?: unknown;
      if?: unknown;
      needs?: unknown;
      permissions?: Record<string, unknown>;
      steps?: Array<{
        id?: unknown;
        name?: unknown;
        uses?: unknown;
        if?: unknown;
        run?: unknown;
        "continue-on-error"?: unknown;
        with?: Record<string, unknown>;
      }>;
    };
  };
};

assert.deepEqual(Object.keys(workflow.on ?? {}).sort(), [
  "pull_request",
  "schedule",
  "workflow_dispatch",
]);
assert.deepEqual(workflow.on?.pull_request?.paths, [
  ".github/actions/setup-pnpm/**",
  ".github/workflows/design-e2e.yml",
  "package.json",
  "packages/agentkit/**",
  "packages/core/**",
  "packages/creative-context/**",
  "packages/recap-cli/**",
  "packages/toolkit/**",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/prebuild-workspace-packages.ts",
  "templates/design/**",
]);
assert.deepEqual(workflow.on?.schedule, [{ cron: "37 9 * * *" }]);
assert.ok(Object.hasOwn(workflow.on ?? {}, "workflow_dispatch"));
assert.equal(workflow.on?.push, undefined);
assert.equal(
  workflow.concurrency?.group,
  "design-e2e-${{ github.event.pull_request.number || github.ref }}",
);
assert.equal(workflow.concurrency?.["cancel-in-progress"], true);
assert.equal(workflow.concurrency?.queue, undefined);
const jobTimeout = workflow.jobs?.e2e?.["timeout-minutes"];
assert.equal(jobTimeout, 55);
assert.equal(
  workflow.jobs?.e2e?.name,
  "${{ matrix.shard == 'runtime-budget' && 'Runtime budget' || github.event_name == 'pull_request' && 'Design PR E2E' || format('Shard {0}/8', matrix.shard) }}",
);
assert.equal(
  workflow.jobs?.e2e?.strategy?.matrix?.shard,
  "${{ github.event_name == 'pull_request' && fromJSON('[1]') || fromJSON('[1, 2, 3, 4, 5, 6, 7, 8]') }}",
);
assert.deepEqual(workflow.jobs?.e2e?.strategy?.matrix?.include, [
  { shard: "runtime-budget" },
]);
const steps = workflow.jobs?.e2e?.steps ?? [];
const shardIndex = steps.findIndex((step) => step.name === "Run shard");
const shardStep = steps.find((step) => step.name === "Run shard");
assert.equal(shardStep?.id, "run-shard");
assert.equal(shardStep?.if, "matrix.shard != 'runtime-budget'");
assert.equal(
  shardStep?.run,
  [
    "mkdir -p .react-router/types",
    'base_run_id="$E2E_RUN_ID"',
    'if [[ "$GITHUB_EVENT_NAME" == "pull_request" ]]; then',
    '  E2E_RUN_ID="${base_run_id}-exports" pnpm exec playwright test e2e/url-export-font.spec.ts e2e/single-screen-pdf-export.spec.ts e2e/imported-html-export.spec.ts e2e/private-screenshot-preview.spec.ts',
    '  E2E_RUN_ID="${base_run_id}-marquee" pnpm exec playwright test e2e/marquee-reachability.spec.ts --grep "modifier-held marquee"',
    "else",
    '  E2E_RUN_ID="${base_run_id}-shard" pnpm exec playwright test --shard=${{ matrix.shard }}/8',
    "fi",
  ].join("\n") + "\n",
);
assert.equal(
  shardStep?.env?.E2E_RUN_ID,
  "design-e2e-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}",
);
const shardTimeout = shardStep?.["timeout-minutes"];
assert.equal(shardTimeout, 37);
assert.ok(
  typeof jobTimeout === "number" &&
    typeof shardTimeout === "number" &&
    jobTimeout - shardTimeout >= 10,
  "leave at least 10 minutes for setup and report upload after the shard timeout",
);
const retryArtifactIndex = steps.findIndex(
  (step) => step.name === "Detect retried test failures",
);
const reportIndex = steps.findIndex(
  (step) => step.name === "Upload Design E2E artifacts",
);
const reportStep = steps.find(
  (step) => step.name === "Upload Design E2E artifacts",
);
assert.ok(shardIndex >= 0 && reportIndex > shardIndex);
assert.ok(retryArtifactIndex > shardIndex && reportIndex > retryArtifactIndex);
assert.equal(
  reportStep?.uses,
  "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
);
assert.equal(reportStep?.with?.name, "design-e2e-report-${{ matrix.shard }}");
assert.equal(reportStep?.with?.overwrite, true);
assert.equal(
  reportStep?.if,
  "${{ !cancelled() && matrix.shard != 'runtime-budget' && (failure() || steps.retry-artifacts.outputs.found == 'true') }}",
);
assert.equal(
  reportStep?.with?.path,
  [
    "templates/design/test-results/design-e2e-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}-*/**",
    "templates/design/test-results/design-ai-sidebar-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}/**",
  ].join("\n") + "\n",
);
assert.equal(reportStep?.with?.["retention-days"], 7);
assert.equal(reportStep?.with?.["if-no-files-found"], "warn");

const source = readFileSync(".github/workflows/design-e2e.yml", "utf8");
const reporter = workflow.jobs?.report;
assert.equal(reporter?.name, "Report scheduled Design E2E failures");
assert.deepEqual(reporter?.needs, ["e2e"]);
assert.equal(
  reporter?.if,
  "${{ always() && github.event_name == 'schedule' && needs.e2e.result != 'success' && needs.e2e.result != 'skipped' }}",
);
assert.deepEqual(reporter?.permissions, {
  actions: "read",
  contents: "read",
});
const reportSteps = reporter?.steps ?? [];
const reportStepByName = (name: string) =>
  reportSteps.find((step) => step.name === name);
const artifactDownload = reportStepByName("Download Design E2E artifacts");
assert.equal(
  artifactDownload?.uses,
  "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
);
assert.equal(artifactDownload?.with?.pattern, "design-*");
assert.equal(
  reportStepByName("Collect failed jobs and full logs")?.["continue-on-error"],
  true,
);
assert.ok(
  typeof reportStepByName("Collect failed jobs and full logs")?.run ===
    "string" &&
    String(reportStepByName("Collect failed jobs and full logs")?.run).includes(
      "gh run view --log-failed --job",
    ),
  "the scheduled report must retain complete failed-job logs",
);
const reportArtifact = reportStepByName(
  "Upload the complete Design E2E report",
);
assert.equal(
  reportArtifact?.uses,
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
);
assert.equal(reportArtifact?.with?.["retention-days"], 90);
assert.equal(reportArtifact?.with?.["if-no-files-found"], "error");
const slackPosts = reportSteps.filter(
  (step) =>
    step.uses ===
      "slackapi/slack-github-action@dcb1066f776dd043e64d0e8ba94ca15cc7e1875d" &&
    step.with?.method === "chat.postMessage",
);
assert.equal(
  slackPosts.length,
  1,
  "post one consolidated Slack message per run",
);
assert.equal(
  slackPosts[0]?.with?.["payload-file-path"],
  ".tmp/design-e2e-report/slack-payload.json",
);
assert.ok(source.includes("--arg channel C0C4U4XRT6X"));
assert.ok(source.includes("Complete failed-job logs and shard artifacts:"));
assert.ok(source.includes("steps.report-artifact.outcome != 'success'"));
assert.ok(source.includes("steps.report-artifact.outputs.artifact-url == ''"));
assert.ok(source.includes("steps.collect.outcome != 'success'"));
assert.ok(source.includes("steps.slack.outputs.ok != 'true'"));
assert.ok(source.includes("No GitHub issue fallback was used."));
assert.doesNotMatch(source, /issues:\s*write|gh issue\s/);

const budgetBuild = steps.find(
  (step) => step.name === "Build Design for production",
);
const budgetMeasure = steps.find(
  (step) => step.name === "Measure the runtime budget",
);
for (const step of [budgetBuild, budgetMeasure]) {
  assert.equal(step?.if, "matrix.shard == 'runtime-budget'");
}
assert.equal(budgetBuild?.run, "pnpm build");
assert.ok(
  typeof budgetMeasure?.run === "string" &&
    budgetMeasure.run.includes("pnpm perf:runtime-budget"),
);
const budgetTimeout =
  Number(budgetBuild?.["timeout-minutes"]) +
  Number(budgetMeasure?.["timeout-minutes"]);
assert.ok(
  typeof jobTimeout === "number" && jobTimeout - budgetTimeout >= 10,
  "leave at least 10 minutes for setup and upload after the runtime budget steps",
);
