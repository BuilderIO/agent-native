import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  getBuiltinAgents: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.test"),
  resourceGet: vi.fn(),
  resourceListAccessible: vi.fn(async (): Promise<unknown[]> => []),
  parseRemoteAgentManifest: vi.fn(),
  shouldIncludeRemoteAgentManifest: vi.fn(() => true),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/resources/metadata", () => ({
  parseRemoteAgentManifest: (...args: unknown[]) =>
    mocks.parseRemoteAgentManifest(...args),
  REMOTE_AGENT_RESOURCE_PREFIXES: ["remote-agents/"],
}));

vi.mock("@agent-native/core/resources/store", () => ({
  resourceGet: (...args: unknown[]) => mocks.resourceGet(...args),
  resourceListAccessible: (...args: unknown[]) =>
    mocks.resourceListAccessible(...args),
  SHARED_OWNER: "shared",
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => mocks.getRequestUserEmail(),
}));

vi.mock("@agent-native/core/server/agent-discovery", () => ({
  discoverAgents: (...args: unknown[]) => mocks.discoverAgents(...args),
  getBuiltinAgents: (...args: unknown[]) => mocks.getBuiltinAgents(...args),
  isBuiltinAgentCatalogId: (id: string) =>
    ["calendar", "clips", "mail"].includes(id.trim().toLowerCase()),
  normalizeAgentId: (id: string) => id.trim().toLowerCase(),
  shouldIncludeRemoteAgentManifest: () =>
    mocks.shouldIncludeRemoteAgentManifest(),
}));

vi.mock("../server/index.js", () => ({
  getDispatchConfig: vi.fn(async () => ({ hiddenAgentIds: [] })),
}));

describe("list-connected-agents", () => {
  it("keeps a built-in app home URL separate from its A2A endpoint", async () => {
    mocks.getBuiltinAgents.mockReturnValue([
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com",
        color: "#000000",
      },
    ]);
    mocks.discoverAgents.mockResolvedValue([
      {
        id: "clips",
        name: "Clips",
        description: "Record and share",
        url: "https://clips.agent-native.com/share/WrA8ZQ3oxa2T?ref=clip_share",
        color: "#000000",
      },
    ]);

    const { default: action } = await import("./list-connected-agents.js");
    const [clips] = await action.run({});

    expect(clips).toMatchObject({
      id: "clips",
      url: "https://clips.agent-native.com/share/WrA8ZQ3oxa2T?ref=clip_share",
      homeUrl: "https://clips.agent-native.com",
      source: "builtin",
    });
  });

  it("does not surface seeded manifests for built-ins that are not enabled as custom agents", async () => {
    mocks.getBuiltinAgents.mockReturnValue([]);
    mocks.discoverAgents.mockResolvedValue([]);
    const manifests: Record<string, unknown> = {
      "res-mail": {
        id: "mail",
        name: "Mail",
        url: "https://mail.agent-native.com",
      },
      "res-partner": {
        id: "partner",
        name: "Partner",
        url: "https://partner.example.test",
      },
    };
    mocks.resourceListAccessible.mockImplementation(async () => [
      { id: "res-mail", path: "remote-agents/mail.json", owner: "shared" },
      {
        id: "res-partner",
        path: "remote-agents/partner.json",
        owner: "shared",
      },
    ]);
    mocks.resourceGet.mockImplementation(async (id: unknown) => ({
      content: String(id),
    }));
    mocks.parseRemoteAgentManifest.mockImplementation(
      (content: unknown) => manifests[String(content)],
    );

    const { default: action } = await import("./list-connected-agents.js");
    const agents = await action.run({});

    expect(agents.map((agent: { id: string }) => agent.id)).toEqual([
      "partner",
    ]);
    expect(agents[0]).toMatchObject({ source: "custom" });
  });
});
