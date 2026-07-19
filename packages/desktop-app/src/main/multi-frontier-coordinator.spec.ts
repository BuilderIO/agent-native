import { describe, expect, it } from "vitest";

import {
  MultiFrontierCoordinator,
  type LocalFrontierCoordinatorState,
  type LocalFrontierParticipant,
  type LocalFrontierParticipantEvent,
  type LocalFrontierParticipantStatus,
  type LocalFrontierSessionInput,
  type LocalFrontierTurnInput,
} from "./multi-frontier-coordinator.js";

class FakeParticipant implements LocalFrontierParticipant {
  readonly starts: LocalFrontierSessionInput[] = [];
  readonly turns: LocalFrontierTurnInput[] = [];
  cancelCount = 0;
  disposeCount = 0;
  runTurnGate: Promise<void> | null = null;
  resumeGate: Promise<void> | null = null;
  emitStatusOnRun: LocalFrontierParticipantStatus | null = null;
  #listeners = new Set<(event: LocalFrontierParticipantEvent) => void>();

  readonly provider: string;
  readonly runtime: string;
  readonly model = "test-model";
  readonly capabilities = ["read", "review"];
  readonly sessionRef = "session-test";

  constructor(readonly participantId: string) {
    this.provider = participantId === "alpha" ? "codex" : "claude";
    this.runtime = participantId === "alpha" ? "codex-cli" : "claude-code";
  }

  async start(input: LocalFrontierSessionInput): Promise<void> {
    this.starts.push(input);
  }

  async runTurn(input: LocalFrontierTurnInput): Promise<void> {
    this.turns.push(input);
    if (this.emitStatusOnRun) {
      this.emit({
        id: `${input.turnId}.emitted-status`,
        participantId: this.participantId,
        permission: input.permission,
        ...(input.generation === undefined
          ? {}
          : { generation: input.generation }),
        kind: "status",
        status: this.emitStatusOnRun,
      });
    }
    await this.runTurnGate;
  }

  async resume(input: LocalFrontierSessionInput): Promise<void> {
    this.starts.push(input);
    await this.resumeGate;
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }

  onEvent(
    listener: (event: LocalFrontierParticipantEvent) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: LocalFrontierParticipantEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function createHarness(
  options: {
    maxEventBytes?: number;
    onEventIngestionError?: (input: {
      participantId: string;
      error: unknown;
    }) => void;
    throwAppendEvent?: boolean;
    asyncWrites?: boolean;
    writeGate?: () => Promise<void>;
    autoContinueAfterAgreement?: boolean;
  } = {},
) {
  const alpha = new FakeParticipant("alpha");
  const beta = new FakeParticipant("beta");
  let state: LocalFrontierCoordinatorState | null = null;
  const events: Array<
    LocalFrontierParticipantEvent & { collaborationId: string }
  > = [];
  const coordinator = new MultiFrontierCoordinator({
    collaborationId: "collaboration-1",
    participants: [alpha, beta],
    autoContinueAfterAgreement: options.autoContinueAfterAgreement,
    maxEventBytes: options.maxEventBytes,
    onEventIngestionError: options.onEventIngestionError,
    store: {
      create: (next) => {
        state = structuredClone(next);
      },
      read: () => (state ? structuredClone(state) : null),
      write: async (next) => {
        if (options.asyncWrites) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await options.writeGate?.();
        state = structuredClone(next);
      },
      appendEvent: (event) => {
        if (options.throwAppendEvent) throw new Error("append failed");
        const duplicate = events.some((candidate) => candidate.id === event.id);
        if (!duplicate) {
          events.push(structuredClone(event));
          if (event.status && state) {
            state = {
              ...state,
              participants: state.participants.map((participant) =>
                participant.participantId === event.participantId
                  ? { ...participant, status: event.status! }
                  : participant,
              ),
            };
          }
        }
        return {
          accepted: true,
          deduplicated: duplicate,
          state: state ? structuredClone(state) : undefined,
        };
      },
    },
  });
  return { alpha, beta, coordinator, events, getState: () => state };
}

describe("MultiFrontierCoordinator", () => {
  it("requires exactly two distinct participants", () => {
    const alpha = new FakeParticipant("alpha");
    expect(
      () =>
        new MultiFrontierCoordinator({
          collaborationId: "collaboration-1",
          participants: [alpha, alpha],
          store: {} as never,
        }),
    ).toThrow("exactly two distinct participants");

    const beta = new FakeParticipant("beta");
    Object.defineProperty(beta, "provider", { value: "codex" });
    Object.defineProperty(beta, "runtime", { value: "codex-cli" });
    expect(
      () =>
        new MultiFrontierCoordinator({
          collaborationId: "collaboration-2",
          participants: [new FakeParticipant("alpha"), beta],
          store: {} as never,
        }),
    ).toThrow("exactly two distinct participants");
  });

  it("starts both participants read-only and does not grant writing before GO", async () => {
    const { alpha, beta, coordinator } = createHarness();

    await coordinator.begin();
    await coordinator.runTurn({
      participantId: "alpha",
      turnId: "plan-1",
      kind: "proposal",
      instruction: "Compare the implementation options.",
    });

    expect(alpha.starts).toEqual([
      { collaborationId: "collaboration-1", permission: "read_only", round: 1 },
    ]);
    expect(beta.starts).toEqual(alpha.starts);
    expect(alpha.turns).toMatchObject([
      { permission: "read_only", phase: "proposing" },
    ]);
    expect(coordinator.state?.participants[0]).toMatchObject({
      provider: "codex",
      runtime: "codex-cli",
      model: "test-model",
      capabilities: ["read", "review"],
      sessionRef: "session-test",
    });
    expect(coordinator.state?.autoContinueAfterAgreement).toBe(false);
    const automatic = createHarness({ autoContinueAfterAgreement: true });
    await automatic.coordinator.begin();
    expect(automatic.coordinator.state?.autoContinueAfterAgreement).toBe(true);
    await expect(
      coordinator.runTurn({
        participantId: "alpha",
        turnId: "write-1",
        kind: "implementation",
        instruction: "Make the change.",
      }),
    ).rejects.toThrow("current explicit driver lease");
  });

  it("requires a pending explicit GO and a matching generation for workspace writes", async () => {
    const { alpha, beta, coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.requestGo();
    const lease = await coordinator.approveGo("alpha");

    expect(lease).toEqual({
      participantId: "alpha",
      generation: 1,
      leaseState: "active",
    });
    await expect(
      coordinator.runTurn({
        participantId: "alpha",
        turnId: "write-stale",
        kind: "implementation",
        generation: 0,
        instruction: "Make the change.",
      }),
    ).rejects.toThrow("current explicit driver lease");

    await coordinator.runTurn({
      participantId: "alpha",
      turnId: "write-1",
      kind: "implementation",
      generation: lease.generation,
      instruction: "Make the change.",
    });

    expect(alpha.turns.at(-1)).toMatchObject({
      permission: "workspace_write",
      generation: 1,
      phase: "implementing",
    });
    expect(beta.turns).toEqual([]);
    expect(coordinator.state).toMatchObject({
      participants: [
        {
          participantId: "alpha",
          role: "driver",
          permission: "workspace_write",
        },
        { participantId: "beta", role: "watchdog", permission: "read_only" },
      ],
    });
  });

  it("keeps proposal, cross-review, and convergence turns read-only", async () => {
    const { alpha, beta, coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.beginCrossReview();
    await coordinator.runTurn({
      participantId: "beta",
      turnId: "review-1",
      kind: "cross_review",
      instruction: "Review the proposal.",
    });
    await coordinator.beginConvergence();

    expect(beta.turns).toMatchObject([
      { permission: "read_only", phase: "cross_review" },
    ]);
    expect(coordinator.state).toMatchObject({
      phase: "converging",
      driver: null,
      participants: [{ permission: "read_only" }, { permission: "read_only" }],
    });
    expect(alpha.turns).toEqual([]);
  });

  it("rejects stale write events before the parent store is mutated", async () => {
    const { coordinator, events, getState } = createHarness();
    await coordinator.begin();
    await coordinator.requestGo();
    await coordinator.approveGo("alpha");
    const before = structuredClone(getState());

    const result = await coordinator.ingestEvent({
      id: "stale-progress",
      participantId: "alpha",
      permission: "workspace_write",
      generation: 0,
      kind: "progress",
    });

    expect(result).toEqual({ accepted: false, reason: "stale-generation" });
    expect(events).toEqual([]);
    expect(getState()).toEqual(before);
  });

  it("bounds, idempotently ingests, and persists only stable participant event ids", async () => {
    const { coordinator, events } = createHarness({ maxEventBytes: 256 });
    await coordinator.begin();
    const event = {
      id: "read-progress-1",
      participantId: "beta",
      permission: "read_only" as const,
      kind: "progress" as const,
    };

    await expect(coordinator.ingestEvent(event)).resolves.toEqual({
      accepted: true,
      deduplicated: false,
    });
    await expect(coordinator.ingestEvent(event)).resolves.toEqual({
      accepted: true,
      deduplicated: true,
    });
    await expect(
      coordinator.ingestEvent({
        ...event,
        id: "large-progress",
        payload: "x".repeat(512),
      }),
    ).resolves.toEqual({ accepted: false, reason: "oversized-event" });

    expect(events).toHaveLength(1);
  });

  it("serializes concurrent participant state updates without losing either status", async () => {
    const { coordinator } = createHarness({ asyncWrites: true });
    await coordinator.begin();

    await Promise.all([
      coordinator.ingestEvent({
        id: "alpha-complete",
        participantId: "alpha",
        permission: "read_only",
        kind: "status",
        status: "completed",
      }),
      coordinator.ingestEvent({
        id: "beta-complete",
        participantId: "beta",
        permission: "read_only",
        kind: "status",
        status: "completed",
      }),
    ]);

    expect(coordinator.state?.participants).toMatchObject([
      { participantId: "alpha", status: "completed" },
      { participantId: "beta", status: "completed" },
    ]);
  });

  it("does not grant a second simultaneous implementation turn to the driver", async () => {
    const { alpha, coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.requestGo();
    const lease = await coordinator.approveGo("alpha");

    const first = coordinator.runTurn({
      participantId: "alpha",
      turnId: "write-first",
      kind: "implementation",
      generation: lease.generation,
      instruction: "Make the change.",
    });
    await expect(
      coordinator.runTurn({
        participantId: "alpha",
        turnId: "write-second",
        kind: "implementation",
        generation: lease.generation,
        instruction: "Make another change.",
      }),
    ).rejects.toThrow("already has an active turn");
    await first;

    expect(alpha.turns).toHaveLength(1);
  });

  it("fences a reserved turn when cancellation begins during its durable start", async () => {
    const writeEntered = deferred();
    const releaseWrite = deferred();
    let blockWrites = false;
    const { alpha, coordinator } = createHarness({
      writeGate: async () => {
        if (!blockWrites) return;
        writeEntered.resolve();
        await releaseWrite.promise;
      },
    });
    await coordinator.begin();
    await coordinator.requestGo();
    const lease = await coordinator.approveGo("alpha");
    blockWrites = true;
    const turn = coordinator.runTurn({
      participantId: "alpha",
      turnId: "cancel-before-start",
      kind: "implementation",
      generation: lease.generation,
      instruction: "Do not start after cancellation.",
    });
    await writeEntered.promise;
    const cancellation = coordinator.cancel();
    releaseWrite.resolve();

    await expect(turn).rejects.toThrow("not accepting new turns");
    await cancellation;
    expect(alpha.turns).toEqual([]);
    expect(coordinator.state?.phase).toBe("canceled");
  });

  it("rejects checkpoint and completion while an implementation turn is active", async () => {
    const turnGate = deferred();
    const { alpha, coordinator } = createHarness();
    alpha.runTurnGate = turnGate.promise;
    await coordinator.begin();
    await coordinator.requestGo();
    const lease = await coordinator.approveGo("alpha");
    const turn = coordinator.runTurn({
      participantId: "alpha",
      turnId: "active-implementation",
      kind: "implementation",
      generation: lease.generation,
      instruction: "Keep the driver active.",
    });
    await viWaitFor(() => alpha.turns.length === 1);

    await expect(coordinator.checkpoint("checkpoint-active")).rejects.toThrow(
      "stable turn boundary",
    );
    await expect(coordinator.complete()).rejects.toThrow(
      "stable turn boundary",
    );
    turnGate.resolve();
    await turn;
  });

  it("waits for an owned runner before persisting cancellation", async () => {
    const turnGate = deferred();
    const { alpha, coordinator } = createHarness();
    alpha.runTurnGate = turnGate.promise;
    await coordinator.begin();
    const turn = coordinator.runTurn({
      participantId: "alpha",
      turnId: "cancel-running",
      kind: "proposal",
      instruction: "Remain active.",
    });
    await viWaitFor(() => alpha.turns.length === 1);
    const cancellation = coordinator.cancel();
    await Promise.resolve();
    expect(coordinator.state?.phase).toBe("proposing");
    turnGate.resolve();
    await turn;
    await cancellation;
    expect(coordinator.state?.phase).toBe("canceled");
  });

  it("pauses active children at a safe user boundary", async () => {
    const turnGate = deferred();
    const { alpha, coordinator } = createHarness();
    alpha.runTurnGate = turnGate.promise;
    await coordinator.begin();
    const turn = coordinator.runTurn({
      participantId: "alpha",
      turnId: "pause-running",
      kind: "proposal",
      instruction: "Pause this turn.",
    });
    await viWaitFor(() => alpha.turns.length === 1);
    const pause = coordinator.pause();
    turnGate.resolve();
    await turn;
    await pause;
    expect(coordinator.state).toMatchObject({
      phase: "paused",
      recovery: { reason: "canceled", resumablePhase: "proposing" },
    });
  });

  it("pauses and revokes the lease on crash or cancellation, then resumes without replay", async () => {
    const { alpha, beta, coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.requestGo();
    const lease = await coordinator.approveGo("alpha");
    await coordinator.ingestEvent({
      id: "driver-crashed",
      participantId: "alpha",
      permission: "workspace_write",
      generation: lease.generation,
      kind: "crash",
    });

    expect(coordinator.state).toMatchObject({
      phase: "paused",
      driver: { leaseState: "revoked" },
      recovery: { reason: "driver_crashed", resumablePhase: "implementing" },
      participants: [
        { permission: "read_only", status: "failed" },
        { permission: "read_only" },
      ],
    });
    await coordinator.resume();
    expect(alpha.turns).toEqual([]);
    expect(beta.turns).toEqual([]);
    expect(coordinator.state).toMatchObject({
      phase: "awaiting_go",
      approval: "pending",
    });

    await coordinator.cancel();
    expect(alpha.cancelCount).toBe(1);
    expect(beta.cancelCount).toBe(1);
    expect(coordinator.state).toMatchObject({
      phase: "canceled",
      driver: { leaseState: "revoked" },
    });
  });

  it("fails closed when a persisted participant id resolves to another runtime", async () => {
    const { alpha, coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.requestGo();
    const lease = await coordinator.approveGo("alpha");
    await coordinator.ingestEvent({
      id: "alpha-crashed-for-runtime-check",
      participantId: "alpha",
      permission: "workspace_write",
      generation: lease.generation,
      kind: "crash",
    });
    Object.defineProperty(alpha, "provider", { value: "other-provider" });

    await expect(coordinator.resume()).rejects.toThrow(
      "runtime identity does not match",
    );

    const runtimeMismatch = createHarness();
    await runtimeMismatch.coordinator.begin();
    await runtimeMismatch.coordinator.requestGo();
    const runtimeLease = await runtimeMismatch.coordinator.approveGo("alpha");
    await runtimeMismatch.coordinator.ingestEvent({
      id: "alpha-crashed-for-runtime-name-check",
      participantId: "alpha",
      permission: "workspace_write",
      generation: runtimeLease.generation,
      kind: "crash",
    });
    Object.defineProperty(runtimeMismatch.alpha, "runtime", {
      value: "other-runtime",
    });

    await expect(runtimeMismatch.coordinator.resume()).rejects.toThrow(
      "runtime identity does not match",
    );
  });

  it("revokes the driver at a checkpoint boundary before a new GO", async () => {
    const { coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.requestGo();
    await coordinator.approveGo("alpha");

    await coordinator.checkpoint("checkpoint-1");

    expect(coordinator.state).toMatchObject({
      phase: "checkpoint_review",
      approval: "pending",
      checkpointIds: ["checkpoint-1"],
      driver: { leaseState: "revoked" },
      participants: [{ permission: "read_only" }, { permission: "read_only" }],
    });
  });

  it("only allows each read-only turn kind at its named phase", async () => {
    const { coordinator } = createHarness();
    await coordinator.begin();
    await expect(
      coordinator.runTurn({
        participantId: "beta",
        turnId: "review-too-early",
        kind: "cross_review",
        instruction: "Review.",
      }),
    ).rejects.toThrow("cross_review turns are only allowed");
    await coordinator.requestGo();
    await coordinator.approveGo("alpha");
    await expect(
      coordinator.runTurn({
        participantId: "beta",
        turnId: "watch-moving-worktree",
        kind: "checkpoint_review",
        instruction: "Inspect while writing.",
      }),
    ).rejects.toThrow("checkpoint_review turns are only allowed");
  });

  it("bounds turn instructions by UTF-8 bytes", async () => {
    const { coordinator } = createHarness();
    await coordinator.begin();
    await expect(
      coordinator.runTurn({
        participantId: "alpha",
        turnId: "oversized-instruction",
        kind: "proposal",
        instruction: "界".repeat(4_097),
      }),
    ).rejects.toThrow("exceeds the allowed size");
  });

  it("enforces the default three-round limit", async () => {
    const { coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.beginCrossReview();
    await coordinator.beginNextRound();
    await coordinator.beginCrossReview();
    await coordinator.beginNextRound();
    await coordinator.beginCrossReview();

    await expect(coordinator.beginNextRound()).rejects.toThrow(
      "limited to 3 rounds",
    );
  });

  it("has terminal completion, failure, and cancellation states that cannot resume", async () => {
    const completed = createHarness();
    await completed.coordinator.begin();
    await completed.coordinator.complete();
    expect(completed.coordinator.state).toMatchObject({
      phase: "completed",
      driver: null,
      participants: [
        { permission: "read_only", status: "completed" },
        { permission: "read_only", status: "completed" },
      ],
    });
    await expect(completed.coordinator.resume()).rejects.toThrow(
      "Only a paused collaboration",
    );
    await expect(completed.coordinator.cancel()).rejects.toThrow(
      "terminal collaboration",
    );

    const failed = createHarness();
    await failed.coordinator.begin();
    await failed.coordinator.fail();
    expect(failed.coordinator.state).toMatchObject({ phase: "failed" });

    const canceled = createHarness();
    await canceled.coordinator.begin();
    await canceled.coordinator.cancel();
    expect(canceled.coordinator.state).toMatchObject({ phase: "canceled" });
  });

  it("handles asynchronous participant event failures without an unhandled rejection", async () => {
    const errors: unknown[] = [];
    const { beta, coordinator } = createHarness({
      throwAppendEvent: true,
      onEventIngestionError: ({ error }) => errors.push(error),
    });
    await coordinator.begin();
    beta.emit({
      id: "event-store-failure",
      participantId: "beta",
      permission: "read_only",
      kind: "progress",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toHaveLength(1);
    expect(coordinator.state).toMatchObject({
      phase: "paused",
      recovery: { reason: "watchdog_crashed" },
    });
  });

  it("consumes status state returned by the event append without clobbering it", async () => {
    const { alpha, coordinator } = createHarness();
    alpha.emitStatusOnRun = "completed";
    await coordinator.begin();
    await coordinator.runTurn({
      participantId: "alpha",
      turnId: "start-status",
      kind: "proposal",
      instruction: "Emit a terminal status at start.",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(coordinator.state?.participants[0]).toMatchObject({
      participantId: "alpha",
      status: "completed",
    });
  });

  it("rejects double resume and cannot resurrect during dispose", async () => {
    const resumeGate = deferred();
    const { alpha, beta, coordinator } = createHarness();
    await coordinator.begin();
    await coordinator.pause();
    alpha.resumeGate = resumeGate.promise;
    beta.resumeGate = resumeGate.promise;

    const resume = coordinator.resume();
    expect(() => coordinator.resume()).toThrow("already resuming");
    const dispose = coordinator.dispose();
    resumeGate.resolve();

    await expect(resume).rejects.toThrow("stopped while resuming");
    await dispose;
    expect(coordinator.state?.phase).toBe("paused");
    await expect(
      coordinator.runTurn({
        participantId: "alpha",
        turnId: "after-dispose",
        kind: "proposal",
        instruction: "Must remain fenced.",
      }),
    ).rejects.toThrow("disposed");
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function viWaitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for the deterministic test condition.");
}
