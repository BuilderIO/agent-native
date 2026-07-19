import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMultiFrontierRun,
  transitionStoredMultiFrontierRun,
} from "../../../core/src/cli/multi-frontier-runs.js";
import {
  normalizeMultiFrontierRendererState,
  type MultiFrontierCreateCollaborationRequest,
} from "../../shared/multi-frontier-ipc.js";
import type {
  LocalFrontierParticipant,
  LocalFrontierParticipantEvent,
  LocalFrontierSessionInput,
  LocalFrontierTurnInput,
} from "./multi-frontier-coordinator.js";
import { MultiFrontierManager } from "./multi-frontier-manager.js";

const roots: string[] = [];

afterEach(() => {
  delete process.env.AGENT_NATIVE_CODE_AGENTS_HOME;
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("MultiFrontierManager", () => {
  it("runs the real coordinator/orchestrator through planning, GO, implementation, and checkpoint review", async () => {
    useStore();
    const turns: LocalFrontierTurnInput[] = [];
    const manager = createManager(turns);
    const created = await manager.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;

    await manager.start(action("start", collaborationId));
    expect(getMultiFrontierRun(collaborationId)).toMatchObject({
      phase: "awaiting_go",
      approval: { state: "pending" },
    });

    await manager.go(action("go", collaborationId));
    await waitFor(() =>
      turns.some((turn) => turn.phase === "checkpoint_review"),
    );
    await waitFor(
      () => getMultiFrontierRun(collaborationId)?.phase === "completed",
    );

    expect(turns.some((turn) => turn.phase === "implementing")).toBe(true);
    expect(turns.some((turn) => turn.phase === "checkpoint_review")).toBe(true);
    expect(getMultiFrontierRun(collaborationId)).toMatchObject({
      phase: "completed",
      checkpointIds: [expect.any(String)],
    });
  });

  it("recovers artifacts through the real coordinator without replaying a turn before explicit GO", async () => {
    useStore();
    const initialTurns: LocalFrontierTurnInput[] = [];
    const initial = createManager(initialTurns);
    const created = await initial.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await initial.start(action("start", collaborationId));
    await initial.pause(action("pause", collaborationId));
    await initial.dispose();

    const recoveredTurns: LocalFrontierTurnInput[] = [];
    const recovered = createManager(recoveredTurns);
    await recovered.resume(action("resume", collaborationId));

    expect(getMultiFrontierRun(collaborationId)).toMatchObject({
      phase: "awaiting_go",
      approval: { state: "pending" },
    });
    expect(recoveredTurns).toHaveLength(0);

    await recovered.go(action("go", collaborationId));
    await waitFor(() =>
      recoveredTurns.some((turn) => turn.phase === "checkpoint_review"),
    );
    expect(recoveredTurns.some((turn) => turn.phase === "implementing")).toBe(
      true,
    );
    await waitFor(
      () => getMultiFrontierRun(collaborationId)?.phase === "completed",
    );
  });

  it("keeps auto-continue out of renderer approval affordances and pauses consequential planning findings", async () => {
    useStore();
    const turns: LocalFrontierTurnInput[] = [];
    const manager = createManager(turns, { consequential: true });
    const created = await manager.create({
      ...createRequest(),
      autoContinueAfterAgreement: true,
    });
    const collaborationId = created.snapshot!.collaborationId;
    await manager.start(action("start", collaborationId));

    expect(getMultiFrontierRun(collaborationId)).toMatchObject({
      phase: "paused",
    });
    expect(turns.some((turn) => turn.phase === "implementing")).toBe(false);

    await expect(
      manager.resume(action("resume", collaborationId)),
    ).resolves.toMatchObject({
      error: { message: expect.stringContaining("Re-enter") },
      snapshot: { phase: "paused", requiresPlanningPrompt: true },
    });
    await expect(
      manager.resume({
        ...action("resume", collaborationId),
        prompt: "Re-enter the request after reviewing the scope concern.",
      }),
    ).resolves.toMatchObject({ snapshot: { phase: "paused" } });
  });

  it("auto-continues directly into implementation without a transient GO state", async () => {
    useStore();
    const turns: LocalFrontierTurnInput[] = [];
    const manager = createManager(turns);
    const created = await manager.create({
      ...createRequest(),
      autoContinueAfterAgreement: true,
    });
    const started = await manager.start(
      action("start", created.snapshot!.collaborationId),
    );

    expect(started.snapshot).toMatchObject({
      phase: "implementing",
      approvalState: "approved",
    });
    await waitFor(() => turns.some((turn) => turn.phase === "implementing"));
    await waitFor(
      () =>
        getMultiFrontierRun(created.snapshot!.collaborationId)?.phase ===
        "completed",
    );
  });

  it("projects a revoked checkpoint lease without renderer driver authority", async () => {
    useStore();
    const turns: LocalFrontierTurnInput[] = [];
    const manager = createManager(turns, {
      snapshotTestOutput: "Checkpoint test evidence is unavailable.",
      omitImplementationTests: true,
    });
    const created = await manager.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await manager.start(action("start", collaborationId));
    await manager.go(action("go", collaborationId));
    await waitFor(
      () => getMultiFrontierRun(collaborationId)?.phase === "awaiting_go",
    );

    const [snapshot] = await manager.list();
    expect(snapshot).toMatchObject({
      collaborationId,
      phase: "awaiting_go",
      approvalState: "pending",
    });
    expect(snapshot).not.toHaveProperty("driverParticipantId");
    expect(snapshot).not.toHaveProperty("driverGeneration");
    expect(normalizeMultiFrontierRendererState(snapshot)).toEqual(snapshot);
  });

  it("does not treat workspace check prose as provider-observed test evidence", async () => {
    useStore();
    const manager = createManager([], {
      omitImplementationTests: true,
      snapshotTestOutput: "Tests 99 passed.",
    });
    const created = await manager.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await manager.start(action("start", collaborationId));
    await manager.go(action("go", collaborationId));
    await waitFor(
      () => getMultiFrontierRun(collaborationId)?.phase === "awaiting_go",
    );

    expect(getMultiFrontierRun(collaborationId)?.phase).toBe("awaiting_go");
  });

  it("hydrates a recovered session before subscription and forwards its background completion", async () => {
    useStore();
    const initial = createManager([]);
    const created = await initial.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await initial.start(action("start", collaborationId));
    await initial.pause(action("pause", collaborationId));
    await initial.dispose();

    const turns: LocalFrontierTurnInput[] = [];
    const recovered = createManager(turns);
    await recovered.list();
    const events: unknown[] = [];
    const unsubscribe = recovered.subscribe(collaborationId, (event) =>
      events.push(event),
    );
    await recovered.resume(action("resume", collaborationId));
    await recovered.go(action("go", collaborationId));
    await waitFor(
      () => getMultiFrontierRun(collaborationId)?.phase === "completed",
    );
    unsubscribe();

    expect(
      events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "snapshot" &&
          (event as { snapshot?: { phase?: unknown } }).snapshot?.phase ===
            "completed",
      ),
    ).toBe(true);
  });

  it("restores only persisted opaque session references when hydrating a run", async () => {
    useStore();
    const initial = createManager([]);
    const created = await initial.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await initial.pause(action("pause", collaborationId));
    await initial.dispose();
    transitionStoredMultiFrontierRun(
      collaborationId,
      "2026-07-19T12:00:00.000Z",
      (run) => ({
        ...run,
        participants: run.participants.map((participant) => ({
          ...participant,
          sessionRef: `resume-${participant.participantId}`,
        })),
      }),
    );

    let sessionRefs: Readonly<Record<string, string>> | undefined;
    const recovered = createManager([], {
      onParticipants: (next) => {
        sessionRefs = next;
      },
    });
    await recovered.list();

    expect(sessionRefs).toEqual({
      "codex-1": "resume-codex-1",
      "claude-1": "resume-claude-1",
    });
  });

  it("requires subscriptions again before recovering a paused collaboration", async () => {
    useStore();
    const initial = createManager([]);
    const created = await initial.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await initial.pause(action("pause", collaborationId));
    await initial.dispose();

    await expect(
      createManager([], { connected: false }).resume(
        action("resume", collaborationId),
      ),
    ).resolves.toMatchObject({
      error: { message: expect.stringContaining("subscription-native") },
    });
  });

  it("pauses an auto-continue run for consequential checkpoint findings", async () => {
    useStore();
    const turns: LocalFrontierTurnInput[] = [];
    const manager = createManager(turns, { checkpointConsequential: true });
    const created = await manager.create({
      ...createRequest(),
      autoContinueAfterAgreement: true,
    });
    await manager.start(action("start", created.snapshot!.collaborationId));
    await waitFor(
      () =>
        getMultiFrontierRun(created.snapshot!.collaborationId)?.phase ===
        "paused",
    );

    expect(turns.some((turn) => turn.phase === "implementing")).toBe(true);
    await expect(
      manager.resume(action("resume", created.snapshot!.collaborationId)),
    ).resolves.toMatchObject({
      snapshot: {
        phase: "awaiting_go",
        pendingCheckpointReviewArtifactId: expect.any(String),
      },
    });
    const [resumed] = await manager.list();
    await manager.reReview({
      schemaVersion: 1,
      requestId: "consequential-re-review",
      action: "re-review",
      collaborationId: created.snapshot!.collaborationId,
      reviewArtifactId: resumed!.pendingCheckpointReviewArtifactId!,
      instruction:
        "The user directs the driver to preserve the credential boundary and make no scope expansion.",
    });
    expect(
      turns.some(
        (turn) =>
          turn.phase === "implementing" &&
          turn.instruction.includes("preserve the credential boundary"),
      ),
    ).toBe(true);
  });

  it("dispositions the exact persisted checkpoint findings before re-reviewing", async () => {
    useStore();
    const turns: LocalFrontierTurnInput[] = [];
    const manager = createManager(turns, {
      checkpointFindings: true,
      snapshotTestOutput: "Checks completed without a recorded test event.",
    });
    const created = await manager.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await manager.start(action("start", collaborationId));
    await manager.go(action("go", collaborationId));
    await waitFor(
      () => getMultiFrontierRun(collaborationId)?.phase === "awaiting_go",
    );

    const [snapshot] = await manager.list();
    const reviewArtifactId = snapshot!.pendingCheckpointReviewArtifactId;
    expect(reviewArtifactId).toBeTruthy();
    await expect(
      manager.reReview({
        schemaVersion: 1,
        requestId: "re-review-1",
        action: "re-review",
        collaborationId,
        reviewArtifactId: reviewArtifactId!,
      }),
    ).resolves.toMatchObject({ snapshot: { collaborationId } });

    expect(
      turns.some(
        (turn) =>
          turn.phase === "implementing" &&
          turn.instruction.includes("Address, reject, or defer every finding"),
      ),
    ).toBe(true);
  });

  it("requires a bounded request before recovered planning can resume", async () => {
    useStore();
    const initial = createManager([]);
    const created = await initial.create(createRequest());
    const collaborationId = created.snapshot!.collaborationId;
    await initial.pause(action("pause", collaborationId));
    await initial.dispose();
    transitionStoredMultiFrontierRun(
      collaborationId,
      "2026-07-19T12:00:00.000Z",
      (run) => ({
        ...run,
        recovery: {
          reason: "main_process_restarted",
          recoveredAt: "2026-07-19T12:00:00.000Z",
          resumablePhase: "proposing",
        },
      }),
    );

    const recovered = createManager([]);
    await expect(
      recovered.resume(action("resume", collaborationId)),
    ).resolves.toMatchObject({
      error: { message: expect.stringContaining("Re-enter") },
      snapshot: { requiresPlanningPrompt: true },
    });
    await expect(
      recovered.resume({
        ...action("resume", collaborationId),
        prompt: "Re-entered bounded planning request.",
      }),
    ).resolves.toMatchObject({ snapshot: { phase: "awaiting_go" } });
  });

  it("admits only connected subscription participants", async () => {
    useStore();
    const manager = new MultiFrontierManager({
      resolveWorkspaceCwd: async () => "/workspace",
      isSubscriptionConnected: async () => false,
    });
    await expect(manager.create(createRequest())).resolves.toMatchObject({
      error: { message: expect.stringContaining("subscription-native") },
    });
  });
});

function createManager(
  turns: LocalFrontierTurnInput[],
  options: {
    consequential?: boolean;
    checkpointConsequential?: boolean;
    checkpointFindings?: boolean;
    connected?: boolean;
    snapshotTestOutput?: string;
    omitImplementationTests?: boolean;
    onParticipants?: (sessionRefs: Readonly<Record<string, string>>) => void;
  } = {},
): MultiFrontierManager {
  return new MultiFrontierManager({
    resolveWorkspaceCwd: async (workspaceId) =>
      workspaceId === "workspace-1" ? "/workspace" : null,
    isSubscriptionConnected: async () => options.connected ?? true,
    readRepositoryEvidence: async () => "Bounded repository evidence.",
    snapshotWorkspace: async () => ({
      contentRef: "workspace:checkpoint-1",
      contentHash: "a".repeat(64),
      testOutput: options.snapshotTestOutput ?? "Checks 1 passed.",
    }),
    createParticipants: ({ participants, sessionRefs }) => {
      options.onParticipants?.(sessionRefs);
      return [
        participant(participants[0]!, turns, options),
        participant(participants[1]!, turns, options),
      ];
    },
  });
}

function participant(
  config: MultiFrontierCreateCollaborationRequest["participants"][number],
  turns: LocalFrontierTurnInput[],
  options: {
    consequential?: boolean;
    checkpointConsequential?: boolean;
    checkpointFindings?: boolean;
    omitImplementationTests?: boolean;
  },
): LocalFrontierParticipant {
  return {
    participantId: config.participantId,
    provider: config.providerId,
    runtime: config.providerId === "codex" ? "codex-cli" : "claude-code",
    async start(_input: LocalFrontierSessionInput) {},
    async resume(_input: LocalFrontierSessionInput) {},
    async runTurn(input) {
      turns.push(input);
      if (input.phase === "cross_review") {
        return {
          text: "Cross-review complete.",
          requiresRevision: false,
          findings: options.consequential
            ? [
                {
                  id: "scope-boundary",
                  category: "intent_or_scope",
                  summary: "Scope requires human direction.",
                },
              ]
            : [],
        };
      }
      if (input.phase === "converging") {
        return {
          text: "Both plans converge on the reversible implementation.",
          agreed: true,
        };
      }
      if (input.phase === "checkpoint_review") {
        return options.checkpointConsequential
          ? {
              text: "Checkpoint review requires human direction.",
              findings: [
                {
                  id: "checkpoint-scope-boundary",
                  category: "security_or_privacy",
                  summary: "Checkpoint change needs human approval.",
                },
              ],
            }
          : options.checkpointFindings
            ? {
                text: "Checkpoint review found a reversible item.",
                findings: [
                  {
                    id: "checkpoint-format",
                    category: "reversible_technical",
                    summary: "Tighten the bounded checkpoint format.",
                  },
                ],
              }
            : { text: "Checkpoint review passed.", findings: [] };
      }
      if (
        input.phase === "implementing" &&
        input.instruction.includes("Address, reject, or defer every finding")
      ) {
        const findingId = input.instruction.match(
          /"id":"([A-Za-z0-9._-]+)"/,
        )?.[1];
        return {
          text: "Recorded the requested finding disposition.",
          dispositions: [
            {
              findingId: findingId ?? "missing-finding-id",
              disposition: "addressed",
              reason: "Resolved before the immutable re-review.",
            },
          ],
        };
      }
      if (input.phase === "implementing") {
        if (options.omitImplementationTests) {
          return { text: "Implementation completed without test events." };
        }
        return {
          text: "Implementation completed with focused tests.",
          tests: [
            {
              name: "focused test command",
              status: "passed",
              evidence: "The provider command exited 0.",
            },
          ],
        };
      }
      return { text: `${config.providerId} proposal.` };
    },
    async cancel() {},
    async dispose() {},
    onEvent(_listener: (event: LocalFrontierParticipantEvent) => void) {
      return () => undefined;
    },
  };
}

function createRequest(): MultiFrontierCreateCollaborationRequest {
  return {
    schemaVersion: 1,
    requestId: "request-1",
    action: "create",
    workspaceId: "workspace-1",
    prompt: "Implement the selected reversible code change.",
    autoContinueAfterAgreement: false,
    participants: [
      { participantId: "codex-1", providerId: "codex" },
      { participantId: "claude-1", providerId: "claude" },
    ],
  };
}

function action(
  actionName: "start" | "go" | "pause" | "resume",
  collaborationId: string,
) {
  return {
    schemaVersion: 1 as const,
    requestId: `request-${actionName}`,
    action: actionName,
    collaborationId,
  };
}

function useStore(): void {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "multi-frontier-manager-"),
  );
  roots.push(root);
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = root;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the collaboration cycle.");
}
