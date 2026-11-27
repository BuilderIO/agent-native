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

  it("turns the reading pane off and back on without touching drafting settings", async () => {
    const off = await action.run({ readingPane: false });

    expect(mocks.putUserSetting).toHaveBeenLastCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        signature: "Best,",
        previewPane: "off",
      }),
    );
    expect(off).toEqual(expect.objectContaining({ readingPane: false }));

    mocks.getUserSetting.mockResolvedValue({
      writingStyle: "Keep it concise.",
      previewPane: "off",
    });
    const on = await action.run({ readingPane: true });

    expect(mocks.putUserSetting).toHaveBeenLastCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({ previewPane: "right" }),
    );
    expect(on).toEqual(expect.objectContaining({ readingPane: true }));
  });

  it("combines and splits the inbox tabs without touching drafting settings", async () => {
    const combined = await action.run({ splitInbox: false });

    expect(mocks.putUserSetting).toHaveBeenLastCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        signature: "Best,",
        combineInbox: true,
      }),
    );
    expect(combined).toEqual(expect.objectContaining({ splitInbox: false }));

    mocks.getUserSetting.mockResolvedValue({
      writingStyle: "Keep it concise.",
      combineInbox: true,
    });
    const split = await action.run({ splitInbox: true });

    expect(mocks.putUserSetting).toHaveBeenLastCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({ combineInbox: false }),
    );
    expect(split).toEqual(expect.objectContaining({ splitInbox: true }));
  });

  it("switches one built-in panel widget and keeps the others", async () => {
    mocks.getUserSetting.mockResolvedValue({
      writingStyle: "Keep it concise.",
      contactPanelWidgets: { notes: false, attachments: false, recent: true },
    });

    const result = await action.run({
      contactPanelWidgets: { attachments: true },
    });

    expect(mocks.putUserSetting).toHaveBeenLastCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.objectContaining({
        writingStyle: "Keep it concise.",
        contactPanelWidgets: {
          meetings: true,
          notes: false,
          attachments: true,
          recent: true,
        },
      }),
    );
    expect(result.contactPanelWidgets).toEqual({
      meetings: true,
      notes: false,
      attachments: true,
      recent: true,
    });
  });
});
