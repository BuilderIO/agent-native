import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
  getSetting: vi.fn(),
  getOrgSetting: vi.fn(),
  evaluateFeatureFlagRules: vi.fn(),
  normalizeFeatureFlagRules: vi.fn((value) => value),
  defaultFeatureFlagRules: vi.fn(() => ({ mode: "off" })),
}));

vi.mock("../settings/user-settings.js", () => mocks);
vi.mock("../settings/store.js", () => mocks);
vi.mock("../settings/org-settings.js", () => mocks);
vi.mock("../feature-flags/store.js", () => mocks);

import { _resetLabRegistryForTests, registerLabs } from "./registry.js";
import {
  getUserLabState,
  getUserLabs,
  normalizeLabValues,
  setUserLab,
} from "./store.js";

beforeEach(() => {
  _resetLabRegistryForTests();
  vi.clearAllMocks();
  mocks.getSetting.mockResolvedValue(null);
  mocks.getOrgSetting.mockResolvedValue(null);
  mocks.evaluateFeatureFlagRules.mockImplementation(
    (_key, rules) => rules.mode === "on",
  );
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

  it("uses an app-defined default unless the user has an explicit choice", async () => {
    registerLabs([{ key: "clips.wisprflow", defaultEnabled: true }]);
    mocks.getUserSetting.mockResolvedValue(null);

    expect(await getUserLabs("alice@example.com")).toEqual({
      "clips.editor": false,
      "clips.meetings": false,
      "clips.wisprflow": true,
    });
    expect(
      normalizeLabValues({ "clips.wisprflow": false })["clips.wisprflow"],
    ).toBe(false);
    expect(
      normalizeLabValues({ "clips.wisprflow": "true" })["clips.wisprflow"],
    ).toBe(false);
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
      ) => {
        const result = await updater({ "clips.editor": true });
        mocks.getUserSetting.mockImplementation(async (_email, key) =>
          key === "labs" ? result : null,
        );
        return result;
      },
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
      ) => {
        const result = await updater(null);
        mocks.getUserSetting.mockImplementation(async (_email, key) =>
          key === "labs" ? result : { "clips.meetings": true },
        );
        return result;
      },
    );

    await expect(
      setUserLab("alice@example.com", "clips.editor", true),
    ).resolves.toEqual({
      "clips.editor": true,
      "clips.meetings": true,
    });
  });

  it("merges legacy opt-ins when both setting keys exist", async () => {
    mocks.getUserSetting.mockImplementation(
      async (_email: string, key: string) =>
        key === "labs" ? { "clips.editor": false } : { "clips.meetings": true },
    );

    expect(await getUserLabs("alice@example.com")).toEqual({
      "clips.editor": false,
      "clips.meetings": true,
    });
  });

  it("retains scoped legacy values until a saved choice, including explicit Off", async () => {
    registerLabs([
      { key: "clips.resilient", legacyFlagKeys: ["capture", "retry"] },
    ]);
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.getOrgSetting.mockImplementation(async (_org, key) =>
      key === "feature-flag:capture" ? { mode: "on" } : null,
    );
    const scope = { orgId: "org-1" };
    await expect(
      getUserLabState("alice@example.com", "clips.resilient", scope),
    ).resolves.toEqual({
      enabled: false,
      source: "legacy",
      legacyValues: { capture: true, retry: false },
      mixed: true,
    });
    expect(mocks.getOrgSetting).toHaveBeenCalledWith(
      "org-1",
      "feature-flag:capture",
      { transaction: undefined },
    );
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "labs" ? { "clips.resilient": false } : null,
    );
    await expect(
      getUserLabState("alice@example.com", "clips.resilient", scope),
    ).resolves.toEqual({
      enabled: false,
      source: "choice",
      mixed: false,
    });
    expect(mocks.getOrgSetting).toHaveBeenCalledTimes(2);
  });

  it("surfaces unreadable preferences instead of substituting legacy state", async () => {
    registerLabs([{ key: "design.builder", legacyFlagKeys: ["builder"] }]);
    mocks.getUserSetting.mockRejectedValue(new Error("storage unavailable"));
    await expect(
      getUserLabState("alice@example.com", "design.builder"),
    ).rejects.toThrow("storage unavailable");
    expect(mocks.getSetting).not.toHaveBeenCalled();
  });

  it("rejects present invalid Labs choices instead of inheriting an enabled flag", async () => {
    registerLabs([{ key: "design.builder", legacyFlagKeys: ["builder"] }]);
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "labs" ? { "design.builder": "false" } : null,
    );
    mocks.getSetting.mockResolvedValue({ mode: "on" });
    await expect(
      getUserLabState("alice@example.com", "design.builder"),
    ).rejects.toThrow("Invalid saved lab choice: design.builder");
    expect(mocks.getSetting).not.toHaveBeenCalled();
  });

  it("rejects malformed Lab setting objects instead of treating them as absent", async () => {
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "labs" ? ("broken" as unknown as Record<string, unknown>) : null,
    );
    await expect(getUserLabs("alice@example.com")).rejects.toThrow(
      "Invalid saved lab setting: labs",
    );
  });

  it("does not use global On when org legacy rules are unreadable or invalid", async () => {
    registerLabs([{ key: "design.builder", legacyFlagKeys: ["builder"] }]);
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.getSetting.mockResolvedValue({ mode: "on" });
    mocks.getOrgSetting.mockResolvedValue({ mode: "invalid" });
    await expect(
      getUserLabState("alice@example.com", "design.builder", {
        orgId: "org-1",
      }),
    ).rejects.toThrow("Invalid legacy feature flag rules: builder");
    mocks.getOrgSetting.mockRejectedValue(new SyntaxError("invalid JSON"));
    await expect(
      getUserLabState("alice@example.com", "design.builder", {
        orgId: "org-1",
      }),
    ).rejects.toThrow("invalid JSON");
  });

  it("returns effective inherited values for other Labs after a save", async () => {
    registerLabs([{ key: "design.builder", legacyFlagKeys: ["builder"] }]);
    let saved: Record<string, unknown> | null = null;
    mocks.getUserSetting.mockImplementation(async (_email, key) =>
      key === "labs" ? saved : null,
    );
    mocks.mutateUserSetting.mockImplementation(
      async (_email, _key, updater) => {
        saved = await updater(saved);
        return saved;
      },
    );
    mocks.getSetting.mockResolvedValue({ mode: "off" });
    mocks.getOrgSetting.mockResolvedValue({ mode: "on" });
    await expect(
      setUserLab("alice@example.com", "clips.editor", true, { orgId: "org-1" }),
    ).resolves.toEqual({
      "clips.editor": true,
      "clips.meetings": false,
      "design.builder": true,
    });
  });

  it("rejects unreadable inherited state before persisting a choice", async () => {
    registerLabs([{ key: "design.builder", legacyFlagKeys: ["builder"] }]);
    let persisted = false;
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.getOrgSetting.mockRejectedValue(new SyntaxError("invalid JSON"));
    mocks.mutateUserSetting.mockImplementation(
      async (_email, _key, updater) => {
        await updater(null);
        persisted = true;
        return {};
      },
    );
    await expect(
      setUserLab("alice@example.com", "clips.editor", true, { orgId: "org-1" }),
    ).rejects.toThrow("invalid JSON");
    expect(persisted).toBe(false);
  });

  it("returns the persisted attempt without a fallible read after the write", async () => {
    registerLabs([{ key: "design.builder", legacyFlagKeys: ["builder"] }]);
    let persisted = false;
    mocks.getUserSetting.mockImplementation(async () => {
      if (persisted) throw new Error("post-write read unavailable");
      return null;
    });
    mocks.getOrgSetting.mockResolvedValue({ mode: "on" });
    mocks.mutateUserSetting.mockImplementation(
      async (_email, _key, updater) => {
        const next = await updater(null);
        persisted = true;
        return next;
      },
    );
    await expect(
      setUserLab("alice@example.com", "clips.editor", true, { orgId: "org-1" }),
    ).resolves.toEqual({
      "clips.editor": true,
      "clips.meetings": false,
      "design.builder": true,
    });
    expect(persisted).toBe(true);
  });
});
