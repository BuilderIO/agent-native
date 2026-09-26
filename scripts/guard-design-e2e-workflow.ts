import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parse } from "yaml";

const workflow = parse(
  readFileSync(".github/workflows/design-e2e.yml", "utf8"),
) as {
  concurrency?: { group?: unknown; "cancel-in-progress"?: unknown };
  jobs?: { e2e?: { "timeout-minutes"?: unknown } };
};

assert.equal(workflow.concurrency?.group, "design-e2e");
assert.equal(workflow.concurrency?.["cancel-in-progress"], false);
assert.equal(workflow.jobs?.e2e?.["timeout-minutes"], 45);
