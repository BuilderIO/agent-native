import { describe, expect, it, vi } from "vitest";

import {
  addFirstPartyRemoteServer,
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
