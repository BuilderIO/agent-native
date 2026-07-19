import { describe, expect, it, vi } from "vitest";

import type { MultiFrontierStoredRun } from "../../../core/src/cli/multi-frontier-runs.js";
import type { LocalFrontierCoordinatorState } from "./multi-frontier-coordinator.js";
import {
  ClaudeLocalFrontierParticipant,
  CodexLocalFrontierParticipant,
  CoreMultiFrontierCoordinatorStore,
  pauseRecoveredMultiFrontierRuns,
  persistMultiFrontierParticipantSessionRef,
} from "./multi-frontier-runtime.js";

function run(
  overrides: Partial<MultiFrontierStoredRun> = {},
): MultiFrontierStoredRun {
  return {
    schemaVersion: 1,
    collaborationId: "collaboration-1",
    phase: "proposing",
    participants: [
      {
        participantId: "codex",
        provider: "codex",
        runtime: "codex-cli",
        role: "watchdog",
        permission: "read_only",
        status: "waiting",
      },
      {
        participantId: "claude",
        provider: "claude",
        runtime: "claude-code",
        role: "watchdog",
        permission: "read_only",
        status: "waiting",
      },
    ],
    driver: null,
    approval: {
      state: "not_required",
      proposalId: "proposal-1",
      reviewPacketId: "review-1",
    },
    checkpointIds: ["checkpoint-1"],
    round: 1,
    proposalIds: ["proposal-1"],
    reviewIds: ["review-1"],
    autoContinueAfterAgreement: false,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function createCore(initial: MultiFrontierStoredRun) {
  let stored = structuredClone(initial);
  const calls = { recover: 0, transition: 0, append: 0 };
  const core = {
    createMultiFrontierRun: vi.fn((input: unknown) => {
      if (stored) throw new Error("already exists");
      stored = input as MultiFrontierStoredRun;
      return stored;
    }),
    getMultiFrontierRun: vi.fn(() => structuredClone(stored)),
    listMultiFrontierRuns: vi.fn(() => [structuredClone(stored)]),
    transitionStoredMultiFrontierRun: vi.fn(
      (
        _id: string,
        now: string,
        transition: (current: MultiFrontierStoredRun) => MultiFrontierStoredRun,
      ) => {
        calls.transition += 1;
        const next = transition(structuredClone(stored));
        stored = { ...next, createdAt: stored.createdAt, updatedAt: now };
        return structuredClone(stored);
      },
    ),
    appendMultiFrontierParticipantEvent: vi.fn(() => {
      calls.append += 1;
      return { accepted: true, deduplicated: false };
    }),
    recoverStoredMultiFrontierRun: vi.fn(
      (_id: string, input: { now: string; reason: string }) => {
        calls.recover += 1;
        stored = {
          ...stored,
          phase: "paused",
          recovery: {
            reason: input.reason as "main_process_restarted",
            recoveredAt: input.now,
            resumablePhase: stored.phase,
          },
        };
        return structuredClone(stored);
      },
    ),
  };
  return {
    core,
    calls,
    get stored() {
      return stored;
    },
  };
}

describe("multi-frontier runtime", () => {
  it("preserves durable artifact references, recovery metadata, and a newer session through stale coordinator writes", () => {
    const fake = createCore(
      run({
        phase: "paused",
        participants: [
          { ...run().participants[0], sessionRef: "codex-new-session" },
          run().participants[1],
        ],
        recovery: {
          reason: "driver_crashed",
          recoveredAt: "2026-07-19T00:02:00.000Z",
          resumablePhase: "implementing",
          checkpointId: "checkpoint-1",
        },
        autoContinueAfterAgreement: true,
      }),
    );
    const store = new CoreMultiFrontierCoordinatorStore({
      core: fake.core as never,
      now: () => "2026-07-19T00:03:00.000Z",
    });
    const local = store.read("collaboration-1")!;
    const stale: LocalFrontierCoordinatorState = {
      ...local,
      participants: local.participants.map((participant) =>
        participant.participantId === "codex"
          ? { ...participant, sessionRef: undefined }
          : participant,
      ),
    };

    store.write(stale);

    expect(fake.stored).toMatchObject({
      proposalIds: ["proposal-1"],
      reviewIds: ["review-1"],
      checkpointIds: ["checkpoint-1"],
      approval: { proposalId: "proposal-1", reviewPacketId: "review-1" },
      recovery: {
        reason: "driver_crashed",
        recoveredAt: "2026-07-19T00:02:00.000Z",
        checkpointId: "checkpoint-1",
      },
      autoContinueAfterAgreement: true,
    });
    expect(fake.stored.participants[0]?.sessionRef).toBe("codex-new-session");
    expect(fake.calls.transition).toBe(1);
  });

  it("maps both providers through their core participant runners without starting sessions", async () => {
    const codexRun = vi.fn(async () => ({
      exitCode: 0,
      events: [],
      stderr: "",
      stderrTruncated: false,
      resumeSessionId: "codex-session-2",
    }));
    const claudeRun = vi.fn(async () => ({
      exitCode: 0,
      events: [],
      stderr: "",
      stderrTruncated: false,
    }));
    const capturedSessionRefs: string[] = [];
    const codex = new CodexLocalFrontierParticipant({
      participantId: "codex",
      cwd: "/tmp/workspace",
      sessionRef: "codex-session-1",
      onSessionRef: async (sessionRef) => {
        capturedSessionRefs.push(sessionRef);
      },
      run: codexRun as never,
    });
    const claude = new ClaudeLocalFrontierParticipant({
      participantId: "claude",
      cwd: "/tmp/workspace",
      session: { resumeSessionId: "claude-resume" },
      run: claudeRun as never,
    });
    const events: unknown[] = [];
    codex.onEvent((event) => events.push(event));
    await codex.start({
      collaborationId: "collaboration-1",
      permission: "read_only",
      round: 1,
    });
    await codex.resume({
      collaborationId: "collaboration-1",
      permission: "read_only",
      round: 1,
    });
    await codex.runTurn({
      collaborationId: "collaboration-1",
      turnId: "turn-read",
      round: 1,
      phase: "proposing",
      permission: "read_only",
      instruction: "Review only.",
    });
    await codex.runTurn({
      collaborationId: "collaboration-1",
      turnId: "turn-write",
      round: 1,
      phase: "implementing",
      permission: "workspace_write",
      generation: 2,
      instruction: "Implement this.",
    });
    await claude.runTurn({
      collaborationId: "collaboration-1",
      turnId: "turn-claude",
      round: 1,
      phase: "cross_review",
      permission: "read_only",
      instruction: "Review this.",
    });

    expect(codexRun).toHaveBeenCalledTimes(2);
    const codexCalls = codexRun.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const claudeCalls = claudeRun.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    expect(codexCalls[0]?.[0]).toMatchObject({
      role: "planning",
      allowWorkspaceWrite: false,
      session: { resumeSessionId: "codex-session-1" },
    });
    expect(codexCalls[1]?.[0]).toMatchObject({
      role: "driver",
      allowWorkspaceWrite: true,
      session: { resumeSessionId: "codex-session-2" },
    });
    expect(claudeCalls[0]?.[0]).toMatchObject({
      role: "watchdog",
      session: { resumeSessionId: "claude-resume" },
    });
    expect(capturedSessionRefs).toEqual(["codex-session-2", "codex-session-2"]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "status", status: "running" }),
        expect.objectContaining({ kind: "status", status: "waiting" }),
      ]),
    );
    expect(events.every((event) => !("payload" in (event as object)))).toBe(
      true,
    );
  });

  it("cancels an owned participant runner with an AbortController", async () => {
    let signal: AbortSignal | undefined;
    let settle: (() => void) | undefined;
    const participant = new CodexLocalFrontierParticipant({
      participantId: "codex",
      cwd: "/tmp/workspace",
      run: ((input: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = input.signal;
          input.signal.addEventListener(
            "abort",
            () => {
              settle = () => reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        })) as never,
    });
    const turn = participant.runTurn({
      collaborationId: "collaboration-1",
      turnId: "turn-cancel",
      round: 1,
      phase: "implementing",
      permission: "workspace_write",
      generation: 1,
      instruction: "Implement.",
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    const cancel = participant.cancel();
    let cancelSettled = false;
    void cancel.then(() => {
      cancelSettled = true;
    });
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(cancelSettled).toBe(false);
    settle?.();
    await cancel;
    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
  });

  it("persists a Codex resume id through the core transition boundary", () => {
    const fake = createCore(run());

    persistMultiFrontierParticipantSessionRef(
      "collaboration-1",
      "codex",
      "codex-session-2",
      {
        core: fake.core as never,
        now: () => "2026-07-19T00:04:00.000Z",
      },
    );

    expect(fake.stored.participants[0]?.sessionRef).toBe("codex-session-2");
    expect(fake.calls.transition).toBe(1);
  });

  it("does not expose unsupported Claude resume or live-usage capabilities", () => {
    const claude = new ClaudeLocalFrontierParticipant({
      participantId: "claude",
      cwd: "/tmp/workspace",
      run: vi.fn(async () => ({
        exitCode: 0,
        events: [],
        stderr: "",
        stderrTruncated: false,
      })) as never,
    });
    expect(claude.capabilities).toEqual([
      "login",
      "usage",
      "read-only",
      "workspace-write",
    ]);
    expect(
      () =>
        new ClaudeLocalFrontierParticipant({
          participantId: "claude-invalid",
          cwd: "/tmp/workspace",
          session: { sessionId: "new", resumeSessionId: "old" },
        }),
    ).toThrow("either a new session id or a resume id");
  });

  it("pauses only active durable work during startup recovery and never invokes a provider", () => {
    const fake = createCore(run({ phase: "implementing" }));
    const recovered = pauseRecoveredMultiFrontierRuns({
      core: fake.core as never,
      now: () => "2026-07-19T00:04:00.000Z",
    });

    expect(recovered).toHaveLength(1);
    expect(fake.calls.recover).toBe(1);
    expect(fake.stored).toMatchObject({
      phase: "paused",
      recovery: {
        reason: "main_process_restarted",
        resumablePhase: "implementing",
      },
    });
  });
});
