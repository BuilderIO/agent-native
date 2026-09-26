import { beforeEach, describe, expect, it, vi } from "vitest";

const chain = () => {
  const value: Record<string, unknown> = {};
  for (const method of ["min", "max", "email", "int", "optional"]) {
    value[method] = () => value;
  }
  return value;
};

vi.mock("zod", () => ({
  z: { object: () => chain() },
}));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const globalSettings = new Map<string, Record<string, unknown>>();
const orgSettings = new Map<string, Record<string, unknown>>();
const failingGlobalKeys = new Set<string>();
const ORG_KEY_RE = /^o:([^:]+):(.+)$/;
const getSettingsMock = vi.fn(async (keys: readonly string[]) => {
  const result = new Map<string, Record<string, unknown> | null>();
  for (const key of keys) {
    const match = ORG_KEY_RE.exec(key);
    result.set(
      key,
      match
        ? (orgSettings.get(`${match[1]}:${match[2]}`) ?? null)
        : (globalSettings.get(key) ?? null),
    );
  }
  return result;
});
const getSettingMock = vi.fn(async (key: string) => {
  if (failingGlobalKeys.has(key)) throw new Error(`corrupt setting: ${key}`);
  const match = ORG_KEY_RE.exec(key);
  return match
    ? (orgSettings.get(`${match[1]}:${match[2]}`) ?? null)
    : (globalSettings.get(key) ?? null);
});

vi.mock("../../settings/store.js", () => ({
  getSetting: (...args: any[]) => getSettingMock(...args),
  getSettings: (...args: any[]) => getSettingsMock(...args),
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
const action = (await import("./get-feature-flags.js")).default;

beforeEach(() => {
  registry._resetFeatureFlagRegistryForTests();
  globalSettings.clear();
  orgSettings.clear();
  failingGlobalKeys.clear();
  getSettingsMock.mockClear();
  getSettingMock.mockClear();
  captureErrorMock.mockClear();
});

describe("get-feature-flags action", () => {
  it("issues exactly one settings query for K registered flags", async () => {
    const keys = Array.from({ length: 25 }, (_, i) => `flag-${i}`);
    registry.registerFeatureFlags(keys.map((key) => ({ key })));
    globalSettings.set("feature-flag:flag-3", { mode: "on" });

    const values = await action.run(
      {},
      { userEmail: "a@b.com", orgId: "org-1" },
    );

    expect(Object.keys(values)).toHaveLength(25);
    expect(values["flag-3"]).toBe(true);
    expect(values["flag-0"]).toBe(false);
    expect(getSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("prefers an org override over the global rule", async () => {
    registry.registerFeatureFlags([{ key: "beta-export" }]);
    globalSettings.set("feature-flag:beta-export", { mode: "off" });
    orgSettings.set("org-1:feature-flag:beta-export", { mode: "on" });

    const values = await action.run(
      {},
      { userEmail: "a@b.com", orgId: "org-1" },
    );

    expect(values["beta-export"]).toBe(true);
    expect(getSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to per-flag reads, isolating one corrupt flag, when the batched read fails", async () => {
    registry.registerFeatureFlags([{ key: "flag-a" }, { key: "flag-b" }]);
    globalSettings.set("feature-flag:flag-b", { mode: "on" });
    failingGlobalKeys.add("feature-flag:flag-a");
    const dbError = new Error("db down");
    getSettingsMock.mockRejectedValueOnce(dbError);

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
    expect(getSettingsMock).not.toHaveBeenCalled();
  });
});
