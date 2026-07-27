import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listEnabledBuiltinMcpCapabilities,
  setBuiltinMcpCapabilityEnabled,
  setEnabledBuiltinMcpCapabilities,
} from "./builtin-store.js";

const settings = vi.hoisted(() => ({
  user: new Map<string, Record<string, unknown>>(),
  org: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: async (email: string, key: string) =>
    settings.user.get(`${email}:${key}`) ?? null,
  putUserSetting: async (
    email: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    settings.user.set(`${email}:${key}`, value);
  },
  deleteUserSetting: async (email: string, key: string) => {
    return settings.user.delete(`${email}:${key}`);
  },
}));

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: async (orgId: string, key: string) =>
    settings.org.get(`${orgId}:${key}`) ?? null,
  putOrgSetting: async (
    orgId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    settings.org.set(`${orgId}:${key}`, value);
  },
  deleteOrgSetting: async (orgId: string, key: string) => {
    return settings.org.delete(`${orgId}:${key}`);
  },
}));

describe("built-in MCP capability store", () => {
  beforeEach(() => {
    settings.user.clear();
    settings.org.clear();
  });

  it("defaults to all capabilities off when the setting is absent", async () => {
    await expect(
      listEnabledBuiltinMcpCapabilities("user", "alice@example.com"),
    ).resolves.toEqual([]);
  });

  it("stores normalized enabled ids", async () => {
    await setEnabledBuiltinMcpCapabilities("user", "alice@example.com", [
      "unknown",
      "browser-chrome-devtools",
      "browser-playwright",
    ]);

    await expect(
      listEnabledBuiltinMcpCapabilities("user", "alice@example.com"),
    ).resolves.toEqual(["browser-playwright"]);
  });

  it("enforces the exclusive browser group when toggling", async () => {
    await setBuiltinMcpCapabilityEnabled(
      "org",
      "acme",
      "browser-playwright",
      true,
    );
    await setBuiltinMcpCapabilityEnabled(
      "org",
      "acme",
      "browser-chrome-devtools",
      true,
    );

    await expect(
      listEnabledBuiltinMcpCapabilities("org", "acme"),
    ).resolves.toEqual(["browser-chrome-devtools"]);
  });

  it("deletes the setting when the last capability is disabled", async () => {
    await setBuiltinMcpCapabilityEnabled(
      "user",
      "alice@example.com",
      "browser-playwright",
      true,
    );
    await setBuiltinMcpCapabilityEnabled(
      "user",
      "alice@example.com",
      "browser-playwright",
      false,
    );

    expect(
      settings.user.has("alice@example.com:mcp-builtin-capabilities"),
    ).toBe(false);
  });
});
