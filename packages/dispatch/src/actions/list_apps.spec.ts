import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listGrantedApps: vi.fn(),
  hideHostedAppsWhenOff: vi.fn(async <T>(apps: T[]) => apps),
}));

vi.mock("../server/lib/hosted-apps-settings.js", () => ({
  hideHostedAppsWhenOff: mocks.hideHostedAppsWhenOff,
}));

vi.mock("../server/lib/mcp-gateway.js", () => ({
  listGrantedDispatchMcpApps: mocks.listGrantedApps,
}));

import listApps from "./list_apps.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hideHostedAppsWhenOff.mockImplementation(async (apps) => apps);
  mocks.listGrantedApps.mockResolvedValue([
    {
      id: "slides",
      name: "Slides",
      description: "Create presentations",
      url: "https://slides.example.test",
    },
    {
      id: "analytics",
      name: "Analytics",
      description: "Answer data questions",
      url: "https://analytics.example.test",
    },
  ]);
});

describe("list_apps", () => {
  it("leaves out apps the hosted apps setting hides", async () => {
    mocks.hideHostedAppsWhenOff.mockImplementation(async (apps) =>
      apps.filter((app: { id: string }) => app.id !== "analytics"),
    );
    const result = await listApps.run({});
    expect(result.apps.map((app: { id: string }) => app.id)).toEqual([
      "slides",
    ]);
  });

  it("returns a compact valid JSON message for MCP hosts", async () => {
    const result = await listApps.run({});

    expect(JSON.parse(result.message)).toEqual({
      apps: [
        { id: "slides", name: "Slides" },
        { id: "analytics", name: "Analytics" },
      ],
    });
    expect(result.apps).toEqual([
      expect.objectContaining({
        id: "slides",
        url: "https://slides.example.test",
      }),
      expect.objectContaining({
        id: "analytics",
        url: "https://analytics.example.test",
      }),
    ]);
  });

  it("lists only what the gateway discovered, so disabled built-ins never appear", async () => {
    mocks.listGrantedApps.mockResolvedValue([
      {
        id: "crm",
        name: "CRM",
        description: "Workspace app",
        url: "https://workspace.example.test/crm",
      },
    ]);

    const result = await listApps.run({});

    expect(JSON.parse(result.message)).toEqual({
      apps: [{ id: "crm", name: "CRM" }],
    });
  });
});
