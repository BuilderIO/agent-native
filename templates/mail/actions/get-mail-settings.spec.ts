import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

import action from "./get-mail-settings";

describe("get-mail-settings action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getUserSetting.mockResolvedValue({
      writingStyle: "Keep it concise.",
    });
  });

  it("returns autocomplete disabled when no saved preference exists", async () => {
    await expect(action.run({})).resolves.toEqual(
      expect.objectContaining({
        email: "owner@example.com",
        autocompleteEnabled: false,
        sendAndArchive: false,
      }),
    );
  });

  it("returns the saved autocomplete preference with other drafting settings", async () => {
    mocks.getUserSetting.mockResolvedValue({
      signature: "Best,",
      writingStyle: "Keep it concise.",
      autocompleteEnabled: true,
      sendAndArchive: true,
    });

    await expect(action.run({})).resolves.toEqual(
      expect.objectContaining({
        signature: "Best,",
        writingStyle: "Keep it concise.",
        autocompleteEnabled: true,
        sendAndArchive: true,
      }),
    );
  });
});
