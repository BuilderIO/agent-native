import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  abortRunDurablyMock,
  getAgentHarnessSessionByRunIdMock,
  markAgentHarnessSessionStoppedMock,
  stopLiveAgentHarnessSessionMock,
} = vi.hoisted(() => ({
  abortRunDurablyMock: vi.fn(),
  getAgentHarnessSessionByRunIdMock: vi.fn(),
  markAgentHarnessSessionStoppedMock: vi.fn(),
  stopLiveAgentHarnessSessionMock: vi.fn(),
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
  stopLiveAgentHarnessSession: stopLiveAgentHarnessSessionMock,
}));
vi.mock("./store.js", () => ({
  getAgentHarnessSessionByRunId: getAgentHarnessSessionByRunIdMock,
  listAgentHarnessSessions: vi.fn(async () => []),
  markAgentHarnessSessionStopped: markAgentHarnessSessionStoppedMock,
}));

import { stopAgentHarnessBackgroundRun } from "./background.js";

beforeEach(() => {
  abortRunDurablyMock.mockReset();
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
  markAgentHarnessSessionStoppedMock.mockReset();
  stopLiveAgentHarnessSessionMock.mockReset();
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
    expect(stopLiveAgentHarnessSessionMock).toHaveBeenCalledWith({
      sessionId: "session-1",
      scope: { ownerEmail: "owner@example.com", orgId: "org-1" },
    });
    expect(markAgentHarnessSessionStoppedMock).toHaveBeenCalledWith(
      "session-1",
      "stopped",
    );
  });

  it("does not mark the session stopped when run abort persistence fails", async () => {
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
    expect(stopLiveAgentHarnessSessionMock).not.toHaveBeenCalled();
    expect(markAgentHarnessSessionStoppedMock).not.toHaveBeenCalled();
  });
});
