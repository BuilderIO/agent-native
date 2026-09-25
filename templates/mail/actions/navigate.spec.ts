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
