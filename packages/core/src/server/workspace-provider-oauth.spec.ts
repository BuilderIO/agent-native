import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceConnectionProvider } from "../connections/catalog.js";
import {
  buildWorkspaceProviderAuthorizationUrl,
  canConnectWorkspaceProviderOAuth,
  exchangeWorkspaceProviderOAuthCode,
  isWorkspaceProviderOAuthFlowValid,
  mergeWorkspaceOAuthValues,
  resolveWorkspaceProviderIdentity,
  resolveWorkspaceProviderIdentities,
  scopedOAuthAccountId,
  type WorkspaceProviderOAuthFlow,
} from "./workspace-provider-oauth.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace provider OAuth", () => {
  it("allows shared OAuth connections only for organization owners and admins", () => {
    expect(canConnectWorkspaceProviderOAuth("org-1", "owner")).toBe(true);
    expect(canConnectWorkspaceProviderOAuth("org-1", "admin")).toBe(true);
    expect(canConnectWorkspaceProviderOAuth("org-1", "member")).toBe(false);
    expect(canConnectWorkspaceProviderOAuth("org-1", null)).toBe(false);
    expect(canConnectWorkspaceProviderOAuth(null, null)).toBe(false);
  });

  it("keeps portal and site OAuth token keys owner-scoped", () => {
    expect(scopedOAuthAccountId("hubspot", "ada@example.com", "12345")).toBe(
      "12345::0ea25af177e09e3cb26331b4",
    );
    expect(scopedOAuthAccountId("hubspot", "ada@example.com", "12345")).toBe(
      scopedOAuthAccountId("hubspot", "ada@example.com", "12345"),
    );
    expect(
      scopedOAuthAccountId("hubspot", "grace@example.com", "12345"),
    ).not.toBe(scopedOAuthAccountId("hubspot", "ada@example.com", "12345"));
    expect(scopedOAuthAccountId("figma", "ada@example.com", "figma-1")).toBe(
      "figma-1",
    );
  });

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

  it("builds a GitHub authorization request from shared catalog metadata", () => {
    const provider = getWorkspaceConnectionProvider("github")!;
    const url = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        provider,
        clientId: "github-client",
        redirectUri:
          "https://app.example.com/_agent-native/connections/oauth/github/callback",
        state: "signed-state",
        challenge: "unused-challenge",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "github-client",
      response_type: "code",
      state: "signed-state",
      allow_signup: "true",
    });
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["repo", "read:org", "read:user", "user:email"]),
    );
  });

  it("builds an Atlassian 3LO authorization request for Jira Cloud", () => {
    const provider = getWorkspaceConnectionProvider("jira")!;
    const url = new URL(
      buildWorkspaceProviderAuthorizationUrl({
        provider,
        clientId: "jira-client",
        redirectUri:
          "https://app.example.com/_agent-native/connections/oauth/jira/callback",
        state: "signed-state",
        challenge: "unused-challenge",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://auth.atlassian.com/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      audience: "api.atlassian.com",
      client_id: "jira-client",
      prompt: "consent",
      response_type: "code",
      state: "signed-state",
    });
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining([
        "read:jira-work",
        "read:jira-user",
        "offline_access",
      ]),
    );
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

  it("exchanges GitHub authorization codes with bounded JSON responses", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        client_id: "github-client",
        client_secret: "github-secret",
        code: "code",
        redirect_uri: "https://app.example.com/callback",
      });
      return new Response(JSON.stringify({ access_token: "github-token" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWorkspaceConnectionProvider("github")!;
    await expect(
      exchangeWorkspaceProviderOAuthCode({
        providerId: "github",
        provider,
        clientId: "github-client",
        clientSecret: "github-secret",
        code: "code",
        verifier: "unused-verifier",
        redirectUri: "https://app.example.com/callback",
      }),
    ).resolves.toMatchObject({ access_token: "github-token" });
  });

  it("exchanges Jira authorization codes as JSON and discovers every accessible site", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth/token")) {
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/json",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          grant_type: "authorization_code",
          client_id: "jira-client",
        });
        return new Response(
          JSON.stringify({ access_token: "jira-token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            id: "cloud-1",
            name: "One",
            url: "https://one.atlassian.net",
            scopes: ["read:jira-work"],
          },
          {
            id: "cloud-2",
            name: "Two",
            url: "https://two.atlassian.net",
            scopes: ["read:jira-user"],
          },
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWorkspaceConnectionProvider("jira")!;
    const tokens = await exchangeWorkspaceProviderOAuthCode({
      providerId: "jira",
      provider,
      clientId: "jira-client",
      clientSecret: "jira-secret",
      code: "code",
      verifier: "verifier",
      redirectUri: "https://app.example.com/callback",
    });
    expect(tokens).toMatchObject({
      access_token: "jira-token",
      expiry_date: expect.any(Number),
    });

    const identities = await resolveWorkspaceProviderIdentities("jira", tokens);
    expect(identities).toEqual([
      expect.objectContaining({
        accountId: "cloud-1",
        label: "One",
        config: expect.objectContaining({
          atlassianApiBaseUrl: "https://api.atlassian.com/ex/jira/cloud-1",
        }),
      }),
      expect.objectContaining({ accountId: "cloud-2", label: "Two" }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer jira-token",
        }),
      }),
    );
  });

  it("exchanges HubSpot authorization codes as a form-encoded request", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe("hubspot-client");
      expect(body.get("client_secret")).toBe("hubspot-secret");
      expect(body.get("grant_type")).toBe("authorization_code");
      return new Response(
        JSON.stringify({
          access_token: "hubspot-token",
          refresh_token: "hubspot-refresh",
          expires_in: 1800,
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWorkspaceConnectionProvider("hubspot")!;
    await expect(
      exchangeWorkspaceProviderOAuthCode({
        providerId: "hubspot",
        provider,
        clientId: "hubspot-client",
        clientSecret: "hubspot-secret",
        code: "code",
        verifier: "unused-verifier",
        redirectUri: "https://app.example.com/callback",
      }),
    ).resolves.toMatchObject({
      access_token: "hubspot-token",
      refresh_token: "hubspot-refresh",
      expiry_date: expect.any(Number),
    });
  });

  it("exchanges Sentry authorization codes with PKCE", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe("sentry-client");
      expect(body.get("client_secret")).toBe("sentry-secret");
      expect(body.get("code_verifier")).toBe("verifier");
      return new Response(
        JSON.stringify({
          access_token: "sentry-token",
          refresh_token: "sentry-refresh",
          expires_in: 2_592_000,
          user: { id: "sentry-user", email: "dev@example.com" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = getWorkspaceConnectionProvider("sentry")!;
    await expect(
      exchangeWorkspaceProviderOAuthCode({
        providerId: "sentry",
        provider,
        clientId: "sentry-client",
        clientSecret: "sentry-secret",
        code: "code",
        verifier: "verifier",
        redirectUri: "https://app.example.com/callback",
      }),
    ).resolves.toMatchObject({
      access_token: "sentry-token",
      refresh_token: "sentry-refresh",
      expiry_date: expect.any(Number),
    });
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

  it("resolves GitHub account identity without exposing the access token", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ login: "octocat", name: "Octo Cat" }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveWorkspaceProviderIdentity("github", {
        access_token: "github-access",
      }),
    ).resolves.toEqual({ accountId: "octocat", label: "Octo Cat" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-access",
        }),
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

it("resolves HubSpot portal identity through the token metadata endpoint", async () => {
  const fetchMock = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({ hub_id: 12345, hub_domain: "example.hubspot.com" }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    resolveWorkspaceProviderIdentity("hubspot", {
      access_token: "hubspot-access",
    }),
  ).resolves.toEqual({
    accountId: "12345",
    label: "example.hubspot.com",
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.hubapi.com/oauth/v1/access-tokens/hubspot-access",
    expect.objectContaining({
      headers: { Accept: "application/json" },
    }),
  );
});

it("resolves Sentry account identity through the authenticated user endpoint", async () => {
  const fetchMock = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({ id: "sentry-user", email: "dev@example.com" }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    resolveWorkspaceProviderIdentity("sentry", {
      access_token: "sentry-access",
    }),
  ).resolves.toEqual({
    accountId: "sentry-user",
    label: "dev@example.com",
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://sentry.io/api/0/users/me/",
    expect.objectContaining({
      headers: {
        Accept: "application/json",
        Authorization: "Bearer sentry-access",
      },
    }),
  );
});
