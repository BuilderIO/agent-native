import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../chat-threads/store.js", () => ({
  ensureChatThreadTables: vi.fn(async () => {}),
}));
const abortMock = vi.fn();
vi.mock("./run-manager.js", () => ({
  abortRunDurably: (...a: any[]) => abortMock(...a),
}));
const statusMock = vi.fn();
vi.mock("./run-store.js", () => ({
  ensureRunTables: vi.fn(async () => {}),
  getRunStatus: (...a: any[]) => statusMock(...a),
}));

const { containServicePrincipal, PRINCIPAL_SUSPENDED_ABORT_REASON } =
  await import("./contain-principal.js");

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue({ rows: [{ id: "r1" }, { id: "r2" }] });
  abortMock.mockResolvedValue(true);
  statusMock.mockResolvedValue("aborted");
});

describe("containServicePrincipal", () => {
  it("aborts the running runs of the service identity's threads", async () => {
    const res = await containServicePrincipal("org-1", "ci");
    expect(executeMock.mock.calls[0][0]).toMatchObject({
      args: ["svc-ci@service.org-1"],
    });
    expect(executeMock.mock.calls[0][0].sql).toMatch(/status = 'running'/);
    expect(abortMock.mock.calls).toEqual([
      ["r1", PRINCIPAL_SUSPENDED_ABORT_REASON],
      ["r2", PRINCIPAL_SUSPENDED_ABORT_REASON],
    ]);
    expect(res).toEqual({ abortedRuns: 2, containmentErrors: [] });
  });

  it("reports a run that is still running after the abort (abortRunDurably swallows write failures)", async () => {
    statusMock
      .mockResolvedValueOnce("running")
      .mockResolvedValueOnce("aborted");
    const res = await containServicePrincipal("org-1", "ci");
    expect(res.abortedRuns).toBe(1);
    expect(res.containmentErrors).toEqual(["r1: still running after abort"]);
  });

  it("keeps going after one abort throws and reports it", async () => {
    abortMock.mockRejectedValueOnce(new Error("boom"));
    const res = await containServicePrincipal("org-1", "ci");
    expect(res.abortedRuns).toBe(1);
    expect(res.containmentErrors).toEqual(["r1: boom"]);
  });

  it("propagates an unreadable run store instead of reporting zero runs", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    await expect(containServicePrincipal("org-1", "ci")).rejects.toThrow(
      "db down",
    );
  });
});
