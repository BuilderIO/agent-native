import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const executeRequest = vi.fn();
let action: any;
vi.mock("../server/lib/provider-api", () => ({
  getAnalyticsProviderApiRuntime: () => ({ executeRequest }),
}));

describe("test-custom-api-connection", () => {
  beforeAll(async () => {
    action = (await import("./test-custom-api-connection"))["default"];
  }, 60_000);

  beforeEach(() => {
    executeRequest.mockReset();
  });

  it("summarizes successful JSON rows without returning transport details", async () => {
    executeRequest.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        statusText: "OK",
        json: { data: [{ id: 1, name: "A", token: "secret" }] },
      },
    });
    expect(action.agentTool).toBe(false);
    expect(action.readOnly).toBe(true);
    expect(action.http).toEqual({ method: "POST" });
    await expect(
      action.run({ provider: "custom", path: "/rows" }),
    ).resolves.toMatchObject({
      ok: true,
      rowCount: 1,
      columns: ["id", "name", "token"],
      sampleRows: [{ id: 1, name: "A", token: "[redacted]" }],
    });
    expect(executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        auth: "default",
        maxBytes: 1_000_000,
        timeoutMs: 10_000,
      }),
    );
  });

  it("returns useful non-2xx and runtime errors", async () => {
    executeRequest.mockResolvedValueOnce({
      response: { ok: false, status: 401, statusText: "Unauthorized" },
    });
    await expect(
      action.run({ provider: "custom", path: "/rows" }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      error: expect.stringContaining("401"),
    });
    executeRequest.mockRejectedValueOnce(new Error("missing credential"));
    await expect(
      action.run({ provider: "custom", path: "/rows" }),
    ).resolves.toMatchObject({
      ok: false,
      status: 0,
      error: expect.stringContaining("missing credential"),
    });
  });
});
