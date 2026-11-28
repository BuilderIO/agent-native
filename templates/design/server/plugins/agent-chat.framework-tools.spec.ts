import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAgentChatPlugin: vi.fn((options: unknown) => ({ options })),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  createAgentChatPlugin: mocks.createAgentChatPlugin,
}));

vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));

import agentChatPlugin from "./agent-chat.js";

describe("design agent chat plugin", () => {
  it("leaves out the cross-app call-agent and describe-workspace-apps tools", () => {
    expect(agentChatPlugin).toBeDefined();
    expect(mocks.createAgentChatPlugin).toHaveBeenCalledTimes(1);
    const options = mocks.createAgentChatPlugin.mock.calls[0]?.[0] as {
      frameworkTools?: Record<string, unknown>;
    };
    expect(options.frameworkTools).toMatchObject({ workspaceApps: false });
  });
});
