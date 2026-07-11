import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Booking } from "../../shared/index.js";
import { createTeamsProvider } from "./teams.js";

const booking: Booking = {
  id: "booking-example",
  uid: "booking-uid-example",
  eventTypeId: "event-type-example",
  hostEmail: "host@example.com",
  title: "Example planning call",
  startTime: "2026-07-15T17:00:00.000Z",
  endTime: "2026-07-15T17:30:00.000Z",
  timezone: "UTC",
  status: "confirmed",
  attendees: [{ email: "guest@example.com", name: "Example Guest" }],
  references: [],
  iCalUid: "ical-example",
  iCalSequence: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

describe("createTeamsProvider", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn(async () => "access-token-example");
  const updateTokens = vi.fn();
  const markInvalid = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function provider(tenant?: string) {
    return createTeamsProvider({
      clientId: "client-id-example",
      clientSecret: "client-secret-example",
      tenant,
      getAccessToken,
      updateTokens,
      markInvalid,
    });
  }

  it("uses the Teams kind and a work-or-school OAuth default", async () => {
    const teams = provider();
    expect(teams).toMatchObject({
      kind: "teams_video",
      label: "Microsoft Teams",
    });
    const result = await teams.startOAuth!({
      redirectUri: "https://calendar.example.com/oauth/callback",
      state: "state-example",
    });
    const url = new URL(result.authUrl);
    expect(url.pathname).toBe("/organizations/oauth2/v2.0/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id-example");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://calendar.example.com/oauth/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-example");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "offline_access",
      "OnlineMeetings.ReadWrite",
      "User.Read",
    ]);
    expect(result.authUrl).not.toContain("client-secret-example");
  });

  it("uses an explicit Microsoft tenant", async () => {
    const result = await provider("tenant-example").startOAuth!({
      redirectUri: "https://calendar.example.com/oauth/callback",
      state: "state-example",
    });
    expect(new URL(result.authUrl).pathname).toBe(
      "/tenant-example/oauth2/v2.0/authorize",
    );
  });

  it("exchanges OAuth tokens and resolves the Microsoft identity", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access-token-example",
            refresh_token: "refresh-token-example",
            expires_in: 1800,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "microsoft-user-example",
            mail: "microsoft-user@example.com",
            displayName: "Example User",
          }),
          { status: 200 },
        ),
      );

    const result = await provider("tenant-example").completeOAuth!({
      credentialId: "credential-example",
      userEmail: "fallback@example.com",
      code: "authorization-code-example",
      redirectUri: "https://calendar.example.com/oauth/callback",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://login.microsoftonline.com/tenant-example/oauth2/v2.0/token",
    );
    const tokenInit = fetchMock.mock.calls[0]?.[1];
    expect(tokenInit?.method).toBe("POST");
    const tokenBody = tokenInit?.body as URLSearchParams;
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("code")).toBe("authorization-code-example");
    expect(updateTokens).toHaveBeenCalledWith(
      "credential-example",
      expect.objectContaining({
        accessToken: "new-access-token-example",
        refreshToken: "refresh-token-example",
        expiresAt: new Date("2026-07-10T00:30:00.000Z"),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { authorization: "Bearer new-access-token-example" },
    });
    expect(result).toEqual({
      externalAccountId: "microsoft-user-example",
      externalEmail: "microsoft-user@example.com",
      displayName: "Example User",
    });
  });

  it("does not persist tokens after a failed exchange", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    await expect(
      provider().completeOAuth!({
        credentialId: "credential-example",
        userEmail: "user@example.com",
        code: "authorization-code-example",
        redirectUri: "https://calendar.example.com/oauth/callback",
      }),
    ).rejects.toThrow("token exchange failed (400)");
    expect(updateTokens).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a Teams meeting and maps id plus joinWebUrl", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "meeting/id example",
          joinWebUrl: "https://teams.microsoft.com/l/meetup-join/example",
        }),
        { status: 201 },
      ),
    );
    const result = await provider().createMeeting({
      credentialId: "credential-example",
      booking,
    });
    expect(getAccessToken).toHaveBeenCalledWith("credential-example");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/me/onlineMeetings",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      subject: booking.title,
      startDateTime: booking.startTime,
      endDateTime: booking.endTime,
    });
    expect(result).toEqual({
      meetingId: "meeting/id example",
      meetingUrl: "https://teams.microsoft.com/l/meetup-join/example",
    });
  });

  it("requires a credential before creating a meeting", async () => {
    await expect(provider().createMeeting({ booking })).rejects.toThrow(
      "requires credentialId",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "marks a credential invalid on create HTTP %s",
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      await expect(
        provider().createMeeting({
          credentialId: "credential-example",
          booking,
        }),
      ).rejects.toThrow(`creation failed (${status})`);
      expect(markInvalid).toHaveBeenCalledWith("credential-example");
    },
  );

  it("deletes a meeting using an encoded opaque id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await provider().deleteMeeting!({
      credentialId: "credential-example",
      meetingId: "meeting/id example",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/me/onlineMeetings/meeting%2Fid%20example",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("treats an already-deleted meeting as success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      provider().deleteMeeting!({
        credentialId: "credential-example",
        meetingId: "missing-meeting-example",
      }),
    ).resolves.toBeUndefined();
  });

  it.each([401, 403])(
    "marks a credential invalid on delete HTTP %s",
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      await expect(
        provider().deleteMeeting!({
          credentialId: "credential-example",
          meetingId: "meeting-example",
        }),
      ).rejects.toThrow(`deletion failed (${status})`);
      expect(markInvalid).toHaveBeenCalledWith("credential-example");
    },
  );
});
