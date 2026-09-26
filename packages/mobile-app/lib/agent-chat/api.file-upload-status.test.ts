import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("react-native", () => ({
  DeviceEventEmitter: { emit: vi.fn() },
}));
vi.mock("@/lib/analytics", () => ({
  getMobileAnalyticsHeaders: vi.fn(async () => ({})),
}));
vi.mock("@/lib/session-token-store", () => ({
  getSessionToken: vi.fn(async () => "mobile-session-token"),
}));

import { AgentChatError, getFileUploadStatus } from "./api";

describe("getFileUploadStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    [{ configured: true }, "configured"],
    [{ configured: false }, "missing"],
  ] as const)(
    "reads the authoritative configured flag",
    async (body, status) => {
      const fetchMock = vi.fn(async () => Response.json(body));
      vi.stubGlobal("fetch", fetchMock);

      await expect(getFileUploadStatus("https://chat.example")).resolves.toBe(
        status,
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://chat.example/_agent-native/file-upload/status",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer mobile-session-token",
          }),
        }),
      );
    },
  );

  it("rejects incomplete status responses instead of treating them as missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );

    await expect(getFileUploadStatus()).rejects.toThrow(
      "File storage status response was incomplete",
    );
  });

  it("preserves request failures so the caller can report unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await expect(getFileUploadStatus()).rejects.toBeInstanceOf(AgentChatError);
  });
});
