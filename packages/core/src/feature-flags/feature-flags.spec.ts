import { beforeEach, describe, expect, it, vi } from "vitest";

const globalSettings = new Map<string, Record<string, unknown>>();
const orgSettings = new Map<string, Record<string, unknown>>();
const getSettingMock = vi.fn(
  async (key: string) => globalSettings.get(key) ?? null,
);
const getOrgSettingMock = vi.fn(
  async (orgId: string, key: string) =>
    orgSettings.get(`${orgId}:${key}`) ?? null,
);

vi.mock("../settings/store.js", () => ({
  getSetting: (...args: any[]) => getSettingMock(...args),
  putSetting: vi.fn(),
  mutateSetting: async (
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Promise<Record<string, unknown>>,
  ) => {
    const next = await updater(globalSettings.get(key) ?? null);
    globalSettings.set(key, next);
    return next;
  },
}));
vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: (...args: any[]) => getOrgSettingMock(...args),
  putOrgSetting: vi.fn(),
  mutateOrgSetting: async (
    orgId: string,
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Promise<Record<string, unknown>>,
  ) => {
    const mapKey = `${orgId}:${key}`;
    const next = await updater(orgSettings.get(mapKey) ?? null);
    orgSettings.set(mapKey, next);
    return next;
  },
}));

const registry = await import("./registry.js");
const store = await import("./store.js");

beforeEach(() => {
  registry._resetFeatureFlagRegistryForTests();
  globalSettings.clear();
  orgSettings.clear();
  vi.clearAllMocks();
});

describe("feature flag registry", () => {
  it("is explicit, boolean-only, and default-off", () => {
    const flags = registry.defineFeatureFlags([
      { key: "new-editor", displayName: "New editor" },
    ]);
    registry.registerFeatureFlags(flags);

    expect(registry.listFeatureFlags()).toEqual([
      { key: "new-editor", defaultValue: false, displayName: "New editor" },
    ]);
    expect(() => registry.defineFeatureFlag({ key: "Not stable" })).toThrow(
      /only letters, numbers, dots, underscores, or hyphens/,
    );
  });
});

describe("feature flag evaluator", () => {
  it("keeps percentage rollouts deterministic and monotonic", () => {
    const tenPercent = store.normalizeFeatureFlagRules({
      mode: "rules",
      percentage: 10,
    });
    const twentyFivePercent = store.normalizeFeatureFlagRules({
      mode: "rules",
      percentage: 25,
    });
    const identities = Array.from(
      { length: 1_000 },
      (_, index) => `user-${index}`,
    );
    const firstCohort = identities.filter((userKey) =>
      store.evaluateFeatureFlagRules("new-editor", tenPercent, { userKey }),
    );

    expect(firstCohort.length).toBeGreaterThan(0);
    expect(
      firstCohort.every((userKey) =>
        store.evaluateFeatureFlagRules("new-editor", twentyFivePercent, {
          userKey,
        }),
      ),
    ).toBe(true);
    expect(
      store.evaluateFeatureFlagRules("new-editor", twentyFivePercent, {}),
    ).toBe(false);
  });
  it("fails closed, honors exact email/org targets, and is deterministic", () => {
    const off = store.defaultFeatureFlagRules();
    expect(
      store.evaluateFeatureFlagRules("new-editor", off, {
        userEmail: "alice@example.com",
      }),
    ).toBe(false);
    const rules = store.normalizeFeatureFlagRules({
      mode: "rules",
      emails: ["ALICE@example.com"],
      orgIds: ["org-1"],
      percentage: 50,
    });
    expect(
      store.evaluateFeatureFlagRules("new-editor", rules, {
        userEmail: "alice@example.com",
      }),
    ).toBe(true);
    expect(
      store.evaluateFeatureFlagRules("new-editor", rules, { orgId: "org-1" }),
    ).toBe(true);
    const first = store.evaluateFeatureFlagRules("new-editor", rules, {
      userEmail: "other@example.com",
    });
    expect(
      store.evaluateFeatureFlagRules("new-editor", rules, {
        userEmail: "other@example.com",
      }),
    ).toBe(first);
  });

  it("falls back from an org override to a global rule and fails closed on storage errors", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag:new-editor", {
      mode: "rules",
      orgIds: ["org-1"],
    });
    await expect(
      store.evaluateFeatureFlag("new-editor", { orgId: "org-1" }),
    ).resolves.toBe(true);

    getOrgSettingMock.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      store.evaluateFeatureFlag("new-editor", { orgId: "org-1" }),
    ).resolves.toBe(false);
  });

  it("starts an atomic org mutation from the global fallback", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag:new-editor", {
      mode: "rules",
      emails: ["first@example.com"],
    });

    const result = await store.mutateFeatureFlagRules(
      "new-editor",
      { orgId: "org-1" },
      (current) =>
        store.normalizeFeatureFlagRules({
          ...current,
          emails: [...current.emails, "second@example.com"],
        }),
    );

    expect(result.emails).toEqual(["first@example.com", "second@example.com"]);
    expect(orgSettings.get("org-1:feature-flag:new-editor")).toMatchObject({
      emails: ["first@example.com", "second@example.com"],
    });
  });
});
