import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: mocks.putUserSetting,
}));

import action from "./update-mail-settings";

describe("update-mail-settings action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getUserSetting.mockResolvedValue({
      writingStyle: "Keep it concise.",
      signature: "Best,",
      autocompleteEnabled: false,
      sendAndArchive: false,
    });
    mocks.putUserSetting.mockResolvedValue(undefined);
  });

  it("updates autocomplete while preserving unrelated drafting settings", async () => {
    const result = await action.run({ autocompleteEnabled: true });

    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        signature: "Best,",
        autocompleteEnabled: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        signature: "Best,",
        autocompleteEnabled: true,
      }),
    );
  });

  it("updates Send + Mark Done while preserving drafting settings", async () => {
    const result = await action.run({ sendAndArchive: true });

    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        signature: "Best,",
        autocompleteEnabled: false,
        sendAndArchive: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        signature: "Best,",
        sendAndArchive: true,
      }),
    );
  });
});
