import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  save: vi.fn(),
}));
const getUserSettingMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("./oauth-client.js", () => ({
  deleteMcpOAuthCredentials: oauthMocks.delete,
  getMcpOAuthAccessToken: vi.fn(),
  revokeMcpOAuthCredentials: vi.fn(),
  saveMcpOAuthCredentials: oauthMocks.save,
}));

vi.mock("../settings/user-settings.js", () => ({
  deleteUserSetting: vi.fn(),
  getUserSetting: getUserSettingMock,
  putUserSetting: putUserSettingMock,
}));

import {
  addFirstPartyRemoteServer,
  addOAuthRemoteServer,
  addRemoteServer,
  isFirstPartyRemoteEndpointTrusted,
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
    expect(putUserSettingMock).toHaveBeenCalledWith(
      "user@example.com",
      expect.any(String),
      expect.objectContaining({
        servers: [expect.objectContaining({ url: "https://mcp.example.com/" })],
      }),
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
    expect(oauthMocks.delete).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: "https://mcp.example.com/" }),
    );
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
