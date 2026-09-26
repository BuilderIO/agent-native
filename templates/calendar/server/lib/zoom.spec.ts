import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createZoomMeeting, needsZoomCancellationReview } from "./zoom.js";

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/scheduling/server/providers", () => ({
  createZoomProvider: ({
    getAccessToken,
  }: {
    getAccessToken: (credentialId: string) => Promise<string>;
  }) => ({
    createMeeting: async ({ credentialId }: { credentialId: string }) => {
      await getAccessToken(credentialId);
      return {
        meetingId: "meeting-id",
        meetingUrl: "https://zoom.us/j/example",
      };
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("createZoomMeeting", () => {
  it("fails instead of using an expired access token when refresh fails", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(
      createZoomMeeting({
        hostEmail: "host@example.com",
        title: "Booking",
        startTime: "2026-09-25T23:30:00.000Z",
        endTime: "2026-09-26T00:00:00.000Z",
        timezone: "America/Los_Angeles",
      }),
    ).rejects.toThrow("Zoom token refresh failed: 401");
  });
});

describe("needsZoomCancellationReview", () => {
  it.each([
    "https://zoom.us/j/123456789",
    "https://us02web.zoom.com/j/123456789",
    "https://gov.zoomgov.com/j/123456789",
  ])(
    "requires review for legacy Zoom links without provider IDs: %s",
    (url) => {
      expect(needsZoomCancellationReview({ meetingLink: url })).toBe(true);
    },
  );

  it("does not treat lookalike hosts as Zoom", () => {
    expect(
      needsZoomCancellationReview({
        meetingLink: "https://zoom.us.example.com/j/123456789",
      }),
    ).toBe(false);
  });
});
