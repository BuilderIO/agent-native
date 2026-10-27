import assert from "node:assert/strict";
import test from "node:test";

import {
  matchesRecoveryThreadResponse,
  RECOVERY_TIMELINE_BODY_LIMIT,
  RecoveryThreadTimeline,
} from "./recovery-thread-timeline";

const message = (id: string, text: string, runId?: string) => ({
  id,
  role: "assistant",
  content: text,
  ...(runId ? { metadata: { runId } } : {}),
});
const body = (roots: unknown[], snapshots: unknown[], runs: unknown[] = []) =>
  JSON.stringify({
    threadData: { messages: roots, agentKit: { messages: snapshots, runs } },
  });
const finish = (
  timeline: RecoveryThreadTimeline,
  phase: "before-first-reload" | "after-first-reload" | "after-second-reload",
  value: string,
) => {
  const ordinal = timeline.begin(phase);
  assert.notEqual(ordinal, null);
  timeline.accept(ordinal!, value);
};

test("compares an earlier running root and active draft to the final prefix without private output", () => {
  const timeline = new RecoveryThreadTimeline();
  finish(
    timeline,
    "after-first-reload",
    body(
      [message("fixture-draft", "PRIVATE_PREFIX", "fixture-run")],
      [],
      [
        {
          id: "fixture-run",
          status: "running",
          activeMessageId: "fixture-draft",
        },
      ],
    ),
  );
  finish(
    timeline,
    "after-second-reload",
    body(
      [message("fixture-final-root", "PRIVATE_PREFIX complete", "fixture-run")],
      [
        message("fixture-draft", "PRIVATE_PREFIX"),
        message("fixture-final-sdk", "PRIVATE_PREFIX complete", "fixture-run"),
      ],
    ),
  );
  const summary = timeline.summary();
  assert.equal(summary.priorRunningCaptureCount, 1);
  assert.equal(summary.finalPrefixes[0]?.priorRunningRootIdMatchCount, 1);
  assert.equal(summary.finalPrefixes[0]?.priorRunningRootTextEqualsCount, 1);
  assert.equal(summary.finalPrefixes[0]?.priorActiveDraftIdMatchCount, 1);
  for (const privateValue of ["fixture-", "PRIVATE_PREFIX"])
    assert.equal(JSON.stringify(summary).includes(privateValue), false);
});

test("preserves eventless completed prefixes as measurements with no inferred supersession", () => {
  const timeline = new RecoveryThreadTimeline();
  finish(
    timeline,
    "after-first-reload",
    body(
      [message("fixture-other", "fixture separate")],
      [],
      [
        {
          id: "fixture-run",
          status: "completed",
          activeMessageId: "fixture-prefix",
        },
      ],
    ),
  );
  finish(
    timeline,
    "after-second-reload",
    body(
      [message("fixture-root", "fixture prefix complete")],
      [{ ...message("fixture-prefix", "fixture prefix"), status: "complete" }],
    ),
  );
  assert.equal(
    timeline.summary().finalPrefixes[0]?.priorActiveDraftIdMatchCount,
    0,
  );
  assert.equal(
    timeline.summary().finalPrefixes[0]?.priorRunningRootIdMatchCount,
    0,
  );
});

test("exposes missing, malformed, oversized, bounded, ambiguous, and pending capture states", () => {
  const timeline = new RecoveryThreadTimeline();
  assert.equal(timeline.summary().kind, "missing");
  const a = timeline.begin("before-first-reload")!;
  const b = timeline.begin("before-first-reload")!;
  assert.equal(timeline.begin("after-first-reload"), null);
  assert.equal(timeline.summary().pendingCount, 2);
  timeline.accept(a, "not json");
  timeline.accept(b, "x".repeat(RECOVERY_TIMELINE_BODY_LIMIT + 1));
  finish(
    timeline,
    "after-first-reload",
    body(
      [message("fixture-duplicate", "x"), message("fixture-duplicate", "x")],
      [],
    ),
  );
  finish(
    timeline,
    "after-first-reload",
    body([], [message("x".repeat(257), "x".repeat(8193))]),
  );
  const summary = timeline.summary(true);
  assert.equal(summary.kind, "partial");
  assert.equal(summary.captures[0]?.state, "unreadable");
  assert.equal(summary.captures[1]?.state, "oversized");
  assert.equal(summary.captures[2]?.ambiguousIdCount, 1);
  assert.equal(summary.captures[3]?.truncated, true);
  assert.equal(summary.omittedCount, 1);
  assert.equal(summary.cleanupFailed, true);
  assert.equal(summary.finalCapturePresent, false);
});

test("filters exact same-origin current owner-thread GETs", () => {
  const origin = "https://fixture.invalid";
  const url = origin + "/_agent-native/agent-chat/threads/fixture-thread";
  assert.equal(
    matchesRecoveryThreadResponse(origin, url, "GET", "fixture-thread"),
    true,
  );
  for (const [target, method, id] of [
    [url, "PUT", "fixture-thread"],
    [url + "/fork", "GET", "fixture-thread"],
    [url, "GET", "other"],
    [url.replace("fixture.invalid", "other.invalid"), "GET", "fixture-thread"],
    [url, "GET", null],
    ["not a URL", "GET", "fixture-thread"],
  ] as const)
    assert.equal(
      matchesRecoveryThreadResponse(origin, target, method, id),
      false,
    );
});

test("caps captures by phase, arrays, parts and runs and reports missing collections", () => {
  const timeline = new RecoveryThreadTimeline();
  for (const [phase, count] of [
    ["before-first-reload", 2],
    ["after-first-reload", 3],
    ["after-second-reload", 3],
  ] as const)
    for (let index = 0; index < count; index++)
      finish(timeline, phase, body([], []));
  assert.equal(timeline.begin("after-second-reload"), null);
  assert.equal(timeline.summary().captureCount, 8);
  assert.equal(timeline.summary().omittedCount, 1);
  const bounded = new RecoveryThreadTimeline();
  finish(
    bounded,
    "after-first-reload",
    body(
      Array.from({ length: 65 }, (_, index) =>
        message(`fixture-${index}`, "fixture"),
      ),
      [
        {
          id: "fixture-parts",
          role: "assistant",
          parts: Array.from({ length: 65 }, () => ({
            type: "text",
            text: "fixture",
          })),
        },
      ],
      Array.from({ length: 33 }, (_, index) => ({
        id: `fixture-run-${index}`,
        status: "running",
      })),
    ),
  );
  const summary = bounded.summary();
  assert.equal(summary.captures[0]?.truncated, true);
  assert.equal(summary.captures[0]?.rootAssistantCount, 64);
  assert.equal(summary.captures[0]?.runningRunCount, 32);
  assert.equal(summary.captures[0]?.runningActiveMessageIdMissingCount, 32);
  const missing = new RecoveryThreadTimeline();
  finish(missing, "after-first-reload", JSON.stringify({ threadData: {} }));
  assert.equal(missing.summary().kind, "partial");
  assert.equal(missing.summary().captures[0]?.rootsMissing, true);
  assert.equal(missing.summary().captures[0]?.snapshotsMissing, true);
  assert.equal(missing.summary().captures[0]?.runsMissing, true);
});

test("emits only closed scalar values and never compares ambiguous or malformed captures", () => {
  const timeline = new RecoveryThreadTimeline();
  finish(
    timeline,
    "after-first-reload",
    body(
      [message("fixture-prefix", "fixture", "fixture-run")],
      [],
      [
        {
          id: "fixture-run",
          status: "running",
          activeMessageId: "fixture-prefix",
        },
        {
          id: "fixture-other-run",
          status: "running",
          activeMessageId: "fixture-prefix",
        },
      ],
    ),
  );
  finish(
    timeline,
    "after-second-reload",
    body(
      [message("fixture-root", "fixture complete")],
      [message("fixture-prefix", "fixture")],
    ),
  );
  const summary = timeline.summary();
  assert.equal(summary.kind, "partial");
  assert.equal(summary.finalPrefixes[0]?.priorActiveDraftIdMatchCount, 0);
  assert.equal(summary.captures[0]?.ambiguousIdCount, 1);
  const allowed = new Set([
    "missing",
    "partial",
    "complete",
    "ok",
    "unreadable",
    "oversized",
    "before-first-reload",
    "after-first-reload",
    "after-second-reload",
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object")
      return Object.values(value).forEach(visit);
    if (typeof value === "string") assert.equal(allowed.has(value), true);
    else
      assert.equal(
        typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)),
        true,
      );
  };
  visit(summary);
  const malformed = new RecoveryThreadTimeline();
  finish(
    malformed,
    "after-first-reload",
    body([], [], [{ id: "fixture-run", status: "PRIVATE_UNKNOWN_STATUS" }]),
  );
  assert.equal(malformed.summary().captures[0]?.state, "unreadable");
  const pending = malformed.begin("after-second-reload")!;
  malformed.reject(pending, "unreadable");
  assert.equal(malformed.summary().pendingCount, 0);
  assert.equal(malformed.summary().captures[1]?.state, "unreadable");
});
