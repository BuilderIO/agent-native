import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentChatPlugin: vi.fn((options: Record<string, unknown>) => options),
}));

vi.mock("@agent-native/core/server", () => ({
  createAgentChatPlugin: mocks.createAgentChatPlugin,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: vi.fn(),
}));

vi.mock("../../actions/index.js", () => ({
  dispatchActions: {},
}));

describe("Dispatch agent chat plugin", () => {
  it("opts delegated work into the durable background run contract", async () => {
    await import("./agent-chat.js");

    expect(mocks.createAgentChatPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "dispatch",
        durableBackgroundRuns: true,
        initialToolNames: expect.arrayContaining([
          "list-workspace-apps",
          "update-workspace-app-metadata",
        ]),
        mcp: {
          connectorCatalog: expect.arrayContaining([
            "start-workspace-app-creation",
          ]),
        },
      }),
    );
  });
});
