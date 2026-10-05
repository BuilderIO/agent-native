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
      strategy?: { matrix?: { shard?: unknown } };
      steps?: Array<{
        id?: unknown;
        name?: unknown;
        uses?: unknown;
        "timeout-minutes"?: unknown;
        run?: unknown;
        if?: unknown;
        with?: {
          name?: unknown;
          path?: unknown;
          "if-no-files-found"?: unknown;
          "retention-days"?: unknown;
        };
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
  "${{ github.event_name == 'pull_request' && 'Export pixel fidelity' || format('Shard {0}/8', matrix.shard) }}",
);
assert.equal(
  workflow.jobs?.e2e?.strategy?.matrix?.shard,
  "${{ github.event_name == 'pull_request' && fromJSON('[1]') || fromJSON('[1, 2, 3, 4, 5, 6, 7, 8]') }}",
);
const steps = workflow.jobs?.e2e?.steps ?? [];
const shardIndex = steps.findIndex((step) => step.name === "Run shard");
const shardStep = steps.find((step) => step.name === "Run shard");
assert.equal(shardStep?.id, "run-shard");
assert.equal(
  shardStep?.run,
  [
    "mkdir -p .react-router/types",
    'if [[ "$GITHUB_EVENT_NAME" == "pull_request" ]]; then',
    "  pnpm exec playwright test e2e/url-export-font-fidelity.spec.ts e2e/single-screen-pdf-fidelity.spec.ts e2e/imported-html-export-fidelity.spec.ts",
    "else",
    "  pnpm exec playwright test --shard=${{ matrix.shard }}/8",
    "fi",
  ].join("\n") + "\n",
);
const shardTimeout = shardStep?.["timeout-minutes"];
assert.equal(shardTimeout, 37);
assert.ok(
  typeof jobTimeout === "number" &&
    typeof shardTimeout === "number" &&
    jobTimeout - shardTimeout >= 10,
  "leave at least 10 minutes for setup and report upload after the shard timeout",
);
const reportIndex = steps.findIndex(
  (step) => step.name === "Upload report on failure",
);
const reportStep = steps.find(
  (step) => step.name === "Upload report on failure",
);
assert.ok(shardIndex >= 0 && reportIndex > shardIndex);
assert.equal(
  reportStep?.uses,
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
);
assert.equal(
  reportStep?.if,
  "${{ !cancelled() && steps.run-shard.outcome != 'success' }}",
);
assert.equal(reportStep?.with?.path, "templates/design/test-results");
assert.equal(reportStep?.with?.["retention-days"], 7);
assert.equal(reportStep?.with?.["if-no-files-found"], "warn");
