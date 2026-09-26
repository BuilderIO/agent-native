import { afterEach, describe, expect, it, vi } from "vitest";

import { createZoomProvider, ZoomProviderError } from "./zoom.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Zoom provider request errors", () => {
  it.each([400, 401, 403, 429, 500])(
    "preserves the rejected HTTP status %s",
    async (statusCode) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("request rejected", { status: statusCode }),
          ),
      );
      const provider = createZoomProvider({
        clientId: "client-id",
        clientSecret: "client-secret",
        getAccessToken: async () => "access-token",
      });

      await expect(
        provider.createMeeting({
          credentialId: "zoom-account",
          booking: {
            uid: "booking-1",
            title: "Booking",
            description: "",
            startTime: "2026-09-25T23:30:00.000Z",
            endTime: "2026-09-26T00:00:00.000Z",
            timezone: "America/Los_Angeles",
            hostEmail: "host@example.com",
            attendees: [],
            iCalUid: "ical-1",
            iCalSequence: 0,
          },
        }),
      ).rejects.toMatchObject<Partial<ZoomProviderError>>({
        name: "ZoomProviderError",
        statusCode,
      });
    },
  );
});
