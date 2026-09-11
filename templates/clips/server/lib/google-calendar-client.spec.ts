import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveGoogleProviderCredentialCandidatesWithReader: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS: {
    clientIdKey: "GOOGLE_CLIENT_ID",
    clientSecretKey: "GOOGLE_CLIENT_SECRET",
  },
  resolveGoogleProviderCredentialCandidatesWithReader:
    mocks.resolveGoogleProviderCredentialCandidatesWithReader,
}));

import {
  refreshAccessTokenWithFallback,
  resolveGoogleOAuthCredentialCandidates,
} from "./google-calendar-client";

describe("Clips Google Calendar OAuth client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.resolveGoogleProviderCredentialCandidatesWithReader.mockReset();
  });

  it("restricts Clips Calendar OAuth to the primary Google credential pair", async () => {
    mocks.resolveGoogleProviderCredentialCandidatesWithReader.mockResolvedValue(
      [],
    );

    await expect(resolveGoogleOAuthCredentialCandidates()).resolves.toEqual([]);

    expect(
      mocks.resolveGoogleProviderCredentialCandidatesWithReader,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialKeyPairs: [
          {
            clientIdKey: "GOOGLE_CLIENT_ID",
            clientSecretKey: "GOOGLE_CLIENT_SECRET",
          },
        ],
      }),
    );
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
