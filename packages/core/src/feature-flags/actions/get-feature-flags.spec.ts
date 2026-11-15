import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const globalSettings = new Map<string, Record<string, unknown>>();
const orgSettings = new Map<string, Record<string, unknown>>();
const failingGlobalKeys = new Set<string>();
const ORG_KEY_RE = /^o:([^:]+):(.+)$/;
const getSettingsRawMock = vi.fn(async (keys: readonly string[]) => {
  const failing = keys.find((key) => failingGlobalKeys.has(key));
  if (failing) throw new Error(`corrupt setting: ${failing}`);
  return new Map(
    keys.map((key) => {
      const match = ORG_KEY_RE.exec(key);
      const value = match
        ? orgSettings.get(`${match[1]}:${match[2]}`)
        : globalSettings.get(key);
      return [key, value === undefined ? null : JSON.stringify(value)];
    }),
  );
});
const getSettingMock = vi.fn(async (key: string) => {
  if (failingGlobalKeys.has(key)) throw new Error(`corrupt setting: ${key}`);
  const match = ORG_KEY_RE.exec(key);
  return match
    ? (orgSettings.get(`${match[1]}:${match[2]}`) ?? null)
    : (globalSettings.get(key) ?? null);
});

vi.mock("../../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/store.js")>()),
  getSetting: (...args: any[]) => getSettingMock(...args),
  getSettingsRaw: (...args: any[]) => getSettingsRawMock(...args),
  mutateSetting: vi.fn(),
  putSetting: vi.fn(),
}));
vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
}));

const captureErrorMock = vi.fn();
vi.mock("../../server/capture-error.js", () => ({
  captureError: (...args: unknown[]) => captureErrorMock(...args),
}));

const registry = await import("../registry.js");
const labsRegistry = await import("../../labs/registry.js");
const action = (await import("./get-feature-flags.js")).default;

beforeEach(() => {
  registry._resetFeatureFlagRegistryForTests();
  labsRegistry._resetLabRegistryForTests();
  globalSettings.clear();
  orgSettings.clear();
  failingGlobalKeys.clear();
  getSettingsRawMock.mockClear();
  getSettingMock.mockClear();
  captureErrorMock.mockClear();
});

describe("get-feature-flags action", () => {
  it("issues exactly one settings query for K registered flags", async () => {
    const keys = Array.from({ length: 25 }, (_, i) => `flag-${i}`);
    registry.registerFeatureFlags(keys.map((key) => ({ key })));
    globalSettings.set("feature-flag:flag-3", { version: 1, mode: "on" });

    const values = await action.run(
      {},
      { userEmail: "a@b.com", orgId: "org-1" },
    );

    expect(Object.keys(values)).toHaveLength(25);
    expect(values["flag-3"]).toBe(true);
    expect(values["flag-0"]).toBe(false);
    expect(getSettingsRawMock).toHaveBeenCalledTimes(1);
  });

  it("prefers an org override over the global rule", async () => {
    registry.registerFeatureFlags([{ key: "beta-export" }]);
    globalSettings.set("feature-flag:beta-export", { version: 1, mode: "off" });
    orgSettings.set("org-1:feature-flag:beta-export", {
      version: 1,
      mode: "on",
    });

    const values = await action.run(
      {},
      { userEmail: "a@b.com", orgId: "org-1" },
    );

    expect(values["beta-export"]).toBe(true);
    expect(getSettingsRawMock).toHaveBeenCalledTimes(1);
  });

  it("evaluates an org override that can't be read as off, not as the global rule", async () => {
    registry.registerFeatureFlags([{ key: "beta-export" }]);
    globalSettings.set("feature-flag:beta-export", { version: 1, mode: "on" });
    orgSettings.set("org-1:feature-flag:beta-export", {
      version: 1,
      mode: "onn",
    });

    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-1" }),
    ).resolves.toEqual({ "beta-export": false });
    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-2" }),
    ).resolves.toEqual({ "beta-export": true });
  });

  it("falls back to per-flag reads, isolating one corrupt flag, when the batched read fails", async () => {
    registry.registerFeatureFlags([{ key: "flag-a" }, { key: "flag-b" }]);
    globalSettings.set("feature-flag:flag-b", { version: 1, mode: "on" });
    failingGlobalKeys.add("feature-flag:flag-a");
    const dbError = new Error("db down");
    getSettingsRawMock.mockRejectedValueOnce(dbError);

    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-1" }),
    ).resolves.toEqual({ "flag-a": false, "flag-b": true });
    expect(captureErrorMock).toHaveBeenCalledWith(
      dbError,
      expect.objectContaining({
        tags: { source: "feature-flags", op: "get-feature-flags" },
      }),
    );
  });

  it("returns an empty object when no flags are registered", async () => {
    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-1" }),
    ).resolves.toEqual({});
    expect(getSettingsRawMock).not.toHaveBeenCalled();
  });

  it("projects a saved Labs choice into every legacy alias", async () => {
    registry.registerFeatureFlags([{ key: "capture" }, { key: "retry" }]);
    labsRegistry.registerLabs([
      { key: "clips.resilient", legacyFlagKeys: ["capture", "retry"] },
    ]);
    globalSettings.set("feature-flag:capture", { version: 1, mode: "on" });
    globalSettings.set("feature-flag:retry", { version: 1, mode: "on" });
    globalSettings.set("u:a@b.com:labs", { "clips.resilient": false });

    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-1" }),
    ).resolves.toEqual({
      capture: false,
      retry: false,
    });
  });

  it("keeps unreadable migrated Labs scoped to their own aliases", async () => {
    registry.registerFeatureFlags([
      { key: "capture" },
      { key: "retry" },
      { key: "unrelated" },
    ]);
    labsRegistry.registerLabs([
      { key: "clips.resilient", legacyFlagKeys: ["capture", "retry"] },
    ]);
    globalSettings.set("feature-flag:capture", { version: 1, mode: "on" });
    globalSettings.set("feature-flag:retry", { version: 1, mode: "on" });
    globalSettings.set("feature-flag:unrelated", { version: 1, mode: "on" });
    globalSettings.set("u:a@b.com:labs", { "clips.resilient": "false" });

    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-1" }),
    ).resolves.toEqual({
      capture: false,
      retry: false,
      unrelated: true,
    });
    expect(captureErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Invalid saved lab choice: clips.resilient",
      }),
      expect.objectContaining({
        tags: expect.objectContaining({
          source: "feature-flags",
          op: "get-feature-flags",
          lab: "clips.resilient",
        }),
      }),
    );
  });

  it("preserves mixed inherited aliases in the caller organization", async () => {
    registry.registerFeatureFlags([{ key: "capture" }, { key: "retry" }]);
    labsRegistry.registerLabs([
      { key: "clips.resilient", legacyFlagKeys: ["capture", "retry"] },
    ]);
    orgSettings.set("org-1:feature-flag:capture", { version: 1, mode: "on" });

    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-1" }),
    ).resolves.toEqual({
      capture: true,
      retry: false,
    });
    await expect(
      action.run({}, { userEmail: "a@b.com", orgId: "org-2" }),
    ).resolves.toEqual({
      capture: false,
      retry: false,
    });
  });
});
