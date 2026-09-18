import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";

const resolveCredentialMock = vi.hoisted(() => vi.fn());
const ssrfSafeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../credentials/index.js", () => ({
  resolveCredential: (...args: unknown[]) => resolveCredentialMock(...args),
}));
vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetchMock(...args),
}));

import {
  clearRemoteAgentTokenCache,
  RemoteAgentAuthError,
  RemoteAgentCredentialRejectedError,
  resolveRemoteAgentToken,
} from "./remote-agent-auth.js";

describe("remote hosted-agent auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearRemoteAgentTokenCache();
    resolveCredentialMock.mockResolvedValue("client-secret");
  });

  it("resolves bearer tokens from the current workspace credential scope", async () => {
    await expect(
      resolveRemoteAgentToken(
        { type: "bearer", credentialRef: "FOUNDRY_BEARER" },
        { userEmail: "alice@example.test", orgId: "org-1" },
      ),
    ).resolves.toBe("client-secret");

    expect(resolveCredentialMock).toHaveBeenCalledWith("FOUNDRY_BEARER", {
      userEmail: "alice@example.test",
      orgId: "org-1",
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("requests and caches an OAuth client-credentials token until expiry", async () => {
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify({ apps: [{ port: 19100 }] }),
    );
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "hosted-token", expires_in: 3_600 }),
        { status: 200 },
      ),
    );
    const auth = {
      type: "oauth-client-credentials" as const,
      tokenUrl: "https://login.example.test/oauth/token",
      clientId: "client-id",
      clientSecretRef: "FOUNDRY_CLIENT_SECRET",
      scope: "https://ai.azure.com/.default",
    };

    await expect(
      resolveRemoteAgentToken(auth, { userEmail: "alice@example.test" }),
    ).resolves.toBe("hosted-token");
    await expect(
      resolveRemoteAgentToken(auth, { userEmail: "alice@example.test" }),
    ).resolves.toBe("hosted-token");

    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    const [, request, fetchOptions] = ssrfSafeFetchMock.mock.calls[0] as [
      string,
      RequestInit,
      { allowedPrivateOrigins?: string[] },
    ];
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(fetchOptions.allowedPrivateOrigins).toContain(
      "http://127.0.0.1:19100",
    );
    expect(
      Object.fromEntries(new URLSearchParams(String(request.body))),
    ).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id",
      client_secret: "client-secret",
      scope: "https://ai.azure.com/.default",
    });
  });

  it("does not share cached tokens across credential scopes", async () => {
    ssrfSafeFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "alice-token", expires_in: 3_600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "bob-token", expires_in: 3_600 }),
          { status: 200 },
        ),
      );
    const auth = {
      type: "oauth-client-credentials" as const,
      tokenUrl: "https://login.example.test/oauth/token",
      clientId: "client-id",
      clientSecretRef: "FOUNDRY_CLIENT_SECRET",
    };

    await expect(
      resolveRemoteAgentToken(auth, {
        userEmail: "alice@example.test",
        orgId: "org-1",
      }),
    ).resolves.toBe("alice-token");
    await expect(
      resolveRemoteAgentToken(auth, {
        userEmail: "bob@example.test",
        orgId: "org-2",
      }),
    ).resolves.toBe("bob-token");
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates a cached token when the vault secret rotates", async () => {
    resolveCredentialMock
      .mockResolvedValueOnce("old-secret")
      .mockResolvedValueOnce("new-secret");
    ssrfSafeFetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "old-token", expires_in: 3_600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "new-token", expires_in: 3_600 }),
          { status: 200 },
        ),
      );
    const auth = {
      type: "oauth-client-credentials" as const,
      tokenUrl: "https://login.example.test/oauth/token",
      clientId: "client-id",
      clientSecretRef: "FOUNDRY_CLIENT_SECRET",
    };

    await expect(
      resolveRemoteAgentToken(auth, { userEmail: "alice@example.test" }),
    ).resolves.toBe("old-token");
    await expect(
      resolveRemoteAgentToken(auth, { userEmail: "alice@example.test" }),
    ).resolves.toBe("new-token");
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403] as const)(
    "surfaces HTTP %s as a typed credential rejection",
    async (status) => {
      ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status }));

      const error = await resolveRemoteAgentToken(
        {
          type: "oauth-client-credentials",
          tokenUrl: "https://login.example.test/oauth/token",
          clientId: "client-id",
          clientSecretRef: "FOUNDRY_CLIENT_SECRET",
        },
        { userEmail: "alice@example.test" },
      ).catch((value) => value);

      expect(error).toBeInstanceOf(RemoteAgentCredentialRejectedError);
      expect(error).toMatchObject({
        name: "RemoteAgentCredentialRejectedError",
        code: "credential_rejected",
        status,
        statusCode: status,
      });
    },
  );

  it("fails before requesting a token when no user-scoped credential is available", async () => {
    resolveCredentialMock.mockResolvedValue(undefined);

    const error = await resolveRemoteAgentToken(
      { type: "bearer", credentialRef: "FOUNDRY_BEARER" },
      { userEmail: "alice@example.test", orgId: "org-1" },
    ).catch((value) => value);

    expect(error).toBeInstanceOf(RemoteAgentAuthError);
    expect(error).toMatchObject({ code: "credential_missing" });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });
});
