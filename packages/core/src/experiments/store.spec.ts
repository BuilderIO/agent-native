import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("../settings/user-settings.js", () => mocks);

import {
  _resetExperimentRegistryForTests,
  registerExperiments,
} from "./registry.js";
import {
  getUserExperiments,
  normalizeExperimentValues,
  setUserExperiment,
} from "./store.js";

beforeEach(() => {
  _resetExperimentRegistryForTests();
  vi.clearAllMocks();
  registerExperiments([{ key: "clips.editor" }, { key: "clips.meetings" }]);
});

describe("user experiments", () => {
  it("defaults registered experiments off and ignores stale values", () => {
    expect(
      normalizeExperimentValues({
        "clips.editor": true,
        "old-experiment": true,
      }),
    ).toEqual({
      "clips.editor": true,
      "clips.meetings": false,
    });
  });

  it("reads and atomically updates one user's opt-in state", async () => {
    mocks.getUserSetting.mockResolvedValue({ "clips.meetings": true });
    expect(await getUserExperiments("alice@example.com")).toEqual({
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
      setUserExperiment("alice@example.com", "clips.meetings", true),
    ).resolves.toEqual({
      "clips.editor": true,
      "clips.meetings": true,
    });
    expect(mocks.mutateUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "experiments",
      expect.any(Function),
    );
    await expect(
      setUserExperiment("alice@example.com", "unknown", true),
    ).rejects.toThrow("Unknown experiment: unknown");
  });
});
