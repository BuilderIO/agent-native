import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  revoke: vi.fn(),
  save: vi.fn(),
}));
const getUserSettingMock = vi.hoisted(() => vi.fn());
const mutateUserSettingMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());
const deleteUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("./oauth-client.js", () => ({
  deleteMcpOAuthCredentials: oauthMocks.delete,
  getMcpOAuthAccessToken: vi.fn(),
  revokeMcpOAuthCredentials: oauthMocks.revoke,
  saveMcpOAuthCredentials: oauthMocks.save,
}));

vi.mock("../settings/user-settings.js", () => ({
  deleteUserSetting: deleteUserSettingMock,
  getUserSetting: getUserSettingMock,
  mutateUserSetting: mutateUserSettingMock,
  putUserSetting: putUserSettingMock,
}));

import {
  addFirstPartyRemoteServer,
  addOAuthRemoteServer,
  addRemoteServer,
  isFirstPartyRemoteEndpointTrusted,
  removeRemoteServer,
  replaceOAuthRemoteServer,
  toHttpServerConfig,
  toHttpServerConfigAsync,
  validateRemoteUrl,
} from "./remote-store.js";

const fetchOrgAppsMock = vi.hoisted(() => vi.fn());

vi.mock("../mcp/org-directory.js", () => ({
  fetchOrgApps: fetchOrgAppsMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  getUserSettingMock.mockResolvedValue(null);
  mutateUserSettingMock.mockImplementation(
    async (
      _email: string,
      _key: string,
      updater: (value: unknown) => unknown,
    ) =>
      updater({
        servers: [
          {
            id: "mcps_oauth",
            name: "sigma",
            url: "https://mcp.example.com/",
            oauthSecretKey: "mcp_oauth:old",
            createdAt: 1,
          },
        ],
      }),
  );
  oauthMocks.revoke.mockResolvedValue({
    remote: "succeeded",
    local: "deleted",
  });
});

describe("validateRemoteUrl", () => {
  it("rejects bracketed IPv6 loopback and private hosts", () => {
    for (const url of [
      "https://[::1]/mcp",
      "https://[fd00::1]/mcp",
      "https://[fc00::1]/mcp",
      "https://[fe80::1]/mcp",
      "https://[::ffff:127.0.0.1]/mcp",
    ]) {
      expect(validateRemoteUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("continues to allow localhost over plain http for local development", () => {
    expect(validateRemoteUrl("http://localhost:3000/mcp")).toMatchObject({
      ok: true,
    });
    expect(validateRemoteUrl("http://127.0.0.1:3000/mcp")).toMatchObject({
      ok: true,
    });
  });

  it("rejects private IPv4 and non-local plain http URLs", () => {
    expect(validateRemoteUrl("https://10.0.0.5/mcp")).toMatchObject({
      ok: false,
    });
    expect(validateRemoteUrl("http://example.com/mcp")).toMatchObject({
      ok: false,
    });
  });
});

describe("OAuth remote MCP metadata", () => {
  it("stores the canonical OAuth resource URL on the server", async () => {
    await expect(
      addOAuthRemoteServer("user", "user@example.com", {
        name: "example",
        url: "https://mcp.example.com",
        credentials: {
          serverUrl: "https://mcp.example.com",
          clientInformation: {
            client_id: "example-client",
            redirect_uris: ["https://app.example.com/callback"],
          },
          tokens: {
            access_token: "<ACCESS_TOKEN>",
            token_type: "bearer",
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      server: { url: "https://mcp.example.com/" },
    });
    expect(mutateUserSettingMock).toHaveBeenCalledWith(
      "user@example.com",
      expect.any(String),
      expect.any(Function),
    );
  });

  it("replaces an OAuth grant in place while preserving the server id", async () => {
    getUserSettingMock.mockResolvedValueOnce({
      servers: [
        {
          id: "mcps_oauth",
          name: "sigma",
          url: "https://mcp.example.com/",
          oauthSecretKey: "mcp_oauth:old",
          createdAt: 1,
        },
      ],
    });

    await expect(
      replaceOAuthRemoteServer("user", "user@example.com", "mcps_oauth", {
        serverUrl: "https://mcp.example.com",
        clientInformation: {
          client_id: "example-client",
          redirect_uris: ["https://app.example.com/callback"],
        },
        tokens: {
          access_token: "<NEW_ACCESS_TOKEN>",
          token_type: "bearer",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      server: {
        id: "mcps_oauth",
        name: "sigma",
        oauthSecretKey: expect.stringMatching(/^mcp_oauth:/),
      },
    });

    expect(mutateUserSettingMock).toHaveBeenCalledWith(
      "user@example.com",
      expect.any(String),
      expect.any(Function),
    );
    expect(oauthMocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "mcp_oauth:old",
        serverUrl: "https://mcp.example.com/",
      }),
    );
  });

  it("keeps the server manageable when OAuth custody is concurrently replaced", async () => {
    getUserSettingMock.mockResolvedValueOnce({
      servers: [
        {
          id: "mcps_oauth",
          name: "example",
          url: "https://mcp.example.com/",
          oauthSecretKey: "mcp_oauth:test",
          createdAt: 1,
        },
      ],
    });
    oauthMocks.revoke.mockResolvedValueOnce({
      remote: "not_attempted",
      local: "replaced",
    });

    await expect(
      removeRemoteServer("user", "user@example.com", "mcps_oauth"),
    ).resolves.toBe(false);

    expect(deleteUserSettingMock).not.toHaveBeenCalled();
    expect(putUserSettingMock).not.toHaveBeenCalled();
  });

  it("keeps the replacement row when old-grant cleanup fails", async () => {
    const current = {
      servers: [
        {
          id: "mcps_oauth",
          name: "sigma",
          url: "https://mcp.example.com/",
          oauthSecretKey: "mcp_oauth:old",
          createdAt: 1,
        },
      ],
    };
    getUserSettingMock.mockResolvedValueOnce(current);
    mutateUserSettingMock.mockImplementationOnce(
      async (
        _email: string,
        _key: string,
        updater: (value: unknown) => unknown,
      ) => updater(current),
    );
    oauthMocks.revoke.mockRejectedValueOnce(new Error("old grant unavailable"));

    await expect(
      replaceOAuthRemoteServer("user", "user@example.com", "mcps_oauth", {
        serverUrl: "https://mcp.example.com",
        clientInformation: { client_id: "example-client" },
        tokens: { access_token: "<NEW_ACCESS_TOKEN>", token_type: "bearer" },
      }),
    ).resolves.toMatchObject({ ok: true, server: { id: "mcps_oauth" } });
    expect(oauthMocks.revoke).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a newer OAuth replacement after a CAS conflict", async () => {
    const current = {
      servers: [
        {
          id: "mcps_oauth",
          name: "sigma",
          url: "https://mcp.example.com/",
          oauthSecretKey: "mcp_oauth:old",
          createdAt: 1,
        },
      ],
    };
    getUserSettingMock.mockResolvedValueOnce(current);
    mutateUserSettingMock.mockImplementationOnce(
      async (
        _email: string,
        _key: string,
        updater: (value: unknown) => unknown,
      ) =>
        updater({
          servers: [
            { ...current.servers[0], oauthSecretKey: "mcp_oauth:newer" },
          ],
        }),
    );

    await expect(
      replaceOAuthRemoteServer("user", "user@example.com", "mcps_oauth", {
        serverUrl: "https://mcp.example.com",
        clientInformation: { client_id: "example-client" },
        tokens: { access_token: "<NEW_ACCESS_TOKEN>", token_type: "bearer" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("MCP server changed while reconnecting"),
    });
    expect(oauthMocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringMatching(/^mcp_oauth:/) }),
    );
  });

  it("rejects a server URL that differs from the credential resource", async () => {
    await expect(
      addOAuthRemoteServer("user", "user@example.com", {
        name: "example",
        url: "https://mcp.example.com/mcp/",
        credentials: {
          serverUrl: "https://mcp.example.com/mcp",
          clientInformation: {
            client_id: "example-client",
            redirect_uris: ["https://app.example.com/callback"],
          },
          tokens: {
            access_token: "<ACCESS_TOKEN>",
            token_type: "bearer",
          },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: "MCP server URL must match the OAuth credential resource URL",
    });
  });

  it("uses the canonical resource when failed registration cleans up", async () => {
    getUserSettingMock.mockResolvedValueOnce({
      servers: [
        {
          id: "mcps_existing",
          name: "example",
          url: "https://existing.example.com/mcp",
          createdAt: 1,
        },
      ],
    });

    await expect(
      addOAuthRemoteServer("user", "user@example.com", {
        name: "example",
        url: "https://mcp.example.com",
        credentials: {
          serverUrl: "https://mcp.example.com",
          clientInformation: {
            client_id: "example-client",
            redirect_uris: ["https://app.example.com/callback"],
          },
          tokens: {
            access_token: "<ACCESS_TOKEN>",
            token_type: "bearer",
          },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      error: 'A server named "example" already exists',
    });
    expect(oauthMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          serverUrl: "https://mcp.example.com/",
        }),
      }),
    );
    expect(oauthMocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: "https://mcp.example.com/" }),
    );
  });

  it("revokes credentials when registration throws after the grant is saved", async () => {
    mutateUserSettingMock.mockRejectedValueOnce(
      new Error("settings unavailable"),
    );

    await expect(
      addOAuthRemoteServer("user", "user@example.com", {
        name: "example",
        url: "https://mcp.example.com",
        credentials: {
          serverUrl: "https://mcp.example.com",
          clientInformation: {
            client_id: "example-client",
            redirect_uris: ["https://app.example.com/callback"],
          },
          tokens: {
            access_token: "<ACCESS_TOKEN>",
            token_type: "bearer",
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false });

    expect(oauthMocks.save).toHaveBeenCalledTimes(1);
    expect(oauthMocks.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: "https://mcp.example.com/" }),
    );
    expect(oauthMocks.delete).not.toHaveBeenCalled();
  });
});

describe("first-party remote MCP metadata", () => {
  it("rejects first-party registration through the generic remote API", async () => {
    await expect(
      addRemoteServer("org", "org-1", {
        name: "assets",
        url: "https://assets.example.com/_agent-native/mcp",
        firstParty: true,
      }),
    ).resolves.toEqual({
      ok: false,
      error:
        "First-party MCP servers must be registered through the trusted first-party registration path",
    });
  });

  it("rejects first-party registration when the endpoint origin is not in the org directory", async () => {
    fetchOrgAppsMock.mockResolvedValueOnce([
      {
        id: "assets",
        name: "Assets",
        url: "https://assets.example.com",
        a2aUrl: "https://assets.example.com",
      },
    ]);

    await expect(
      addFirstPartyRemoteServer("org-1", {
        appId: "assets",
        name: "assets",
        url: "https://evil.example/_agent-native/mcp",
      }),
    ).resolves.toEqual({
      ok: false,
      error:
        "First-party MCP URL does not match the org-directory app endpoint",
    });
  });

  it("accepts base-path first-party MCP endpoints from the org directory", async () => {
    fetchOrgAppsMock.mockResolvedValueOnce([
      {
        id: "assets",
        name: "Assets",
        url: "https://example.com/assets",
        a2aUrl: "https://example.com/assets",
      },
    ]);

    await expect(
      isFirstPartyRemoteEndpointTrusted(
        "org-1",
        "assets",
        "https://example.com/assets/_agent-native/mcp",
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects arbitrary same-origin first-party MCP endpoints", async () => {
    fetchOrgAppsMock.mockResolvedValueOnce([
      {
        id: "assets",
        name: "Assets",
        url: "https://example.com/assets",
        a2aUrl: "https://example.com/assets",
      },
    ]);

    await expect(
      isFirstPartyRemoteEndpointTrusted(
        "org-1",
        "assets",
        "https://example.com/_agent-native/mcp",
      ),
    ).resolves.toEqual({
      ok: false,
      error:
        "First-party MCP URL does not match the org-directory app endpoint",
    });
  });

  it("projects trusted first-party metadata into runtime http config", () => {
    expect(
      toHttpServerConfig({
        id: "mcps_test",
        name: "assets",
        url: "https://assets.example.com/_agent-native/mcp",
        firstParty: true,
        firstPartyAppId: "assets",
        createdAt: 1,
      }),
    ).toMatchObject({
      type: "http",
      firstParty: true,
      firstPartyAppId: "assets",
    });
  });

  it("projects first-party org id into async runtime http config", async () => {
    await expect(
      toHttpServerConfigAsync("org", "org-1", {
        id: "mcps_test",
        name: "assets",
        url: "https://assets.example.com/_agent-native/mcp",
        firstParty: true,
        firstPartyAppId: "assets",
        createdAt: 1,
      }),
    ).resolves.toMatchObject({
      type: "http",
      firstParty: true,
      firstPartyAppId: "assets",
      firstPartyOrgId: "org-1",
    });
  });
});
