import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callerHasThreadAccess: vi.fn(),
  getCurrentTurnRunEventsForThread: vi.fn(),
  getCurrentTurnRunIdsForThread: vi.fn(),
  getRunStatus: vi.fn(),
  getRunTurnRef: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  resolveAccess: vi.fn(),
  trackDesign: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  callerHasThreadAccess: mocks.callerHasThreadAccess,
  getCurrentTurnRunEventsForThread: mocks.getCurrentTurnRunEventsForThread,
  getCurrentTurnRunIdsForThread: mocks.getCurrentTurnRunIdsForThread,
  getRunStatus: mocks.getRunStatus,
  getRunTurnRef: mocks.getRunTurnRef,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../server/lib/design-tracking.js", () => ({
  isHumanCaller: (source: { caller?: string } | undefined) =>
    source?.caller === "frontend",
  trackDesign: mocks.trackDesign,
}));
vi.mock("../server/db/index.js", () => ({}));

import { designOutputWriteReceipt } from "../shared/generation-output-receipt.js";
import getDesignGenerationOutput from "./get-design-generation-output.js";

const runId = "run-1";
const turnId = "turn-1";

function completedOutputEvents() {
  return [
    { runId, seq: 0, event: { type: "model_stream", status: "start" } },
    {
      runId,
      seq: 1,
      event: {
        type: "tool_done",
        tool: "generate-design",
        input: { designId: "design-1" },
        completedSideEffect: true,
        receipt: designOutputWriteReceipt("design-1", 1),
      },
    },
    { runId, seq: 2, event: { type: "done" } },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({ role: "owner" });
  mocks.getRunTurnRef.mockResolvedValue({ threadId: "thread-1", turnId });
  mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
  mocks.getRequestOrgId.mockReturnValue("org-1");
  mocks.callerHasThreadAccess.mockResolvedValue(true);
  mocks.getRunStatus.mockResolvedValue("completed");
  mocks.getCurrentTurnRunEventsForThread.mockResolvedValue(
    completedOutputEvents(),
  );
  mocks.getCurrentTurnRunIdsForThread.mockResolvedValue([runId]);
});

describe("get-design-generation-output ready tracking", () => {
  it("requires a proven UI call at the action boundary", () => {
    expect(getDesignGenerationOutput.uiOnly).toBe(true);
  });

  it("records a frontend ready view only after the persisted run receipt confirms output", async () => {
    const result = await getDesignGenerationOutput.run(
      { designId: "design-1", runId, turnId, recordReadyView: true },
      {
        caller: "frontend",
        runId,
        turnId,
      } as never,
    );

    expect(result).toEqual({ status: "has_output" });
    expect(mocks.trackDesign).toHaveBeenCalledWith(
      "design_ready_viewed",
      {
        output_id: "design-1",
        output_type: "design",
        run_id: runId,
        turn_id: turnId,
        is_owner: true,
      },
      expect.objectContaining({ caller: "frontend" }),
    );
  });

  it("does not record a ready view when the completed run has no output receipt", async () => {
    mocks.getCurrentTurnRunEventsForThread.mockResolvedValue([
      { runId, seq: 0, event: { type: "model_stream", status: "start" } },
      { runId, seq: 1, event: { type: "done" } },
    ]);

    const result = await getDesignGenerationOutput.run(
      { designId: "design-1", runId, turnId, recordReadyView: true },
      { caller: "frontend" } as never,
    );

    expect(result).toEqual({ status: "no_output" });
    expect(mocks.trackDesign).not.toHaveBeenCalled();
  });

  it("does not attribute agent calls as a human ready view", async () => {
    await getDesignGenerationOutput.run(
      { designId: "design-1", runId, turnId, recordReadyView: true },
      { caller: "tool" } as never,
    );

    expect(mocks.trackDesign).not.toHaveBeenCalled();
  });

  it("does not record a mismatched turn", async () => {
    mocks.getRunTurnRef.mockResolvedValue({
      threadId: "thread-1",
      turnId: "other-turn",
    });

    const result = await getDesignGenerationOutput.run(
      { designId: "design-1", runId, turnId, recordReadyView: true },
      { caller: "frontend" } as never,
    );

    expect(result).toEqual({ status: "unknown" });
    expect(mocks.trackDesign).not.toHaveBeenCalled();
  });
});
