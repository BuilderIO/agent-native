import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import { failureDiagnostic } from "../../e2e/failure-diagnostic.js";
import { ResponseDiagnostics } from "../../e2e/response-diagnostics.js";

afterEach(() => vi.useRealTimers());

test("unreadable response bodies cannot hold up the collector", async () => {
  vi.useFakeTimers();
  const diagnostics = new ResponseDiagnostics();
  const results: string[] = [];
  const report = (body: unknown) => {
    results.push(
      JSON.parse(failureDiagnostic("query", "POST", 500, body)).errorCode,
    );
  };
  diagnostics.record(
    () => new Promise(() => {}),
    report,
    () => assert.fail("diagnostic callback failed"),
  );
  diagnostics.record(
    async () => {
      throw new Error("closed");
    },
    report,
    () => assert.fail("diagnostic callback failed"),
  );
  diagnostics.record(
    async () => JSON.parse("{"),
    report,
    () => assert.fail("diagnostic callback failed"),
  );
  const drained = diagnostics.drain();
  vi.advanceTimersByTime(2000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(results, [
    "body_unreadable",
    "body_unreadable",
    "body_unreadable",
  ]);
  await drained;
});

test("reports callback failures and handles late body rejection", async () => {
  vi.useFakeTimers();
  const diagnostics = new ResponseDiagnostics();
  const failures: string[] = [];
  let rejectRead: ((error: Error) => void) | undefined;
  diagnostics.record(
    () =>
      new Promise((_, reject) => {
        rejectRead = reject;
      }),
    () => {
      throw new Error("report failed");
    },
    () => {
      failures.push("diagnostic unreadable");
    },
  );
  await Promise.resolve();
  vi.advanceTimersByTime(2000);
  await diagnostics.drain();
  assert.ok(rejectRead);
  rejectRead(new Error("late rejection"));
  await Promise.resolve();
  assert.deepEqual(failures, ["diagnostic unreadable"]);
});
