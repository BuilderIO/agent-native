import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parse } from "yaml";

const workflow = parse(
  readFileSync(".github/workflows/design-e2e.yml", "utf8"),
) as {
  on?: {
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
      "timeout-minutes"?: unknown;
      steps?: Array<{
        id?: unknown;
        name?: unknown;
        uses?: unknown;
        "timeout-minutes"?: unknown;
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
  "schedule",
  "workflow_dispatch",
]);
assert.deepEqual(workflow.on?.schedule, [{ cron: "37 9 * * *" }]);
assert.ok(Object.hasOwn(workflow.on ?? {}, "workflow_dispatch"));
assert.equal(workflow.on?.push, undefined);
assert.equal(workflow.concurrency?.group, "design-e2e");
assert.equal(workflow.concurrency?.["cancel-in-progress"], true);
assert.equal(workflow.concurrency?.queue, undefined);
assert.equal(workflow.jobs?.e2e?.["timeout-minutes"], 45);
const steps = workflow.jobs?.e2e?.steps ?? [];
const shardIndex = steps.findIndex((step) => step.name === "Run shard");
const shardStep = steps.find((step) => step.name === "Run shard");
assert.equal(shardStep?.id, "run-shard");
assert.equal(shardStep?.["timeout-minutes"], 37);
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
  "${{ always() && steps.run-shard.outcome != 'success' }}",
);
assert.equal(reportStep?.with?.path, "templates/design/test-results");
assert.equal(reportStep?.with?.["retention-days"], 7);
assert.equal(reportStep?.with?.["if-no-files-found"], "warn");
