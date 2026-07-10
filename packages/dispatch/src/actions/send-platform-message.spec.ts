import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstallation: vi.fn(),
  resolveTokenBundle: vi.fn(),
  resolveSecret: vi.fn(),
  sendMessageToTarget: vi.fn(),
  getDestinationById: vi.fn(),
  slackAdapter: vi.fn(),
}));

vi.mock("@agent-native/core/integrations", () => ({
  listIntegrationInstallations: mocks.getInstallation,
  resolveIntegrationTokenBundle: mocks.resolveTokenBundle,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => "member@example.com",
  getRequestOrgId: () => "org-a",
  resolveSecret: mocks.resolveSecret,
  isEmailConfigured: vi.fn(),
  slackAdapter: mocks.slackAdapter,
  telegramAdapter: vi.fn(),
  emailAdapter: vi.fn(),
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  getDestinationById: mocks.getDestinationById,
}));

const action = (await import("./send-platform-message.js")).default;

describe("send-platform-message tenant scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDestinationById.mockResolvedValue(null);
    mocks.resolveSecret.mockResolvedValue(null);
    mocks.slackAdapter.mockImplementation(
      (options: { resolveBotToken: () => Promise<string | undefined> }) => ({
        formatAgentResponse: (text: string) => ({
          text,
          platformContext: {},
        }),
        sendMessageToTarget: async (...args: unknown[]) => {
          expect(await options.resolveBotToken()).toBe("own-managed-token");
          return mocks.sendMessageToTarget(...args);
        },
      }),
    );
  });

  it("resolves and uses only the caller org's Slack installation", async () => {
    mocks.getInstallation.mockResolvedValue([
      {
        id: "installation-a",
        installationKey: "team:T1:app:A1",
        teamId: "T1",
        enterpriseId: null,
      },
    ]);
    mocks.resolveTokenBundle.mockResolvedValue({
      accessToken: "own-managed-token",
    });

    await action.run(
      {
        platform: "slack",
        destination: "C1",
        tenantId: "T1",
        text: "hello",
      },
      {} as never,
    );

    expect(mocks.getInstallation).toHaveBeenCalledWith(
      {
        userEmail: "member@example.com",
        orgId: "org-a",
      },
      "slack",
    );
    expect(mocks.resolveTokenBundle).toHaveBeenCalledWith(
      "slack",
      "team:T1:app:A1",
    );
    expect(mocks.sendMessageToTarget).toHaveBeenCalledOnce();
  });

  it("does not use another org's managed installation", async () => {
    mocks.getInstallation.mockResolvedValue([]);

    await expect(
      action.run(
        {
          platform: "slack",
          destination: "C1",
          tenantId: "T-other",
          text: "hello",
        },
        {} as never,
      ),
    ).rejects.toThrow("That Slack workspace is not connected");

    expect(mocks.resolveTokenBundle).not.toHaveBeenCalled();
    expect(mocks.slackAdapter).not.toHaveBeenCalled();
    expect(mocks.sendMessageToTarget).not.toHaveBeenCalled();
  });
});
