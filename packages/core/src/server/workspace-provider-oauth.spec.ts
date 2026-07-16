import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceConnectionProvider } from "../connections/catalog.js";
import {
  buildWorkspaceProviderAuthorizationUrl,
  exchangeWorkspaceProviderOAuthCode,
  isWorkspaceProviderOAuthFlowValid,
  mergeWorkspaceOAuthValues,
  resolveWorkspaceProviderIdentity,
  type WorkspaceProviderOAuthFlow,
} from "./workspace-provider-oauth.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace provider OAuth", () => {
  it("preserves prior app grants and scopes across sequential connects", () => {
    expect(
      mergeWorkspaceOAuthValues(["slides", "design"], ["assets", "slides"]),
    ).toEqual(["slides", "design", "assets"]);
    expect(
      mergeWorkspaceOAuthValues(
        ["file_content:read"],
        ["projects:read", "file_content:read"],
      ),
    ).toEqual(["file_content:read", "projects:read"]);
  });

  it("binds callback state to the original user, organization, app, provider, and expiry", () => {
    const flow: WorkspaceProviderOAuthFlow = {
      provider: "figma",
      flowId: "flow-1",
      verifier: "verifier",
      redirectUri: "https://app.example.com/callback",
      owner: "owner@example.com",
      orgId: "org-1",
      appId: "creative-context",
      expiresAt: 2_000,
    };
    const state = {
      redirectUri: flow.redirectUri,
      owner: flow.owner,
      orgId: flow.orgId,
      app: flow.appId,
      flowId: flow.flowId,
    };
    const valid = {
      flow,
      state,
      provider: "figma" as const,
      sessionEmail: flow.owner,
      sessionOrgId: flow.orgId,
      now: 1_000,
    };

    expect(isWorkspaceProviderOAuthFlowValid(valid)).toBe(true);
    expect(
      isWorkspaceProviderOAuthFlowValid({
        ...valid,
        sessionOrgId: "org-switched",
      }),
    ).toBe(false);
    expect(
      isWorkspaceProviderOAuthFlowValid({
        ...valid,
        sessionEmail: "different-user@example.com",
      }),
    ).toBe(false);
    expect(
      isWorkspaceProviderOAuthFlowValid({
        ...valid,
        state: { ...state, orgId: "org-tampered" },
      }),
    ).toBe(false);
    expect(
      isWorkspaceProviderOAuthFlowValid({
        ...valid,
        state: { ...state, flowId: "tampered" },
      }),
    ).toBe(false);
    expect(isWorkspaceProviderOAuthFlowValid({ ...valid, now: 2_001 })).toBe(
      false,
    );
  });

  it("builds a PKCE-bound Figma authorization request with the catalog scopes", () => {
    const provider = getWorkspaceConnectionProvider("figma")!;
    const url = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        provider,
        clientId: "figma-client",
        redirectUri:
          "https://app.example.com/_agent-native/connections/oauth/figma/callback",
        state: "signed-state",
        challenge: "pkce-challenge",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://www.figma.com/oauth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "figma-client",
      response_type: "code",
      state: "signed-state",
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining([
        "current_user:read",
        "file_content:read",
        "file_metadata:read",
        "projects:read",
      ]),
    );
  });

  it("requests a user-owned Notion authorization grant", () => {
    const provider = getWorkspaceConnectionProvider("notion")!;
    const url = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        provider,
        clientId: "notion-client",
        redirectUri:
          "https://app.example.com/_agent-native/connections/oauth/notion/callback",
        state: "signed-state",
        challenge: "pkce-challenge",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://api.notion.com/v1/oauth/authorize",
    );
    expect(url.searchParams.get("owner")).toBe("user");
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });

  it("isolates offline consent to Picker-selected Drive files", () => {
    const provider = getWorkspaceConnectionProvider("google_drive")!;
    const url = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        provider,
        clientId: "google-client",
        redirectUri:
          "https://app.example.com/_agent-native/connections/oauth/google_drive/callback",
        state: "signed-state",
        challenge: "unused-challenge",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "https://www.googleapis.com/auth/drive.file",
    ]);
  });

  it("exchanges Figma codes at the current token endpoint without exposing credentials", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(String(init?.body)).toContain("code_verifier=verifier");
      return new Response(
        JSON.stringify({ access_token: "figma-token", expires_in: 3600 }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWorkspaceConnectionProvider("figma")!;
    const tokens = await exchangeWorkspaceProviderOAuthCode({
      providerId: "figma",
      provider,
      clientId: "figma-client",
      clientSecret: "figma-secret",
      code: "code",
      verifier: "verifier",
      redirectUri: "https://app.example.com/callback",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.figma.com/v1/oauth/token",
      expect.any(Object),
    );
    expect(tokens).toMatchObject({
      access_token: "figma-token",
      expiry_date: expect.any(Number),
    });
  });

  it("uses Notion's JSON token exchange and reports only a generic failure", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        grant_type: "authorization_code",
      });
      expect(JSON.parse(String(init?.body))).not.toHaveProperty(
        "code_verifier",
      );
      return new Response(JSON.stringify({ error: "secret provider detail" }), {
        status: 401,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWorkspaceConnectionProvider("notion")!;
    const exchange = exchangeWorkspaceProviderOAuthCode({
      providerId: "notion",
      provider,
      clientId: "notion-client",
      clientSecret: "notion-secret",
      code: "code",
      verifier: "verifier",
      redirectUri: "https://app.example.com/callback",
    });

    await expect(exchange).rejects.toThrow(
      "Notion OAuth token exchange failed (401).",
    );
    await expect(exchange).rejects.not.toThrow("secret provider detail");
  });

  it("exchanges Google authorization codes as a confidential web client", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(init?.headers).not.toHaveProperty("Authorization");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe("google-client");
      expect(body.get("client_secret")).toBe("google-secret");
      return new Response(
        JSON.stringify({
          access_token: "google-access",
          refresh_token: "google-refresh",
          expires_in: 3600,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = getWorkspaceConnectionProvider("google_drive")!;

    const tokens = await exchangeWorkspaceProviderOAuthCode({
      providerId: "google_drive",
      provider,
      clientId: "google-client",
      clientSecret: "google-secret",
      code: "code",
      verifier: "unused-verifier",
      redirectUri: "https://app.example.com/callback",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.any(Object),
    );
    expect(tokens).toMatchObject({
      access_token: "google-access",
      refresh_token: "google-refresh",
      expiry_date: expect.any(Number),
    });
  });

  it("resolves Google account identity through the bounded Drive about endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            user: {
              permissionId: "drive-permission-1",
              emailAddress: "designer@example.com",
              displayName: "Designer",
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveWorkspaceProviderIdentity("google_drive", {
        access_token: "google-access",
      }),
    ).resolves.toEqual({
      accountId: "drive-permission-1",
      label: "designer@example.com",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/drive/v3/about?fields="),
      expect.objectContaining({
        headers: { Authorization: "Bearer google-access" },
      }),
    );
  });

  it("rejects oversized provider responses before parsing them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-length": String(300 * 1024) },
          }),
      ),
    );
    const provider = getWorkspaceConnectionProvider("figma")!;

    await expect(
      exchangeWorkspaceProviderOAuthCode({
        providerId: "figma",
        provider,
        clientId: "figma-client",
        clientSecret: "figma-secret",
        code: "code",
        verifier: "verifier",
        redirectUri: "https://app.example.com/callback",
      }),
    ).rejects.toThrow("Figma OAuth response exceeded the size limit.");
  });
});
