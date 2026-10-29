import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  threadAccess: vi.fn(),
  rows: vi.fn(),
  runIds: vi.fn(),
  status: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/server", () => ({
  callerHasThreadAccess: mocks.threadAccess,
  getCurrentTurnRunIdsForThread: mocks.runIds,
  getRunStatus: mocks.status,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.test",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: mocks.access }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("../server/db/index.js", () => ({
  schema: {
    designGenerationAttempts: { attemptId: "attemptId", designId: "designId" },
  },
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.rows }) }) }),
  }),
}));
vi.mock("./get-design-generation-output.js", () => ({
  default: { run: mocks.receipt },
}));

import action from "./resolve-design-generation-attempt.js";
const args = { designId: "design-1", attemptId: "attempt-1" };
describe("generation attempt resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ role: "owner" });
    mocks.threadAccess.mockResolvedValue(true);
    mocks.rows.mockResolvedValue([
      { designId: "design-1", threadId: "thread-1", turnId: "turn-1" },
    ]);
    mocks.runIds.mockResolvedValue(["earlier-run", "completed-run"]);
    mocks.receipt.mockResolvedValue({ status: "unknown" });
    mocks.status.mockResolvedValue("completed");
  });
  it("resolves the completed continuation with a verified output receipt", async () => {
    mocks.receipt.mockResolvedValueOnce({ status: "has_output" });
    expect(await action.run(args)).toEqual({
      status: "ready",
      result: { runId: "completed-run", turnId: "turn-1" },
    });
    expect(mocks.receipt).toHaveBeenCalledWith(
      { designId: "design-1", runId: "completed-run", turnId: "turn-1" },
      undefined,
    );
  });
  it("does not resolve a pending or unverified run", async () => {
    expect(await action.run(args)).toEqual({ status: "pending", result: null });
  });
  it("stops on a terminal failed turn without requesting a receipt", async () => {
    mocks.status.mockResolvedValue("aborted");
    expect(await action.run(args)).toEqual({
      status: "terminal",
      result: null,
    });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it.each(["truncated", "errored"])(
    "waits for a possible continuation after %s",
    async (status) => {
      mocks.status.mockResolvedValue(status);
      expect(await action.run(args)).toEqual({
        status: "pending",
        result: null,
      });
      expect(mocks.receipt).not.toHaveBeenCalled();
    },
  );
  it("resolves after a truncated run is followed by a completed continuation", async () => {
    mocks.runIds
      .mockResolvedValueOnce(["earlier-run"])
      .mockResolvedValueOnce(["earlier-run", "completed-run"]);
    mocks.status
      .mockResolvedValueOnce("truncated")
      .mockResolvedValueOnce("completed");
    mocks.receipt.mockResolvedValue({ status: "has_output" });
    expect(await action.run(args)).toEqual({ status: "pending", result: null });
    expect(await action.run(args)).toEqual({
      status: "ready",
      result: { runId: "completed-run", turnId: "turn-1" },
    });
  });
  it("stops after a completed turn with no output", async () => {
    mocks.status.mockResolvedValue("completed");
    mocks.receipt.mockResolvedValue({ status: "no_output" });
    expect(await action.run(args)).toEqual({
      status: "terminal",
      result: null,
    });
  });
  it("does not inspect an earlier completed run while its continuation is active", async () => {
    mocks.status.mockResolvedValue("running");
    mocks.receipt.mockResolvedValue({ status: "no_output" });
    expect(await action.run(args)).toEqual({ status: "pending", result: null });
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("reports missing provenance without treating it as pending", async () => {
    mocks.rows.mockResolvedValue([]);
    expect(await action.run(args)).toEqual({ status: "missing", result: null });
    expect(mocks.runIds).not.toHaveBeenCalled();
  });
  it("propagates a provenance read failure", async () => {
    mocks.rows.mockRejectedValue(new Error("database unavailable"));
    await expect(action.run(args)).rejects.toThrow("database unavailable");
  });
  it("checks thread access before reading run IDs or status", async () => {
    mocks.threadAccess.mockResolvedValue(false);
    expect(await action.run(args)).toEqual({
      status: "unavailable",
      result: null,
    });
    expect(mocks.runIds).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("rejects a non-owner before reading provenance", async () => {
    mocks.access.mockResolvedValue({ role: "viewer" });
    expect(await action.run(args)).toEqual({
      status: "unavailable",
      result: null,
    });
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
