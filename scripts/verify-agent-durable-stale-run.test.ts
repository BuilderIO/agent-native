import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseJsonRecord,
  parseCanaryArguments,
  threadProjection,
  validateCanaryArguments,
  validateCanaryOutcome,
  validateCanaryPreflight,
  type CanarySnapshot,
} from "./verify-agent-durable-stale-run.js";

const IDS = {
  runId: "agent-durability-canary-fixture-1",
  threadId: "thread-fixture-1",
  turnId: "turn-fixture-1",
};

function argsFor(overrides: Record<string, string> = {}) {
  const values = new Map<string, string>([
    ["--site", "https://beta.chat.agent-native.com"],
    ["--run-id", IDS.runId],
    ["--thread-id", IDS.threadId],
    ["--turn-id", IDS.turnId],
    ["--deployment-id", "deploy-123"],
    ["--deployment-sha", "a".repeat(40)],
    ...Object.entries(overrides),
  ]);
  return [
    "--execute",
    "--confirm-full-sweep",
    "--confirm-isolated-beta",
    ...[...values].flatMap(([key, value]) => [key, value]),
  ];
}

function snapshot(overrides: Partial<CanarySnapshot> = {}): CanarySnapshot {
  return {
    run: {
      id: IDS.runId,
      threadId: IDS.threadId,
      turnId: IDS.turnId,
      status: "running",
      startedAt: 1_000,
      heartbeatAt: 1_000,
      lastProgressAt: 1_000,
      inFlightSince: null,
      dispatchMode: "background",
      hasDispatchPayload: false,
      workerGeneration: null,
      errorCode: null,
      terminalReason: null,
    },
    liveLeaseCount: 0,
    turnRunCount: 1,
    terminalEventCount: 0,
    staleRunTerminalEventCount: 0,
    threadExists: true,
    promptMatchesTurn: true,
    foldedRunId: false,
    projectedStaleRunError: false,
    schedulerChecks: [{ lastCheckedAt: 900, hasError: false }],
    ...overrides,
  };
}

describe("deployed stale-run canary arguments", () => {
  it("distinguishes unreadable persisted JSON from absent records", () => {
    assert.equal(parseJsonRecord(null), null);
    assert.throws(() => parseJsonRecord("{"), /Could not parse persisted JSON/);
  });

  it("prints help without requiring credentials or enabling a sweep", () => {
    assert.equal(parseCanaryArguments([]).help, true);
    assert.equal(parseCanaryArguments(["--help"]).execute, false);
  });

  it("requires explicit full-sweep and isolated-Beta acknowledgements", () => {
    const parsed = parseCanaryArguments(
      argsFor().filter((arg) => arg !== "--confirm-full-sweep"),
    );
    assert.throws(() => validateCanaryArguments(parsed), /confirm-full-sweep/);
  });

  it("accepts only the Beta Netlify background endpoint", () => {
    const parsed = parseCanaryArguments(argsFor());
    assert.equal(
      validateCanaryArguments(parsed).functionUrl.pathname,
      "/.netlify/functions/server-agent-background",
    );
    const unsafe = parseCanaryArguments(
      argsFor({ "--site": "https://app.agent-native.com" }),
    );
    assert.throws(
      () => validateCanaryArguments(unsafe),
      /beta\.\*\.agent-native\.com/,
    );
  });

  it("keeps evidence paths inside the ignored temporary directory", () => {
    const unsafe = parseCanaryArguments(
      argsFor({ "--evidence": ".tmp/../../outside.json" }),
    );
    assert.throws(() => validateCanaryArguments(unsafe), /remain inside \.tmp/);
  });
});

describe("stale-run canary preflight", () => {
  it("accepts a stale, unleased, non-redispatchable run with its prompt", () => {
    assert.equal(validateCanaryPreflight(snapshot(), IDS, 100_000), 99_000);
  });

  it("rejects a live lease, terminal event, or dispatchable payload", () => {
    assert.throws(
      () =>
        validateCanaryPreflight(snapshot({ liveLeaseCount: 1 }), IDS, 100_000),
      /live execution lease/,
    );
    assert.throws(
      () =>
        validateCanaryPreflight(
          snapshot({ terminalEventCount: 1 }),
          IDS,
          100_000,
        ),
      /terminal event/,
    );
    assert.throws(
      () =>
        validateCanaryPreflight(
          snapshot({ run: { ...snapshot().run!, hasDispatchPayload: true } }),
          IDS,
          100_000,
        ),
      /must not be redispatchable/,
    );
  });

  it("rejects an unstamped user message even when it predates the run", () => {
    const projection = threadProjection(
      {
        messages: [
          {
            role: "user",
            createdAt: new Date(900).toISOString(),
            metadata: { custom: { submittedRunId: IDS.runId } },
          },
        ],
      },
      IDS,
    );

    assert.equal(projection.promptMatchesTurn, false);
    assert.throws(
      () =>
        validateCanaryPreflight({ ...snapshot(), ...projection }, IDS, 100_000),
      /thread prompt does not belong to the canary turn/,
    );
  });
});

describe("stale-run canary outcome", () => {
  it("requires the terminal row, event, projection, and scheduler tick", () => {
    const before = snapshot();
    assert.throws(
      () => validateCanaryOutcome(before, IDS, 1_000),
      /not reaped as errored/,
    );

    const completed = snapshot({
      run: {
        ...before.run!,
        status: "errored",
        errorCode: "stale_run",
        terminalReason: "error:stale_run",
      },
      terminalEventCount: 1,
      staleRunTerminalEventCount: 1,
      foldedRunId: true,
      projectedStaleRunError: true,
      schedulerChecks: [{ lastCheckedAt: 2_000, hasError: false }],
    });
    assert.deepEqual(validateCanaryOutcome(completed, IDS, 1_000), {
      schedulerCheckedAt: 2_000,
    });
  });
});
