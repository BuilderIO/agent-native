import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  activateStoredMultiFrontierDriver,
  appendMultiFrontierParticipantEvent,
  canApplyMultiFrontierParticipantEvent,
  createMultiFrontierRun,
  getMultiFrontierRun,
  listMultiFrontierParticipantEvents,
  multiFrontierRunsStoreRoot,
  reactivateStoredMultiFrontierDriver,
  recoverStoredMultiFrontierRun,
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
        { participantId: "codex", permission: "read_only", status: "waiting" },
        { participantId: "claude", permission: "read_only", status: "waiting" },
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
