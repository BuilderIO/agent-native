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
        "timeout-minutes"?: unknown;
        if?: unknown;
        with?: { "if-no-files-found"?: unknown };
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
const shardStep = workflow.jobs?.e2e?.steps?.find(
  (step) => step.name === "Run shard",
);
assert.equal(shardStep?.id, "run-shard");
assert.equal(shardStep?.["timeout-minutes"], 37);
const reportStep = workflow.jobs?.e2e?.steps?.find(
  (step) => step.name === "Upload report on failure",
);
assert.equal(
  reportStep?.if,
  "${{ always() && steps.run-shard.outcome != 'success' }}",
);
assert.equal(reportStep?.with?.["if-no-files-found"], "warn");
