import { beforeEach, describe, expect, it, vi } from "vitest";

const executeExistingCodeAgentRunMock = vi.hoisted(() => vi.fn());
const queueCodeAgentFollowUpMock = vi.hoisted(() => vi.fn());
const isActiveCodeAgentRunMock = vi.hoisted(() => vi.fn());

vi.mock("../cli/code-agent-executor.js", () => ({
  executeDenyCodeAgentApproval: vi.fn(),
  executeExistingCodeAgentRun: executeExistingCodeAgentRunMock,
  executePendingCodeAgentApproval: vi.fn(),
}));

vi.mock("../cli/code-agent-runs.js", () => ({
  appendCodeAgentTranscriptEvent: vi.fn(() => ({
    id: "event-1",
    createdAt: "2026-10-26T00:00:00.000Z",
  })),
  getCodeAgentRunRecord: vi.fn(() => ({ id: "run-1", status: "completed" })),
  isActiveCodeAgentRun: isActiveCodeAgentRunMock,
  queueCodeAgentFollowUp: queueCodeAgentFollowUpMock,
  updateCodeAgentRunRecord: vi.fn(),
}));

vi.mock("./background-run.js", () => ({
  getBackgroundAgentRun: vi.fn(),
  listBackgroundAgentRuns: vi.fn(),
  listBackgroundAgentTranscriptEvents: vi.fn(),
  toBackgroundAgentRun: vi.fn((run: { id: string }) => ({ id: run.id })),
}));

const { localCodeBackgroundAgentController } =
  await import("./background-controller.js");

const attachments = [
  { name: "DESIGN.md", text: "# Design", totalChars: 70_000 },
  { name: "notes.md", readError: "not-utf8" },
  { name: "bad.md", readError: "exploded", totalChars: "1" },
];

describe("localCodeBackgroundAgentController.sendFollowUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes attachment truncation and read errors to an immediate run", async () => {
    isActiveCodeAgentRunMock.mockReturnValue(false);
    executeExistingCodeAgentRunMock.mockResolvedValue({ id: "run-1" });

    await localCodeBackgroundAgentController.sendFollowUp({
      runId: "run-1",
      prompt: "Match this",
      metadata: { attachments },
    });

    expect(executeExistingCodeAgentRunMock).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        attachments: [
          { name: "DESIGN.md", text: "# Design", totalChars: 70_000 },
          { name: "notes.md", readError: "not-utf8" },
          { name: "bad.md" },
        ],
      }),
    );
  });

  it("passes the same attachments to a queued follow-up", async () => {
    isActiveCodeAgentRunMock.mockReturnValue(true);

    const result = await localCodeBackgroundAgentController.sendFollowUp({
      runId: "run-1",
      prompt: "Match this",
      metadata: { attachments },
    });

    expect(result.queued).toBe(true);
    expect(queueCodeAgentFollowUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { name: "DESIGN.md", text: "# Design", totalChars: 70_000 },
          { name: "notes.md", readError: "not-utf8" },
          { name: "bad.md" },
        ],
      }),
    );
    expect(executeExistingCodeAgentRunMock).not.toHaveBeenCalled();
  });
});
