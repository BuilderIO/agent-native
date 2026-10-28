import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  abortRunDurablyMock,
  getRunEventsSinceMock,
  getAgentHarnessSessionByRunIdMock,
  listAgentHarnessSessionEventsMock,
  stopAndPersistAgentHarnessSessionMock,
  sendAgentHarnessFollowUpMock,
} = vi.hoisted(() => ({
  abortRunDurablyMock: vi.fn(),
  getRunEventsSinceMock: vi.fn<
    () => Promise<
      Array<{
        seq: number;
        eventAt: number | null;
        transcriptOrder?: number | null;
        eventData: string;
      }>
    >
  >(async () => []),
  getAgentHarnessSessionByRunIdMock: vi.fn(),
  listAgentHarnessSessionEventsMock: vi.fn<() => Promise<unknown[]>>(
    async () => [],
  ),
  stopAndPersistAgentHarnessSessionMock: vi.fn(),
  sendAgentHarnessFollowUpMock: vi.fn(),
}));

vi.mock("../run-manager.js", () => ({
  abortRunDurably: abortRunDurablyMock,
}));
vi.mock("../run-store.js", () => ({
  getRunEventsSince: getRunEventsSinceMock,
}));
vi.mock("./lifecycle.js", () => ({
  resolveAgentHarnessApproval: vi.fn(),
  sendAgentHarnessFollowUp: sendAgentHarnessFollowUpMock,
  stopAndPersistAgentHarnessSession: stopAndPersistAgentHarnessSessionMock,
}));
vi.mock("./store.js", () => ({
  getAgentHarnessSessionByRunId: getAgentHarnessSessionByRunIdMock,
  listAgentHarnessSessionEvents: listAgentHarnessSessionEventsMock,
  listAgentHarnessSessions: vi.fn(async () => []),
}));

import {
  createAgentHarnessBackgroundAgentController,
  listAgentHarnessBackgroundTranscriptEvents,
  stopAgentHarnessBackgroundRun,
} from "./background.js";

beforeEach(() => {
  abortRunDurablyMock.mockReset();
  getRunEventsSinceMock.mockReset().mockResolvedValue([]);
  listAgentHarnessSessionEventsMock.mockReset().mockResolvedValue([]);
  sendAgentHarnessFollowUpMock.mockReset().mockResolvedValue({
    ok: true,
    runId: "run-1",
    session: null,
  });
  getAgentHarnessSessionByRunIdMock.mockReset().mockResolvedValue({
    id: "session-1",
    runId: "run-1",
    harnessName: "Fake Harness",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  stopAndPersistAgentHarnessSessionMock
    .mockReset()
    .mockImplementation(async ({ status }) => {
      const session = await getAgentHarnessSessionByRunIdMock();
      return { ...session, status, stoppedAt: Date.now() };
    });
});

it("forwards the host completion hook to follow-up runs", async () => {
  const onRunComplete = vi.fn();
  const controller = createAgentHarnessBackgroundAgentController(
    { ownerEmail: null },
    { onRunComplete },
  );

  await controller.sendFollowUp({ runId: "run-1", prompt: "continue" });

  expect(sendAgentHarnessFollowUpMock).toHaveBeenCalledWith(
    expect.objectContaining({ onRunComplete }),
  );
});

it("replays persisted approval operations in the background transcript", async () => {
  listAgentHarnessSessionEventsMock.mockResolvedValue([
    {
      operationId: "approval:approval-1",
      seq: 0,
      eventAt: Date.now(),
      event: { type: "text", text: "Approved and continuing" },
    },
  ]);

  const transcript = await listAgentHarnessBackgroundTranscriptEvents("run-1", {
    ownerEmail: "owner@example.com",
    orgId: "org-1",
  });

  expect(transcript).toContainEqual(
    expect.objectContaining({
      sourceRecord: expect.objectContaining({
        type: "agent-harness-session-event",
        operationId: "approval:approval-1",
      }),
      message: "Approved and continuing",
    }),
  );
});

it("projects a submitted follow-up as user input in the transcript", async () => {
  listAgentHarnessSessionEventsMock.mockResolvedValue([
    {
      operationId: "follow-up:follow-up-1",
      seq: 0,
      eventAt: Date.now(),
      event: { type: "user_input", text: "Run the requested action" },
    },
  ]);

  const transcript = await listAgentHarnessBackgroundTranscriptEvents("run-1", {
    ownerEmail: "owner@example.com",
    orgId: "org-1",
  });

  expect(transcript).toContainEqual(
    expect.objectContaining({
      kind: "user",
      message: "Run the requested action",
      sourceRecord: expect.objectContaining({
        operationId: "follow-up:follow-up-1",
      }),
    }),
  );
});

it("assigns canonical order from the shared database journal order", async () => {
  getAgentHarnessSessionByRunIdMock.mockResolvedValueOnce({
    id: "session-1",
    runId: "run-1",
    harnessName: "Fake Harness",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    status: "idle",
    createdAt: 1_000,
    updatedAt: 9_000,
  });
  getRunEventsSinceMock.mockResolvedValueOnce([
    {
      seq: 4,
      eventAt: 3_000,
      transcriptOrder: 1,
      eventData: JSON.stringify({ type: "text", text: "Initial" }),
    },
    {
      seq: 8,
      eventAt: 4_000,
      transcriptOrder: 4,
      eventData: JSON.stringify({ type: "done" }),
    },
  ]);
  listAgentHarnessSessionEventsMock.mockResolvedValueOnce([
    {
      operationId: "follow-up:follow-up-1",
      seq: 0,
      eventAt: 8_000,
      transcriptOrder: 2,
      event: { type: "user_input", text: "Continue" },
    },
    {
      operationId: "follow-up:follow-up-1",
      seq: 1,
      eventAt: 2_000,
      transcriptOrder: 3,
      event: { type: "text", text: "Continued" },
    },
  ]);

  const transcript = await listAgentHarnessBackgroundTranscriptEvents("run-1", {
    ownerEmail: "owner@example.com",
    orgId: "org-1",
  });

  expect(transcript.map(({ id, message }) => [id, message])).toEqual([
    ["run-1:4", "Initial"],
    ["run-1:operation:follow-up:follow-up-1:0", "Continue"],
    ["run-1:operation:follow-up:follow-up-1:1", "Continued"],
    ["run-1:8", "Run completed"],
  ]);
  expect(transcript.map(({ createdAt }) => createdAt)).toEqual([
    new Date(3_000).toISOString(),
    new Date(8_000).toISOString(),
    new Date(2_000).toISOString(),
    new Date(4_000).toISOString(),
  ]);
  expect(
    transcript.map(({ sourceRecord, metadata }) => [
      sourceRecord.seq,
      metadata?.seq,
      metadata?.sourceSeq,
    ]),
  ).toEqual([
    [0, 0, 4],
    [1, 1, 0],
    [2, 2, 1],
    [3, 3, 8],
  ]);
});

it("marks the session start timestamp fallback for legacy run events", async () => {
  getAgentHarnessSessionByRunIdMock.mockResolvedValueOnce({
    id: "session-1",
    runId: "run-1",
    harnessName: "Fake Harness",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    status: "idle",
    createdAt: 1_000,
    updatedAt: 9_000,
  });
  getRunEventsSinceMock.mockResolvedValueOnce([
    {
      seq: 4,
      eventAt: null,
      transcriptOrder: null,
      eventData: JSON.stringify({ type: "text", text: "Legacy event" }),
    },
  ]);

  const transcript = await listAgentHarnessBackgroundTranscriptEvents("run-1", {
    ownerEmail: "owner@example.com",
    orgId: "org-1",
  });

  expect(transcript).toMatchObject([
    {
      id: "run-1:4",
      createdAt: new Date(1_000).toISOString(),
      sourceRecord: { seq: 0 },
      metadata: {
        seq: 0,
        sourceSeq: 4,
        createdAtFallback: "session-created-at",
      },
    },
  ]);
});

describe("Agent Harness background stop", () => {
  it("tears down a session when its run was never registered", async () => {
    abortRunDurablyMock.mockResolvedValueOnce(false);

    await expect(
      stopAgentHarnessBackgroundRun("run-1", {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(abortRunDurablyMock).toHaveBeenCalledWith("run-1", "user", {
      allowNotStarted: true,
    });
    expect(stopAndPersistAgentHarnessSessionMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      scope: { ownerEmail: "owner@example.com", orgId: "org-1" },
      status: "stopped",
    });
  });

  it("tears down the harness when run abort persistence fails", async () => {
    abortRunDurablyMock.mockRejectedValueOnce(
      new Error("run abort persistence failed"),
    );

    await expect(
      stopAgentHarnessBackgroundRun("run-1", {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).rejects.toThrow("run abort persistence failed");

    expect(abortRunDurablyMock).toHaveBeenCalledWith("run-1", "user", {
      allowNotStarted: true,
    });
    expect(stopAndPersistAgentHarnessSessionMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      scope: { ownerEmail: "owner@example.com", orgId: "org-1" },
      status: "errored",
    });
  });

  it("surfaces abort and teardown failures after recording an errored session", async () => {
    const abortError = new Error("run abort persistence failed");
    const teardownError = new Error("harness stop failed");
    abortRunDurablyMock.mockRejectedValueOnce(abortError);
    stopAndPersistAgentHarnessSessionMock.mockRejectedValueOnce(teardownError);

    await expect(
      stopAgentHarnessBackgroundRun("run-1", {
        ownerEmail: "owner@example.com",
        orgId: "org-1",
      }),
    ).rejects.toMatchObject({
      errors: [abortError, teardownError],
    });

    expect(stopAndPersistAgentHarnessSessionMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      scope: { ownerEmail: "owner@example.com", orgId: "org-1" },
      status: "errored",
    });
  });
});
