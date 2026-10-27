import { describe, expect, it, vi } from "vitest";

const createAgentChatPluginMock = vi.hoisted(() =>
  vi.fn((options: unknown) => options),
);

vi.mock("@agent-native/core/server", () => ({
  createAgentChatPlugin: createAgentChatPluginMock,
  loadActionsFromStaticRegistry: () => ({}),
}));
vi.mock("@agent-native/core/org", () => ({ getOrgContext: vi.fn() }));
vi.mock("@agent-native/dispatch/server", () => ({}));
vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));

import { WORKFLOW_JOB_APP_ID } from "../lib/factory-workflow-runner.js";
import "./agent-chat.js";

describe("the Factory agent-chat plugin", () => {
  it("runs workflow job files beside its own jobs under its own scheduler id", () => {
    expect(createAgentChatPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "factory",
        additionalJobAppIds: [WORKFLOW_JOB_APP_ID],
      }),
    );
  });

  it("loads the provider picker read on the first turn, where the recipe asks for ids", () => {
    expect(createAgentChatPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialToolNames: expect.arrayContaining(["list-provider-options"]),
      }),
    );
  });
});
