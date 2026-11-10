import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countMarkerOccurrencesAcrossTextChunks,
  parseJsonRecord,
  parseScheduledRecoveryArguments,
  validateScheduledRecoveryArguments,
  validateScheduledRecoveryOutcome,
  validateScheduledRecoveryPreflight,
  type ScheduledRecoverySnapshot,
} from "./verify-agent-durable-scheduled-recovery.js";

const ids = {
  runId: "agent-durability-canary-checkpoint-1",
  threadId: "thread-checkpoint-1",
  turnId: "turn-checkpoint-1",
};
const marker = "durability-result-8471";

function cliArgs(overrides: Record<string, string> = {}) {
  const values = new Map<string, string>([
    ["--site", "https://beta.chat.agent-native.com"],
    ["--app-id", "default"],
    ["--run-id", ids.runId],
    ["--thread-id", ids.threadId],
    ["--turn-id", ids.turnId],
    ["--expected-marker", marker],
    ["--deployment-id", "deploy-123"],
    ["--deployment-sha", "a".repeat(40)],
    ...Object.entries(overrides),
  ]);
  return [
    "--observe-scheduled-recovery",
    "--confirm-isolated-beta",
    "--confirm-no-manual-wake",
    ...[...values].flatMap(([key, value]) => [key, value]),
  ];
}

function snapshot(
  overrides: Partial<ScheduledRecoverySnapshot> = {},
): ScheduledRecoverySnapshot {
  return {
    runs: [
      {
        id: ids.runId,
        status: "running",
        terminalReason: null,
        dispatchMode: "background",
        dispatchPayload: { prompt: `Continue and emit ${marker}` },
        continuationOrder: 1,
        startedAt: 1_000,
        heartbeatAt: 1_000,
        lastProgressAt: 1_000,
      },
    ],
    checkpointCount: 1,
    predecessorTerminalCount: 1,
    successorTerminalCounts: {},
    successorMarkerCounts: {},
    turnRunCount: 1,
    liveLeaseCount: 0,
    threadExists: true,
    promptMatchesTurn: true,
    schedulerChecks: [{ lastCheckedAt: 900, hasError: false }],
    ...overrides,
  };
}

describe("scheduled-recovery observer arguments", () => {
  it("distinguishes unreadable persisted JSON from absent records", () => {
    assert.equal(parseJsonRecord(null), null);
    assert.throws(() => parseJsonRecord("{"), /Could not parse persisted JSON/);
  });

  it("prints help without credentials or a trigger", () => {
    assert.equal(parseScheduledRecoveryArguments([]).help, true);
    assert.equal(parseScheduledRecoveryArguments(["--help"]).observe, false);
  });

  it("requires an isolated site and an explicit no-manual-wake assertion", () => {
    const missingIsolation = parseScheduledRecoveryArguments(
      cliArgs().filter((arg) => arg !== "--confirm-no-manual-wake"),
    );
    assert.throws(
      () => validateScheduledRecoveryArguments(missingIsolation),
      /confirm-no-manual-wake/,
    );
    const unsafeSite = parseScheduledRecoveryArguments(
      cliArgs({ "--site": "https://app.agent-native.com" }),
    );
    assert.throws(
      () => validateScheduledRecoveryArguments(unsafeSite),
      /beta\.\*\.agent-native\.com/,
    );
  });

  it("keeps evidence inside the ignored temporary directory", () => {
    const unsafe = parseScheduledRecoveryArguments(
      cliArgs({ "--evidence": ".tmp/../../outside.json" }),
    );
    assert.throws(
      () => validateScheduledRecoveryArguments(unsafe),
      /remain inside \.tmp/,
    );
  });
});

describe("scheduled-recovery text markers", () => {
  it("counts markers split across adjacent persisted text events", () => {
    assert.equal(
      countMarkerOccurrencesAcrossTextChunks(
        ["durability-result-", "8471"],
        marker,
      ),
      1,
    );
  });

  it("counts repeated markers across the joined text stream", () => {
    assert.equal(
      countMarkerOccurrencesAcrossTextChunks(
        [marker.slice(0, 10), `${marker.slice(10)} ${marker}`],
        marker,
      ),
      2,
    );
  });
});

describe("scheduled-recovery preflight", () => {
  it("requires a stale checkpointed run with no existing successor", () => {
    assert.doesNotThrow(() =>
      validateScheduledRecoveryPreflight(snapshot(), ids, marker, 100_000),
    );
    assert.throws(
      () =>
        validateScheduledRecoveryPreflight(
          snapshot({ turnRunCount: 2 }),
          ids,
          marker,
          100_000,
        ),
      /already has a successor/,
    );
    assert.throws(
      () =>
        validateScheduledRecoveryPreflight(
          snapshot({ liveLeaseCount: 1 }),
          ids,
          marker,
          100_000,
        ),
      /live lease/,
    );
  });

  it("rejects an unsafe continuation payload without the expected marker", () => {
    assert.throws(
      () =>
        validateScheduledRecoveryPreflight(
          snapshot({
            runs: [
              {
                ...snapshot().runs[0]!,
                dispatchPayload: { prompt: "unrelated prompt" },
              },
            ],
          }),
          ids,
          marker,
          100_000,
        ),
      /does not include the expected outcome marker/,
    );
  });

  it("waits until the checkpointed worker is stale before observing recovery", () => {
    const fresh = snapshot({
      runs: [
        {
          ...snapshot().runs[0]!,
          startedAt: 99_500,
          heartbeatAt: 99_500,
          lastProgressAt: 99_500,
        },
      ],
    });
    assert.throws(
      () => validateScheduledRecoveryPreflight(fresh, ids, marker, 100_000),
      /is not stale yet/,
    );
  });
});

describe("scheduled-recovery outcome", () => {
  it("requires the scheduler tick, one continuation, and one expected completion", () => {
    const completed = snapshot({
      runs: [
        {
          id: ids.runId,
          status: "truncated",
          terminalReason: "run_timeout",
          dispatchMode: "background",
          dispatchPayload: { prompt: `Continue and emit ${marker}` },
          continuationOrder: 1,
          startedAt: 1_000,
          heartbeatAt: 1_000,
          lastProgressAt: 1_000,
        },
        {
          id: `${ids.runId}-successor`,
          status: "completed",
          terminalReason: null,
          dispatchMode: "background-processing",
          dispatchPayload: null,
          continuationOrder: 2,
          startedAt: 2_000,
          heartbeatAt: 2_000,
          lastProgressAt: 2_000,
        },
      ],
      successorTerminalCounts: { [`${ids.runId}-successor`]: 1 },
      successorMarkerCounts: { [`${ids.runId}-successor`]: 1 },
      turnRunCount: 2,
      schedulerChecks: [{ lastCheckedAt: 2_000, hasError: false }],
    });

    assert.deepEqual(
      validateScheduledRecoveryOutcome(completed, ids, marker, 1_000),
      { schedulerCheckedAt: 2_000, successorRunId: `${ids.runId}-successor` },
    );
    assert.throws(
      () =>
        validateScheduledRecoveryOutcome(
          snapshot({
            ...completed,
            turnRunCount: 3,
            runs: [
              ...completed.runs,
              { ...completed.runs[1]!, id: "duplicate" },
            ],
          }),
          ids,
          marker,
          1_000,
        ),
      /duplicate successors/,
    );
    assert.throws(
      () =>
        validateScheduledRecoveryOutcome(
          snapshot({
            ...completed,
            successorMarkerCounts: { [`${ids.runId}-successor`]: 2 },
          }),
          ids,
          marker,
          1_000,
        ),
      /missing or duplicated/,
    );
    assert.throws(
      () =>
        validateScheduledRecoveryOutcome(
          snapshot({
            ...completed,
            runs: completed.runs.map((run) =>
              run.id === `${ids.runId}-successor`
                ? { ...run, continuationOrder: 1 }
                : run,
            ),
          }),
          ids,
          marker,
          1_000,
        ),
      /does not follow the checkpointed predecessor/,
    );
  });
});
