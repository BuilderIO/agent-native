import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveExperienceFlags } from "./index.js";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));
vi.mock("../action.js", () => ({
  defineAction: (value: unknown) => value,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("../settings/user-settings.js", () => mocks);
const { createExperienceProfileActions } = await import("./server.js");
const deviations = [
  { flag: { key: "example.inspector" }, enabledInAgentNative: true },
];
const ctx = { userEmail: "reviewer@example.com", caller: "cli" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserSetting.mockResolvedValue(null);
});

describe("experience profiles", () => {
  it("defaults users to the declared public preset and scopes storage", async () => {
    const actions = createExperienceProfileActions({
      appId: "example",
      deviations,
      canUseReference: () => false,
    });
    await expect(actions.get.run({}, ctx)).resolves.toEqual({
      profile: "agent-native",
      savedProfile: null,
      referenceAvailable: false,
      values: { "example.inspector": true },
    });
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      ctx.userEmail,
      "experience-profile:example",
      { bypassCache: true },
    );
  });

  it("refuses reference writes before persistence", async () => {
    const actions = createExperienceProfileActions({
      appId: "example",
      deviations,
      canUseReference: () => false,
    });
    await expect(
      actions.set.run({ profile: "reference" }, ctx),
    ).rejects.toThrow("restricted");
    expect(mocks.putUserSetting).not.toHaveBeenCalled();
  });

  it("persists an authorized choice and disables deviations", async () => {
    mocks.getUserSetting.mockResolvedValue({ profile: "reference" });
    const actions = createExperienceProfileActions({
      appId: "example",
      deviations,
      canUseReference: () => true,
    });
    await expect(
      actions.set.run({ profile: "reference" }, ctx),
    ).resolves.toMatchObject({
      profile: "reference",
      values: { "example.inspector": false },
    });
    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      ctx.userEmail,
      "experience-profile:example",
      { profile: "reference" },
    );
  });

  it("rechecks authorization after a saved reference preference is forged or revoked", async () => {
    mocks.getUserSetting.mockResolvedValue({ profile: "reference" });
    const actions = createExperienceProfileActions({
      appId: "example",
      deviations,
      canUseReference: () => false,
    });
    await expect(actions.get.run({}, ctx)).resolves.toMatchObject({
      profile: "agent-native",
      savedProfile: "reference",
      referenceAvailable: false,
    });
  });

  it("does not disguise unreadable or malformed preferences as defaults", async () => {
    const actions = createExperienceProfileActions({
      appId: "example",
      deviations,
      canUseReference: () => false,
    });
    mocks.getUserSetting.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(actions.get.run({}, ctx)).rejects.toThrow(
      "storage unavailable",
    );
    mocks.getUserSetting.mockResolvedValueOnce({ profile: "unknown" });
    await expect(actions.get.run({}, ctx)).rejects.toThrow();
  });

  it("requires authentication and propagates failed writes", async () => {
    const actions = createExperienceProfileActions({
      appId: "example",
      deviations,
      canUseReference: () => true,
    });
    await expect(actions.get.run({}, { caller: "cli" })).rejects.toThrow(
      "Sign in",
    );
    mocks.putUserSetting.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      actions.set.run({ profile: "agent-native" }, ctx),
    ).rejects.toThrow("write failed");
  });

  it("changes only declared deviation flags and rejects ambiguous declarations", () => {
    expect(resolveExperienceFlags(deviations, "reference")).toEqual({
      "example.inspector": false,
    });
    expect(() =>
      resolveExperienceFlags([...deviations, ...deviations], "reference"),
    ).toThrow("Duplicate");
  });
});
