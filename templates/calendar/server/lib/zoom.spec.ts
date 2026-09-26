import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createZoomMeeting } from "./zoom.js";

const mocks = vi.hoisted(() => ({
  providerError: null as Error | null,
  providerCreateMeeting: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/scheduling/server/providers", () => ({
  ZoomProviderError: class ZoomProviderError extends Error {
    constructor(
      readonly statusCode: number,
      message = `Zoom ${statusCode}`,
    ) {
      super(message);
      this.name = "ZoomProviderError";
    }
  },
  createZoomProvider: ({
    getAccessToken,
  }: {
    getAccessToken: (credentialId: string) => Promise<string>;
  }) => ({
    createMeeting: async ({ credentialId }: { credentialId: string }) => {
      mocks.providerCreateMeeting();
      await getAccessToken(credentialId);
      if (mocks.providerError) throw mocks.providerError;
      return {
        meetingId: "meeting-id",
        meetingUrl: "https://zoom.us/j/example",
      };
    },
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.providerError = null;
});

describe("createZoomMeeting", () => {
  it("releases the slot when token refresh fails before Zoom creation", async () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "client-id");
    vi.stubEnv("ZOOM_CLIENT_SECRET", "client-secret");
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      { accountId: "zoom-account", displayName: "Host" },
    ] as never);
    vi.mocked(getOAuthTokens).mockResolvedValue({
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1,
    } as never);
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createZoomMeeting({
        hostEmail: "host@example.com",
        title: "Booking",
        startTime: "2026-09-25T23:30:00.000Z",
        endTime: "2026-09-26T00:00:00.000Z",
        timezone: "America/Los_Angeles",
      }),
    ).resolves.toEqual({ status: "not_started" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://zoom.us/oauth/token");
    expect(mocks.providerCreateMeeting).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "Zoom meeting could not be prepared before creation:",
      expect.objectContaining({ message: "Zoom token refresh failed: 401" }),
    );
  });

  it("releases the slot when Zoom explicitly rejects meeting creation", async () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "client-id");
    vi.stubEnv("ZOOM_CLIENT_SECRET", "client-secret");
    vi.mocked(listOAuthAccountsByOwner).mockResolvedValue([
      { accountId: "zoom-account", displayName: "Host" },
    ] as never);
    vi.mocked(getOAuthTokens).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 10 * 60_000,
    } as never);
    const { ZoomProviderError } =
      await import("@agent-native/scheduling/server/providers");
    mocks.providerError = new ZoomProviderError(401, "Unauthorized");

    await expect(
      createZoomMeeting({
        hostEmail: "host@example.com",
        title: "Booking",
        startTime: "2026-09-25T23:30:00.000Z",
        endTime: "2026-09-26T00:00:00.000Z",
        timezone: "America/Los_Angeles",
      }),
    ).resolves.toEqual({ status: "rejected" });
    expect(mocks.providerCreateMeeting).toHaveBeenCalledTimes(1);
  });
});
