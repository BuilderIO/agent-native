import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  abortRunDurablyMock,
  getAgentHarnessSessionByRunIdMock,
  listAgentHarnessSessionEventsMock,
  stopAndPersistAgentHarnessSessionMock,
} = vi.hoisted(() => ({
  abortRunDurablyMock: vi.fn(),
  getAgentHarnessSessionByRunIdMock: vi.fn(),
  listAgentHarnessSessionEventsMock: vi.fn<() => Promise<unknown[]>>(
    async () => [],
  ),
  stopAndPersistAgentHarnessSessionMock: vi.fn(),
}));

vi.mock("../run-manager.js", () => ({
  abortRunDurably: abortRunDurablyMock,
}));
vi.mock("../run-store.js", () => ({
  getRunEventsSince: vi.fn(async () => []),
}));
vi.mock("./lifecycle.js", () => ({
  resolveAgentHarnessApproval: vi.fn(),
  sendAgentHarnessFollowUp: vi.fn(),
  stopAndPersistAgentHarnessSession: stopAndPersistAgentHarnessSessionMock,
}));
vi.mock("./store.js", () => ({
  getAgentHarnessSessionByRunId: getAgentHarnessSessionByRunIdMock,
  listAgentHarnessSessionEvents: listAgentHarnessSessionEventsMock,
  listAgentHarnessSessions: vi.fn(async () => []),
}));

import {
  listAgentHarnessBackgroundTranscriptEvents,
  stopAgentHarnessBackgroundRun,
} from "./background.js";

beforeEach(() => {
  abortRunDurablyMock.mockReset();
  listAgentHarnessSessionEventsMock.mockReset().mockResolvedValue([]);
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
