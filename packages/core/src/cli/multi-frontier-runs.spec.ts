import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  activateStoredMultiFrontierDriver,
  appendMultiFrontierArtifact,
  appendMultiFrontierParticipantEvent,
  canApplyMultiFrontierParticipantEvent,
  compactMultiFrontierParticipantEvents,
  createMultiFrontierRun,
  getMultiFrontierArtifact,
  getMultiFrontierParticipantEventRetention,
  getMultiFrontierRun,
  listMultiFrontierArtifacts,
  listMultiFrontierParticipantEvents,
  MAX_MULTI_FRONTIER_ARTIFACTS_PER_RUN,
  multiFrontierArtifactsDir,
  multiFrontierRunsStoreRoot,
  reactivateStoredMultiFrontierDriver,
  recoverStoredMultiFrontierRun,
  transitionStoredMultiFrontierRun,
} from "./multi-frontier-runs.js";

const tempRoots: string[] = [];

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("multi-frontier run store", () => {
  it("persists compound state under the existing Code Agent store", () => {
    const root = useTempCodeAgentsHome();
    const run = createMultiFrontierRun({
      collaborationId: "compound-1",
      phase: "implementing",
      approval: { state: "approved" },
      participants: [
        {
          participantId: "codex",
          provider: "openai",
          runtime: "codex",
          model: "gpt-5.6",
          capabilities: ["workspace_write"],
          sessionRef: "session-codex-1",
          role: "driver",
          permission: "workspace_write",
          status: "running",
        },
        {
          participantId: "claude",
          provider: "anthropic",
          runtime: "claude",
          role: "watchdog",
          permission: "read_only",
          status: "running",
        },
      ],
      checkpointIds: ["checkpoint-1"],
    });

    expect(multiFrontierRunsStoreRoot()).toBe(
      path.join(root, "multi-frontier"),
    );
    expect(getMultiFrontierRun(run.collaborationId)).toMatchObject({
      schemaVersion: 1,
      collaborationId: "compound-1",
      phase: "implementing",
      checkpointIds: ["checkpoint-1"],
      round: 1,
      proposalIds: [],
      reviewIds: [],
      participants: [
        {
          participantId: "codex",
          provider: "openai",
          runtime: "codex",
          model: "gpt-5.6",
          capabilities: ["workspace_write"],
          sessionRef: "session-codex-1",
          role: "watchdog",
          permission: "read_only",
        },
        {
          participantId: "claude",
          provider: "anthropic",
          runtime: "claude",
          role: "watchdog",
          permission: "read_only",
        },
      ],
    });
  });

  it("revokes on recovery and only accepts the reactivated driver generation", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const recovered = recoverStoredMultiFrontierRun(run.collaborationId, {
      now: "2026-07-19T16:00:00.000Z",
      reason: "main_process_restarted",
    });
    expect(recovered).toMatchObject({
      phase: "paused",
      driver: { participantId: "codex", generation: 1, leaseState: "revoked" },
      participants: [
        {
          participantId: "codex",
          role: "watchdog",
          permission: "read_only",
          status: "waiting",
        },
        {
          participantId: "claude",
          role: "watchdog",
          permission: "read_only",
          status: "waiting",
        },
      ],
      recovery: {
        resumablePhase: "implementing",
        checkpointId: "checkpoint-1",
      },
    });
    const reactivated = reactivateStoredMultiFrontierDriver(
      run.collaborationId,
      "codex",
      "2026-07-19T16:00:01.000Z",
    );
    expect(reactivated).toMatchObject({
      phase: "implementing",
      driver: { participantId: "codex", generation: 2, leaseState: "active" },
      recovery: undefined,
    });
    expect(
      canApplyMultiFrontierParticipantEvent(reactivated!, {
        participantId: "codex",
        generation: 1,
        permission: "workspace_write",
      }),
    ).toBe(false);
  });

  it("serializes coordinator transitions without losing independent participant updates", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const codexTransition = transitionStoredMultiFrontierRun(
      run.collaborationId,
      "2026-07-19T16:00:00.000Z",
      (current) => {
        const {
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...state
        } = current;
        return {
          ...state,
          participants: state.participants.map((participant) =>
            participant.participantId === "codex"
              ? {
                  ...participant,
                  sessionRef: "session-codex-2",
                  status: "waiting",
                }
              : participant,
          ),
        };
      },
    );
    const claudeTransition = transitionStoredMultiFrontierRun(
      run.collaborationId,
      "2026-07-19T16:00:01.000Z",
      (current) => ({
        ...current,
        participants: current.participants.map((participant) =>
          participant.participantId === "claude"
            ? {
                ...participant,
                sessionRef: "session-claude-1",
                status: "completed",
              }
            : participant,
        ),
      }),
    );

    expect(codexTransition?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: "codex",
          sessionRef: "session-codex-2",
          status: "waiting",
        }),
      ]),
    );
    expect(claudeTransition?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          participantId: "codex",
          sessionRef: "session-codex-2",
          status: "waiting",
        }),
        expect.objectContaining({
          participantId: "claude",
          sessionRef: "session-claude-1",
          status: "completed",
        }),
      ]),
    );
  });

  it("rejects an invalid coordinator dual-writer transition without mutating disk", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const before = getMultiFrontierRun(run.collaborationId);

    expect(() =>
      transitionStoredMultiFrontierRun(
        run.collaborationId,
        "2026-07-19T16:00:00.000Z",
        (current) => ({
          ...current,
          participants: current.participants.map((participant) => ({
            ...participant,
            permission: "workspace_write",
          })),
        }),
      ),
    ).toThrow("Invalid multi-frontier coordinator transition state.");
    expect(getMultiFrontierRun(run.collaborationId)).toEqual(before);
  });

  it("rejects coordinator attempts to change durable run identity", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const before = getMultiFrontierRun(run.collaborationId);

    expect(() =>
      transitionStoredMultiFrontierRun(
        run.collaborationId,
        "2026-07-19T16:00:00.000Z",
        (current) => ({ ...current, collaborationId: "other-run" }),
      ),
    ).toThrow("cannot change run identity");
    expect(() =>
      transitionStoredMultiFrontierRun(
        run.collaborationId,
        "2026-07-19T16:00:01.000Z",
        (current) => ({ ...current, createdAt: "2026-07-01T00:00:00.000Z" }),
      ),
    ).toThrow("cannot change creation time");
    expect(getMultiFrontierRun(run.collaborationId)).toEqual(before);
  });

  it("retains artifact references for state-shaped coordinator transitions", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    appendMultiFrontierArtifact({
      id: "proposal-transition",
      collaborationId: run.collaborationId,
      kind: "proposal",
      title: "Proposal",
      summary: "A bounded durable proposal.",
    });
    appendMultiFrontierArtifact({
      id: "review-transition",
      collaborationId: run.collaborationId,
      kind: "review",
      title: "Review",
      summary: "A bounded durable review.",
    });

    const transitioned = transitionStoredMultiFrontierRun(
      run.collaborationId,
      "2026-07-19T16:00:00.000Z",
      (current) => {
        const {
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...state
        } = current;
        return {
          ...state,
          proposalIds: [],
          reviewIds: [],
          phase: "checkpoint_review",
        };
      },
    );

    expect(transitioned).toMatchObject({
      proposalIds: ["proposal-transition"],
      reviewIds: ["review-transition"],
      phase: "checkpoint_review",
    });
  });

  it("returns null without writing when a coordinator transition has no run", () => {
    useTempCodeAgentsHome();
    expect(
      transitionStoredMultiFrontierRun(
        "missing-run",
        "2026-07-19T16:00:00.000Z",
        (current) => current,
      ),
    ).toBeNull();
    expect(getMultiFrontierRun("missing-run")).toBeNull();
  });

  it("deduplicates stable participant events after fencing the driver", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const stale = appendMultiFrontierParticipantEvent({
      id: "stale-event",
      collaborationId: run.collaborationId,
      participantId: "codex",
      generation: 0,
      permission: "workspace_write",
      status: "completed",
      createdAt: "2026-07-19T16:00:00.000Z",
    });
    expect(stale).toMatchObject({ accepted: false, reason: "stale-driver" });

    const accepted = appendMultiFrontierParticipantEvent({
      id: "driver-event",
      collaborationId: run.collaborationId,
      participantId: "codex",
      generation: 1,
      permission: "workspace_write",
      status: "completed",
      createdAt: "2026-07-19T16:00:01.000Z",
    });
    expect(accepted).toMatchObject({ accepted: true, deduplicated: false });
    expect(
      appendMultiFrontierParticipantEvent({
        id: "driver-event",
        collaborationId: run.collaborationId,
        participantId: "codex",
        generation: 1,
        permission: "workspace_write",
        status: "completed",
      }),
    ).toMatchObject({ accepted: true, deduplicated: true });
    expect(
      appendMultiFrontierParticipantEvent({
        id: "driver-event",
        collaborationId: run.collaborationId,
        participantId: "claude",
        permission: "read_only",
        status: "completed",
      }),
    ).toMatchObject({ accepted: false, reason: "event-conflict" });
    expect(
      appendMultiFrontierParticipantEvent({
        id: "driver-regression",
        collaborationId: run.collaborationId,
        participantId: "codex",
        generation: 1,
        permission: "workspace_write",
        status: "running",
      }),
    ).toMatchObject({ accepted: false, reason: "terminal-participant" });
    expect(
      listMultiFrontierParticipantEvents(run.collaborationId),
    ).toHaveLength(1);
    expect(() =>
      appendMultiFrontierParticipantEvent({
        id: "bad-timestamp",
        collaborationId: run.collaborationId,
        participantId: "claude",
        permission: "read_only",
        createdAt: "not-a-timestamp",
      }),
    ).toThrow("Invalid multi-frontier event time.");
  });

  it("rejects duplicate collaboration ids instead of overwriting state", () => {
    useTempCodeAgentsHome();
    createMultiFrontierRun({
      collaborationId: "no-overwrite",
      participants: [
        {
          participantId: "codex",
          provider: "openai",
          runtime: "codex",
          role: "watchdog",
          permission: "read_only",
          status: "idle",
        },
      ],
    });
    expect(() =>
      createMultiFrontierRun({
        collaborationId: "no-overwrite",
        participants: [
          {
            participantId: "claude",
            provider: "anthropic",
            runtime: "claude",
            role: "watchdog",
            permission: "read_only",
            status: "idle",
          },
        ],
      }),
    ).toThrow("Multi-frontier run already exists: no-overwrite");
  });

  it("persists bounded append-only coordinator artifacts with safe references", () => {
    const root = useTempCodeAgentsHome();
    const run = createActiveRun();
    const proposal = appendMultiFrontierArtifact({
      id: "proposal-1",
      collaborationId: run.collaborationId,
      kind: "proposal",
      participantId: "claude",
      title: "Use a single coordinator",
      summary: "The desktop main process owns durable run-state mutations.",
      contentHash: "a".repeat(64),
      fileRefs: ["packages/core/src/cli/multi-frontier-runs.ts"],
      testSummary: [
        {
          name: "multi-frontier store",
          status: "passed",
          summary: "Recovers into read-only paused state.",
        },
      ],
      createdAt: "2026-07-19T16:00:00.000Z",
    });
    expect(proposal).toMatchObject({ accepted: true, deduplicated: false });
    expect(getMultiFrontierArtifact(run.collaborationId, "proposal-1")).toEqual(
      expect.objectContaining({
        kind: "proposal",
        fileRefs: ["packages/core/src/cli/multi-frontier-runs.ts"],
      }),
    );
    expect(getMultiFrontierRun(run.collaborationId)?.proposalIds).toEqual([
      "proposal-1",
    ]);
    expect(
      fs.statSync(
        path.join(
          root,
          "multi-frontier",
          "artifacts",
          run.collaborationId,
          "proposal-1.json",
        ),
      ).mode & 0o777,
    ).toBe(0o600);

    expect(
      appendMultiFrontierArtifact({
        id: "review-1",
        collaborationId: run.collaborationId,
        kind: "review",
        title: "Review retention",
        summary: "The event journal exposes a snapshot-required replay marker.",
        supersedesArtifactId: "proposal-1",
      }),
    ).toMatchObject({ accepted: true, deduplicated: false });
    expect(
      listMultiFrontierArtifacts(run.collaborationId).map(
        (artifact) => artifact.id,
      ),
    ).toEqual(["proposal-1", "review-1"]);

    expect(
      appendMultiFrontierArtifact({
        id: "proposal-1",
        collaborationId: run.collaborationId,
        kind: "proposal",
        participantId: "claude",
        title: "Use a single coordinator",
        summary: "The desktop main process owns durable run-state mutations.",
        contentHash: "a".repeat(64),
        fileRefs: ["packages/core/src/cli/multi-frontier-runs.ts"],
        testSummary: [
          {
            name: "multi-frontier store",
            status: "passed",
            summary: "Recovers into read-only paused state.",
          },
        ],
        createdAt: "2026-07-19T16:00:00.000Z",
      }),
    ).toMatchObject({ accepted: true, deduplicated: true });
  });

  it("rejects unbounded or provider-payload artifact fields without changing state", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    expect(() =>
      appendMultiFrontierArtifact({
        id: "bad-payload",
        collaborationId: run.collaborationId,
        kind: "proposal",
        title: "Payload",
        summary: "A summary.",
        payload: { accessToken: "example-token" },
      } as never),
    ).toThrow("allowlisted summary fields");
    expect(() =>
      appendMultiFrontierArtifact({
        id: "bad-diff",
        collaborationId: run.collaborationId,
        kind: "proposal",
        title: "Diff",
        summary: "diff --git a/private.txt b/private.txt\n+secret",
      }),
    ).toThrow("artifact summary");
    expect(() =>
      appendMultiFrontierArtifact({
        id: "bad-file-ref",
        collaborationId: run.collaborationId,
        kind: "review",
        title: "Review",
        summary: "A bounded review.",
        fileRefs: ["../../.codex/auth.json"],
      }),
    ).toThrow("file references");
    expect(
      appendMultiFrontierArtifact({
        id: "dangling-supersession",
        collaborationId: run.collaborationId,
        kind: "review",
        title: "Review",
        summary: "A bounded review.",
        supersedesArtifactId: "not-present",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "missing-superseded-artifact",
    });
    expect(getMultiFrontierRun(run.collaborationId)?.proposalIds).toEqual([]);
    expect(listMultiFrontierArtifacts(run.collaborationId)).toEqual([]);
  });

  it("repairs a matching artifact reference after a crash between artifact and run writes", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const artifact = {
      schemaVersion: 1,
      id: "orphaned-proposal",
      collaborationId: run.collaborationId,
      kind: "proposal" as const,
      createdAt: "2026-07-19T16:00:00.000Z",
      title: "Recovered proposal",
      summary: "This record was written before the run reference.",
    };
    const artifactPath = path.join(
      multiFrontierArtifactsDir(),
      run.collaborationId,
      `${artifact.id}.json`,
    );
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, JSON.stringify(artifact));

    const { schemaVersion: _schemaVersion, ...input } = artifact;
    expect(appendMultiFrontierArtifact(input)).toMatchObject({
      accepted: true,
      deduplicated: true,
      run: { proposalIds: [artifact.id] },
    });
    expect(getMultiFrontierRun(run.collaborationId)?.proposalIds).toEqual([
      artifact.id,
    ]);
  });

  it("compacts participant events into a replay-marked bounded tail", () => {
    const root = useTempCodeAgentsHome();
    const run = createActiveRun();
    for (const id of ["event-1", "event-2", "event-3", "event-4"]) {
      expect(
        appendMultiFrontierParticipantEvent({
          id,
          collaborationId: run.collaborationId,
          participantId: "claude",
          permission: "read_only",
        }),
      ).toMatchObject({ accepted: true });
    }
    const retention = compactMultiFrontierParticipantEvents(
      run.collaborationId,
      {
        maxEventCount: 2,
        maxBytes: 1_024,
      },
    );
    expect(retention).toMatchObject({
      retainedEventCount: 2,
      droppedEventCount: 2,
      truncated: true,
      replay: { requiresSnapshot: true, firstRetainedEventId: "event-3" },
    });
    expect(retention?.retainedByteCount).toBeLessThanOrEqual(1_024);
    expect(
      listMultiFrontierParticipantEvents(run.collaborationId).map(
        (event) => event.id,
      ),
    ).toEqual(["event-3", "event-4"]);
    expect(
      getMultiFrontierParticipantEventRetention(run.collaborationId),
    ).toEqual(retention);
    expect(
      fs.statSync(
        path.join(
          root,
          "multi-frontier",
          "events",
          `${run.collaborationId}.jsonl`,
        ),
      ).mode & 0o777,
    ).toBe(0o600);
    expect(
      fs.statSync(
        path.join(
          root,
          "multi-frontier",
          "events",
          `${run.collaborationId}.retention.json`,
        ),
      ).mode & 0o777,
    ).toBe(0o600);
  });

  it("uses UTF-8 serialized bytes as well as event count for journal retention", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    const eventIds = ["a", "b", "c", "d"].map(
      (suffix) => `event-${suffix.repeat(180)}`,
    );
    for (const id of eventIds) {
      appendMultiFrontierParticipantEvent({
        id,
        collaborationId: run.collaborationId,
        participantId: "claude",
        permission: "read_only",
      });
    }
    const retention = compactMultiFrontierParticipantEvents(
      run.collaborationId,
      {
        maxEventCount: 4,
        maxBytes: 1_024,
      },
    );
    expect(retention).toMatchObject({
      retainedEventCount: 3,
      droppedEventCount: 1,
      retainedByteCount: expect.any(Number),
      replay: {
        requiresSnapshot: true,
        firstRetainedEventId: eventIds[1],
      },
    });
    expect(retention?.retainedByteCount).toBeLessThanOrEqual(1_024);
  });

  it("keeps the newest contiguous tail when an oversized middle event reaches the byte cap", () => {
    useTempCodeAgentsHome();
    const participantId = `participant-${"p".repeat(170)}`;
    const run = createMultiFrontierRun({
      collaborationId: "contiguous-tail",
      phase: "implementing",
      approval: { state: "approved" },
      participants: [
        {
          participantId,
          provider: "openai",
          runtime: "codex",
          role: "driver",
          permission: "workspace_write",
          status: "running",
        },
      ],
    });
    activateStoredMultiFrontierDriver(run.collaborationId, participantId);
    const middleId = `event-${"m".repeat(180)}`;
    for (const id of ["older", middleId, "newest"]) {
      appendMultiFrontierParticipantEvent({
        id,
        collaborationId: run.collaborationId,
        participantId,
        permission: "read_only",
      });
    }
    const retention = compactMultiFrontierParticipantEvents(
      run.collaborationId,
      {
        maxEventCount: 4,
        maxBytes: 512,
      },
    );
    expect(retention).toMatchObject({
      retainedEventCount: 1,
      replay: {
        requiresSnapshot: true,
        firstRetainedEventId: "newest",
      },
    });
    expect(listMultiFrontierParticipantEvents(run.collaborationId)).toEqual([
      expect.objectContaining({ id: "newest" }),
    ]);
  });

  it("rejects new artifacts after the per-run retention cap without deleting records", () => {
    useTempCodeAgentsHome();
    const run = createActiveRun();
    for (let index = 0; index < MAX_MULTI_FRONTIER_ARTIFACTS_PER_RUN; index++) {
      expect(
        appendMultiFrontierArtifact({
          id: `proposal-${index}`,
          collaborationId: run.collaborationId,
          kind: "proposal",
          title: "Bounded proposal",
          summary: "A concise durable coordination summary.",
        }),
      ).toMatchObject({ accepted: true });
    }
    expect(
      appendMultiFrontierArtifact({
        id: "proposal-overflow",
        collaborationId: run.collaborationId,
        kind: "proposal",
        title: "Overflow proposal",
        summary: "This must not evict an active artifact.",
      }),
    ).toMatchObject({ accepted: false, reason: "artifact-limit-reached" });
    expect(listMultiFrontierArtifacts(run.collaborationId)).toHaveLength(
      MAX_MULTI_FRONTIER_ARTIFACTS_PER_RUN,
    );
    expect(
      getMultiFrontierArtifact(run.collaborationId, "proposal-0"),
    ).not.toBeNull();
  });
});

function createActiveRun() {
  const run = createMultiFrontierRun({
    collaborationId: "collaboration-1",
    phase: "implementing",
    approval: { state: "approved" },
    participants: [
      {
        participantId: "codex",
        provider: "openai",
        runtime: "codex",
        model: "gpt-5.6",
        capabilities: ["workspace_write"],
        sessionRef: "session-codex-1",
        role: "driver",
        permission: "workspace_write",
        status: "running",
      },
      {
        participantId: "claude",
        provider: "anthropic",
        runtime: "claude",
        role: "watchdog",
        permission: "read_only",
        status: "running",
      },
    ],
    checkpointIds: ["checkpoint-1"],
  });
  const activated = activateStoredMultiFrontierDriver(
    run.collaborationId,
    "codex",
    "2026-07-19T15:00:00.000Z",
  );
  if (!activated) throw new Error("Expected the initial driver activation.");
  return activated;
}

function useTempCodeAgentsHome(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-agent-runs-"));
  tempRoots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
  return root;
}
