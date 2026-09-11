import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAccess: vi.fn(),
  parseJson: vi.fn(),
  testSlackConnection: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/lib/brain.js", () => ({
  parseJson: mocks.parseJson,
}));

vi.mock("../server/lib/connectors.js", () => ({
  testSlackConnection: mocks.testSlackConnection,
}));

import testSlackConnectionAction from "./test-slack-connection.js";

const action = testSlackConnectionAction as unknown as {
  run: (args: {
    sourceId?: string;
    channelRefs: string[];
    resolveNames: boolean;
  }) => Promise<unknown>;
};

describe("test-slack-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseJson.mockReturnValue({
      workspaceConnectionId: "connection-slack",
      channelIds: ["C-configured"],
    });
    mocks.testSlackConnection.mockResolvedValue({
      ok: true,
      checkedChannels: 1,
      channels: [],
      historyRead: false,
    });
  });

  it("validates a source through its bound workspace connection", async () => {
    mocks.resolveAccess.mockResolvedValue({
      resource: {
        id: "source-slack",
        provider: "slack",
        configJson: '{"workspaceConnectionId":"connection-slack"}',
      },
    });

    await action.run({
      sourceId: "source-slack",
      channelRefs: ["C-requested"],
      resolveNames: false,
    });

    expect(mocks.testSlackConnection).toHaveBeenCalledWith({
      channelRefs: ["C-requested"],
      resolveNames: false,
      workspaceConnectionId: "connection-slack",
    });
  });

  it("uses source-configured channels when no overrides are provided", async () => {
    mocks.resolveAccess.mockResolvedValue({
      resource: {
        id: "source-slack",
        provider: "slack",
        configJson: "{}",
      },
    });
    mocks.parseJson.mockReturnValue({ channelIds: ["C-configured"] });

    await action.run({
      sourceId: "source-slack",
      channelRefs: [],
      resolveNames: true,
    });

    expect(mocks.testSlackConnection).toHaveBeenCalledWith({
      channelRefs: ["C-configured"],
      resolveNames: true,
      workspaceConnectionId: undefined,
    });
  });
});
