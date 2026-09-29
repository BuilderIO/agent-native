import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsMock = vi.hoisted(() => ({
  listSettingsByKeySegments: vi.fn(),
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  ...settingsMock,
}));

const { listHubServers } = await import("./hub-routes.js");

beforeEach(() => {
  settingsMock.listSettingsByKeySegments.mockReset();
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listHubServers", () => {
  it("loads only remote MCP settings across orgs", async () => {
    settingsMock.listSettingsByKeySegments.mockResolvedValue([
      {
        key: "o:acme:mcp-servers-remote",
        value: {
          servers: [
            {
              id: "drive",
              name: "Drive",
              url: "https://mcp.example.test/mcp",
            },
          ],
        },
      },
      {
        key: "u:alice@example.com:mcp-servers-remote",
        value: {
          servers: [
            {
              id: "private",
              name: "Private",
              url: "https://private.example.test/mcp",
            },
          ],
        },
      },
    ]);

    await expect(listHubServers()).resolves.toEqual([
      {
        id: "acme-Drive",
        orgId: "acme",
        name: "Drive",
        url: "https://mcp.example.test/mcp",
        headers: undefined,
        description: undefined,
      },
    ]);
    expect(settingsMock.listSettingsByKeySegments).toHaveBeenCalledWith([
      "mcp-servers-remote",
    ]);
  });

  it("preserves settings read failures", async () => {
    const error = new Error("database unavailable");
    settingsMock.listSettingsByKeySegments.mockRejectedValue(error);

    await expect(listHubServers()).rejects.toBe(error);
  });
});
