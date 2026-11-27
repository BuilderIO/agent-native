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

  it("reports the reading pane on unless it was turned off", async () => {
    await expect(action.run({})).resolves.toEqual(
      expect.objectContaining({ readingPane: true }),
    );

    mocks.getUserSetting.mockResolvedValue({ previewPane: "off" });
    await expect(action.run({})).resolves.toEqual(
      expect.objectContaining({ readingPane: false }),
    );
  });

  it("reports Meetings, Notes and Recent on and Attachments off until changed", async () => {
    await expect(action.run({})).resolves.toEqual(
      expect.objectContaining({
        contactPanelWidgets: {
          meetings: true,
          notes: true,
          attachments: false,
          recent: true,
        },
      }),
    );

    mocks.getUserSetting.mockResolvedValue({
      contactPanelWidgets: { notes: false, attachments: true },
    });
    await expect(action.run({})).resolves.toEqual(
      expect.objectContaining({
        contactPanelWidgets: {
          meetings: true,
          notes: false,
          attachments: true,
          recent: true,
        },
      }),
    );
  });
});
