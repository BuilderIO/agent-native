import { afterEach, describe, expect, it, vi } from "vitest";

import { refreshAccessTokenWithFallback } from "./google-calendar-client";

describe("Clips Google Calendar OAuth client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tries legacy credentials after a permanent refresh failure on the primary client", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "unauthorized_client" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "legacy-access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const tokens = await refreshAccessTokenWithFallback({
      refreshToken: "old-refresh-token",
      credentials: [
        { clientId: "new-client-id", clientSecret: "new-client-secret" },
        {
          clientId: "legacy-client-id",
          clientSecret: "legacy-client-secret",
        },
      ],
    });

    expect(tokens.access_token).toBe("legacy-access-token");
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(
      "client_id=new-client-id",
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "client_id=legacy-client-id",
    );
  });
});
