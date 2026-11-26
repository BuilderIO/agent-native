import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getSetting: mocks.getSetting,
  getSettingsEmitter: () => ({ emit: mocks.emit }),
}));

import { mutateContentUserSettingTransaction } from "./_user-setting-transaction.js";

describe("content user setting transaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSetting.mockResolvedValue(null);
  });

  it("publishes the owner scope after the transaction commits", async () => {
    await mutateContentUserSettingTransaction(
      async (callback) => callback({ execute: async () => ({ rows: [] }) }),
      "Alice@Example.test",
      "personal-view",
      () => ({ value: { activeViewId: "table" }, result: undefined }),
    );

    expect(mocks.emit).toHaveBeenCalledWith("settings", {
      source: "settings",
      type: "change",
      key: "u:alice@example.test:personal-view",
      owner: "alice@example.test",
    });
  });
});
