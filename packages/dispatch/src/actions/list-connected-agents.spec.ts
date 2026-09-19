import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverAgents: vi.fn(),
  getBuiltinAgents: vi.fn(),
  getRequestUserEmail: vi.fn(() => "owner@example.test"),
  resourceGet: vi.fn(),
  resourceListAccessible: vi.fn(async () => []),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/resources/metadata", () => ({
  parseRemoteAgentManifest: vi.fn(),
  REMOTE_AGENT_RESOURCE_PREFIXES: [],
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
  normalizeAgentId: (id: string) => id.trim().toLowerCase(),
  shouldIncludeRemoteAgentManifest: vi.fn(),
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
});
