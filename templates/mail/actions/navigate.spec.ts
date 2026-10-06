import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppStateForCurrentTab = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isJevEnabled: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab,
}));
vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  getRequestUserEmail: mocks.getRequestUserEmail,
  isJevEnabled: mocks.isJevEnabled,
}));

import action from "./navigate";

describe("Mail navigate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isJevEnabled.mockResolvedValue(false);
  });

  it("writes the command through the requesting tab's ambient state", async () => {
    await action.run({ view: "sent", threadId: "thread-1" });

    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "sent",
      threadId: "thread-1",
    });
  });

  it.each([
    ["rules", "/settings/app/rules"],
    ["ai-filter", "/settings/app/ai-filter"],
    ["slack", "/settings/channels/slack"],
    ["members", "/settings/members"],
    ["general", "/settings/app"],
  ] as const)(
    "opens the %s settings route in the requesting tab",
    async (settingsSection, pathname) => {
      await action.run({ settingsSection });

      expect(writeAppStateForCurrentTab).toHaveBeenCalledTimes(1);
      expect(writeAppStateForCurrentTab).toHaveBeenCalledWith(
        "__set_url__",
        expect.objectContaining({ pathname, mergeSearchParams: false }),
      );
    },
  );

  it("opens Mail › General for the bare settings view", async () => {
    await action.run({ view: "settings" });

    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "__set_url__",
      expect.objectContaining({ pathname: "/settings/app" }),
    );
  });

  it("rejects a settings section Mail doesn't have", () => {
    expect(
      action.schema.safeParse({ settingsSection: "automations" }).success,
    ).toBe(false);
  });

  it("rejects Priority navigation without Jev credentials", async () => {
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      builderAuth: null,
      personalApiKey: undefined,
    });

    await expect(action.run({ sort: "priority" })).rejects.toThrow(
      /Priority sort requires Jev/,
    );
    expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });
});
