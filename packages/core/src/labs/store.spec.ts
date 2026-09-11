import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("../settings/user-settings.js", () => mocks);

import {
  _resetLabRegistryForTests,
  registerLabs,
} from "./registry.js";
import {
  getUserLabs,
  normalizeLabValues,
  setUserLab,
} from "./store.js";

beforeEach(() => {
  _resetLabRegistryForTests();
  vi.clearAllMocks();
  registerLabs([{ key: "clips.editor" }, { key: "clips.meetings" }]);
});

describe("user labs", () => {
  it("defaults registered labs off and ignores stale values", () => {
    expect(
      normalizeLabValues({
        "clips.editor": true,
        "old-lab": true,
      }),
    ).toEqual({
      "clips.editor": true,
      "clips.meetings": false,
    });
  });

  it("reads and atomically updates one user's opt-in state", async () => {
    mocks.getUserSetting.mockResolvedValue({ "clips.meetings": true });
    expect(await getUserLabs("alice@example.com")).toEqual({
      "clips.editor": false,
      "clips.meetings": true,
    });

    mocks.mutateUserSetting.mockImplementation(
      async (
        _email: string,
        _key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown>,
      ) => updater({ "clips.editor": true }),
    );

    await expect(
      setUserLab("alice@example.com", "clips.meetings", true),
    ).resolves.toEqual({
      "clips.editor": true,
      "clips.meetings": true,
    });
    expect(mocks.mutateUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "labs",
      expect.any(Function),
    );
    await expect(
      setUserLab("alice@example.com", "unknown", true),
    ).rejects.toThrow("Unknown lab: unknown");
  });

  it("preserves opt-ins stored under the former setting key", async () => {
    mocks.getUserSetting.mockImplementation(
      async (_email: string, key: string) =>
        key === "experiments" ? { "clips.meetings": true } : null,
    );
    expect(await getUserLabs("alice@example.com")).toEqual({
      "clips.editor": false,
      "clips.meetings": true,
    });

    mocks.mutateUserSetting.mockImplementation(
      async (
        _email: string,
        _key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      ) => updater(null),
    );

    await expect(
      setUserLab("alice@example.com", "clips.editor", true),
    ).resolves.toEqual({
      "clips.editor": true,
      "clips.meetings": true,
    });
  });
});
