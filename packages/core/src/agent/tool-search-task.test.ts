import assert from "node:assert/strict";

import { test } from "vitest";

import {
  rankTask,
  executeRecommendation,
  type Boundaries,
  type Candidate,
  type CallerContext,
} from "./tool-search-task.js";

const context: CallerContext = {
  authority: "auth",
  workspace: "a",
  accountEpoch: "1",
  session: "s",
  run: "r",
  target: "t",
  revocation: "1",
};
const candidate = (
  id: string,
  kind: Candidate["kind"] = "tool",
): Candidate => ({
  id,
  kind,
  name: id,
  description: id,
  use: { type: "tools/call" },
  callable: true,
  reason: "relevant",
});
const allowed = candidate("allowed");
const denied = candidate("denied", "app");
function fake(): Boundaries {
  return {
    grantedIds: async () => ["allowed"],
    rank: async () => ({ status: "selected", ids: ["allowed"] }),
    bm25: () => ["allowed"],
    executeAuthorized: async (_ctx, _candidate, operation) => operation(),
  };
}

test("only granted candidates reach the ranker and forged IDs cannot escape", async () => {
  const boundaries = fake();
  boundaries.grantedIds = async () => ["allowed", "forged"];
  boundaries.rank = async (_ctx, _task, input) => {
    assert.deepEqual(
      input.map((item) => item.id),
      ["allowed"],
    );
    return {
      status: "selected",
      ids: ["denied", "forged", "allowed", "allowed"],
    };
  };
  const result = await rankTask(context, "find", [allowed, denied], boundaries);
  assert.equal(result.ranking, "jev");
  assert.deepEqual(result.recommendations, [allowed]);
});

test("degraded results use only granted BM25 candidates and preserve status", async () => {
  for (const status of ["unavailable", "failed", "timed_out"] as const) {
    const boundaries = fake();
    boundaries.rank = async () => ({ status, ids: ["denied"] });
    boundaries.bm25 = () => ["denied", "allowed"];
    const result = await rankTask(
      context,
      "find",
      [allowed, denied],
      boundaries,
    );
    assert.deepEqual(result, {
      ranking: "bm25",
      status,
      recommendations: [allowed],
    });
  }
});

test("missing context and failed grants never reach ranking or fallback", async () => {
  const boundaries = fake();
  boundaries.rank = async () => {
    throw new Error("must not rank");
  };
  boundaries.bm25 = () => {
    throw new Error("must not fall back");
  };
  assert.deepEqual(
    (await rankTask(null, "find", [allowed], boundaries)).recommendations,
    [],
  );
  boundaries.grantedIds = async () => {
    throw new Error("denied");
  };
  assert.deepEqual(await rankTask(context, "find", [allowed], boundaries), {
    ranking: "bm25",
    status: "unavailable",
    recommendations: [],
  });
});

test("duplicate IDs fail closed and no-match stays a ranked empty result", async () => {
  const boundaries = fake();
  assert.equal(
    (await rankTask(context, "find", [allowed, denied, allowed], boundaries))
      .status,
    "failed",
  );
  boundaries.rank = async () => ({ status: "no-match", ids: [] });
  assert.deepEqual(await rankTask(context, "find", [allowed], boundaries), {
    ranking: "jev",
    status: "no-match",
    recommendations: [],
  });
});

test("execution invokes current grant check and denies revoked or wrong-workspace access", async () => {
  const boundaries = fake();
  let active = true;
  let called = false;
  boundaries.executeAuthorized = async (ctx, item, operation) => {
    if (!active || ctx.workspace !== "a" || item.id !== "allowed")
      throw new Error("denied");
    return operation();
  };
  const result = await rankTask(context, "find", [allowed], boundaries);
  active = false;
  const recommendation = result.recommendations[0];
  assert.ok(recommendation);
  await assert.rejects(
    executeRecommendation(context, recommendation, boundaries, async () => {
      called = true;
    }),
    /denied/,
  );
  active = true;
  await assert.rejects(
    executeRecommendation(
      { ...context, workspace: "b" },
      allowed,
      boundaries,
      async () => {
        called = true;
      },
    ),
    /denied/,
  );
  assert.equal(called, false);
});

test("thrown ranker failure falls back without leaking denied candidates", async () => {
  const boundaries = fake();
  boundaries.rank = async () => {
    throw new Error("failure");
  };
  assert.deepEqual(
    await rankTask(context, "find", [allowed, denied], boundaries),
    {
      ranking: "bm25",
      status: "failed",
      recommendations: [allowed],
    },
  );
});

test("a stalled ranker is aborted and degrades to the granted baseline", async () => {
  const boundaries = fake();
  let aborted = false;
  boundaries.rank = async (_ctx, _task, _candidates, signal) =>
    new Promise((_resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
    });
  assert.deepEqual(
    await rankTask(context, "find", [allowed, denied], boundaries),
    {
      ranking: "bm25",
      status: "timed_out",
      recommendations: [allowed],
    },
  );
  assert.equal(aborted, true);
});

test("a host can rank an already authorized candidate set without invented caller fields", async () => {
  const { rankGrantedTask } = await import("./tool-search-task.js");
  const result = await rankGrantedTask("find", [allowed], {
    rank: async () => ({ status: "unavailable", ids: [] }),
    bm25: () => ["allowed"],
  });
  assert.deepEqual(result, {
    ranking: "bm25",
    status: "unavailable",
    recommendations: [allowed],
  });
});

test("a missing optional provider is labelled unavailable", async () => {
  const { rankGrantedTask } = await import("./tool-search-task.js");
  const { OptionalPeerDependencyError } =
    await import("../shared/optional-peer.js");
  const result = await rankGrantedTask("find", [allowed], {
    rank: async () => {
      throw new OptionalPeerDependencyError("test-provider");
    },
    bm25: () => ["allowed"],
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.ranking, "bm25");
});
