import assert from "node:assert/strict";
import { it } from "node:test";

import { finishBuildVerdict, flowBuildLine } from "./build-boundary.js";

await it("emits each flow's actual build observations in the release protocol", async () => {
  const a = { kind: "read", sha: "a".repeat(40) } as const;
  const b = { kind: "read", sha: "b".repeat(40) } as const;
  const result = await finishBuildVerdict("PASS", "ok", a, async () => b);
  const line = flowBuildLine("example", result.before, result.after);
  assert.ok(line.startsWith("FLOW_BUILD "));
  assert.deepEqual(JSON.parse(line.slice("FLOW_BUILD ".length)), {
    name: "example",
    before: a,
    after: b,
  });
  assert.equal(result.status, "COULD-NOT-RUN");
  const absent = { kind: "absent" } as const;
  const unreadable = {
    kind: "unreadable",
    reason: "Flow not started",
  } as const;
  assert.deepEqual(
    JSON.parse(
      flowBuildLine("unstarted", unreadable, absent).slice(
        "FLOW_BUILD ".length,
      ),
    ),
    { name: "unstarted", before: unreadable, after: absent },
  );
});

await it("keeps stable verdicts and isolates a changed build to its own flow", async () => {
  const a = { kind: "read", sha: "a".repeat(40) } as const;
  const b = { kind: "read", sha: "b".repeat(40) } as const;
  const changed = await finishBuildVerdict("FAIL", "broken", a, async () => b);
  assert.equal(changed.status, "COULD-NOT-RUN");
  assert.deepEqual(changed.before, a);
  assert.deepEqual(changed.after, b);
  const stable = await finishBuildVerdict("FAIL", "broken", b, async () => b);
  assert.equal(stable.status, "FAIL");
  assert.equal(stable.detail, "broken");
  const unstarted = await finishBuildVerdict(
    "COULD-NOT-RUN",
    "browser unavailable",
    { kind: "unreadable", reason: "Flow not started" },
    async () => b,
  );
  assert.equal(unstarted.status, "COULD-NOT-RUN");
  assert.equal(unstarted.before.kind, "unreadable");
  assert.deepEqual(unstarted.after, b);
});
