import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  mutateUserSetting: mocks.mutateUserSetting,
}));

import action from "./update-mail-preferences";

describe("update-mail-preferences action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.mutateUserSetting.mockImplementation(async (_email, _key, updater) =>
      updater({
        email: "owner@example.com",
        pinnedLabels: ["important", "travel"],
        theme: "dark",
        signature: "Best",
      }),
    );
  });

  it("rebases a stale pinned-label write against the latest stored row", async () => {
    const result = await action.run({
      pinnedLabels: ["important", "sent"],
      pinnedLabelsBase: ["important"],
      theme: "light",
      requestSource: "tab-1",
    });

    expect(mocks.mutateUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "mail-settings",
      expect.any(Function),
      { requestSource: "tab-1" },
    );
    expect(result).toEqual(
      expect.objectContaining({
        email: "owner@example.com",
        pinnedLabels: ["important", "travel", "sent"],
        theme: "light",
      }),
    );
  });

  it("preserves existing pinned labels when updating a different field", async () => {
    mocks.mutateUserSetting.mockImplementation(async (_email, _key, fn) => {
      return fn({
        email: "owner@example.com",
        pinnedLabels: ["important", "starred"],
        theme: "dark",
      });
    });

    const result = await action.run({
      density: "compact",
      requestSource: "tab-2",
    });

    expect(result).toEqual(
      expect.objectContaining({
        pinnedLabels: ["important", "starred"],
        density: "compact",
      }),
    );
  });

  it("adds a new pin without losing an unrelated concurrent pin", async () => {
    const first = await action.run({
      pinnedLabels: ["important", "travel"],
      pinnedLabelsBase: ["important"],
      requestSource: "tab-a",
    });
    const second = await action.run({
      pinnedLabels: ["important", "sent"],
      pinnedLabelsBase: ["important"],
      requestSource: "tab-b",
    });

    expect(first.pinnedLabels).toEqual(["important", "travel"]);
    expect(second.pinnedLabels).toEqual(["important", "travel", "sent"]);
  });

  it("honors an explicit unpin while preserving a concurrent pin", async () => {
    const result = await action.run({
      pinnedLabels: [],
      pinnedLabelsBase: ["important"],
      requestSource: "tab-2",
    });

    expect(result.pinnedLabels).toEqual(["travel"]);
  });
});
