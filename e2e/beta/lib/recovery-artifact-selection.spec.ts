import assert from "node:assert/strict";
import test from "node:test";

import {
  RECOVERY_REFRESH_TEST_TITLE,
  selectRecoveryThreadRef,
} from "./recovery-artifact-selection";

function report(
  results: unknown[],
  projectName = "chat",
  appSuiteName = "content agent chat reliability",
): unknown {
  return {
    suites: [
      {
        title: projectName,
        suites: [
          {
            title: appSuiteName,
            specs: [
              {
                title: RECOVERY_REFRESH_TEST_TITLE,
                tests: [{ projectName, results }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function failed(retry: number, threadRef: string): unknown {
  return {
    retry,
    status: "failed",
    errors: [{ message: `assertion failed\nthread: ${threadRef}\n` }],
  };
}

test("selects the sole failed attempt even when a retry later passed", () => {
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([
        failed(0, "thread_old_123"),
        { retry: 1, status: "passed", errors: [] },
      ]),
      "content",
    ),
    {
      kind: "selected",
      threadRef: "thread_old_123",
      failedAttempt: 0,
    },
  );
});

test("deduplicates repeated copies of the same thread line", () => {
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([
        {
          retry: 0,
          status: "failed",
          errors: [
            { message: "thread: thread_same_123" },
            { message: "diagnostic repeats\nthread: thread_same_123" },
          ],
        },
      ]),
      "content",
    ),
    {
      kind: "selected",
      threadRef: "thread_same_123",
      failedAttempt: 0,
    },
  );
});

test("does not select a passing test or a different project", () => {
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([{ retry: 0, status: "passed", errors: [] }]),
      "content",
    ),
    { kind: "missing", reason: "failed_attempt" },
  );
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([failed(0, "thread_123")], "other"),
      "content",
    ),
    { kind: "missing", reason: "test" },
  );
});

test("distinguishes absent and unreadable report shapes", () => {
  assert.deepEqual(selectRecoveryThreadRef({ suites: [] }, "content"), {
    kind: "missing",
    reason: "test",
  });
  assert.deepEqual(
    selectRecoveryThreadRef({ suites: "not-a-list" }, "content"),
    {
      kind: "unreadable",
      reason: "report",
    },
  );
  assert.deepEqual(selectRecoveryThreadRef({}, "content"), {
    kind: "unreadable",
    reason: "report",
  });
});

test("fails closed when duplicate matching tests or distinct refs are present", () => {
  const match = report([failed(0, "thread_123")]) as {
    suites: unknown[];
  };
  assert.deepEqual(
    selectRecoveryThreadRef(
      { suites: [...match.suites, ...match.suites] },
      "content",
    ),
    { kind: "ambiguous", reason: "test" },
  );
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([
        {
          retry: 0,
          status: "failed",
          errors: [
            { message: "thread: thread_one" },
            { message: "thread: thread_two" },
          ],
        },
      ]),
      "content",
    ),
    { kind: "ambiguous", reason: "thread_ref" },
  );
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([failed(0, "thread_first"), failed(1, "thread_retry")]),
      "content",
    ),
    { kind: "ambiguous", reason: "attempt" },
  );
});

test("requires the requested app suite ancestor and rejects malformed attempts", () => {
  assert.deepEqual(
    selectRecoveryThreadRef(
      report(
        [failed(0, "thread_123")],
        "chat",
        "dispatch agent chat reliability",
      ),
      "content",
    ),
    { kind: "missing", reason: "app" },
  );
  assert.deepEqual(
    selectRecoveryThreadRef(
      report([
        failed(0, "thread_123"),
        { retry: 1, status: "future-status", errors: [] },
      ]),
      "content",
    ),
    { kind: "unreadable", reason: "attempt" },
  );
  assert.deepEqual(
    selectRecoveryThreadRef(report([failed(0, "thread_123"), null]), "content"),
    { kind: "unreadable", reason: "attempt" },
  );
});

test("rejects failed results without a unique bounded opaque thread line", () => {
  assert.deepEqual(
    selectRecoveryThreadRef(report([failed(0, "(unknown)")]), "content"),
    { kind: "unreadable", reason: "thread_ref" },
  );
  assert.deepEqual(
    selectRecoveryThreadRef(report([failed(0, "t".repeat(129))]), "content"),
    { kind: "unreadable", reason: "thread_ref" },
  );
});
