import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeatureFlagRules } from "./store.js";

const globalSettings = new Map<string, Record<string, unknown> | null>();
const orgSettings = new Map<string, Record<string, unknown> | null>();
const corruptSettings = new Set<string>();
const executeMock = vi.fn(async () => ({ rows: [] }));
const getSettingMock = vi.fn(
  async (key: string) => globalSettings.get(key) ?? null,
);
const ORG_KEY_RE = /^o:([^:]+):(.+)$/;
const rawSetting = (key: string): string | null => {
  const match = ORG_KEY_RE.exec(key);
  const settings = match ? orgSettings : globalSettings;
  const mapKey = match ? `${match[1]}:${match[2]}` : key;
  if (corruptSettings.has(mapKey)) return "{";
  return settings.has(mapKey) ? JSON.stringify(settings.get(mapKey)) : null;
};
const getSettingsRawMock = vi.fn(
  async (keys: readonly string[]) =>
    new Map(keys.map((key) => [key, rawSetting(key)])),
);
const mutate =
  (settings: typeof globalSettings) =>
  async (
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Promise<Record<string, unknown>>,
  ) => {
    if (corruptSettings.has(key)) throw new SyntaxError("Unexpected token");
    const next = await updater(settings.get(key) ?? null);
    settings.set(key, next);
    return next;
  };
const put =
  (settings: typeof globalSettings) =>
  async (key: string, value: Record<string, unknown>) => {
    corruptSettings.delete(key);
    settings.set(key, value);
  };

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: (...args: any[]) => getSettingMock(...args),
  getSettingsRaw: (...args: any[]) => getSettingsRawMock(...args),
  putSetting: (key: string, value: Record<string, unknown>) =>
    put(globalSettings)(key, value),
  mutateSetting: (key: string, updater: any) =>
    mutate(globalSettings)(key, updater),
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
}));
vi.mock("../settings/org-settings.js", () => ({
  putOrgSetting: (orgId: string, key: string, value: Record<string, unknown>) =>
    put(orgSettings)(`${orgId}:${key}`, value),
  mutateOrgSetting: (orgId: string, key: string, updater: any) =>
    mutate(orgSettings)(`${orgId}:${key}`, updater),
}));

const registry = await import("./registry.js");
const store = await import("./store.js");

beforeEach(() => {
  registry._resetFeatureFlagRegistryForTests();
  globalSettings.clear();
  orgSettings.clear();
  corruptSettings.clear();
  vi.clearAllMocks();
  executeMock.mockResolvedValue({ rows: [] });
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
      version: 1,
      mode: "rules",
      orgIds: ["org-1"],
    });
    await expect(
      store.evaluateFeatureFlag("new-editor", { orgId: "org-1" }),
    ).resolves.toBe(true);

    getSettingsRawMock.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      store.evaluateFeatureFlag("new-editor", { orgId: "org-1" }),
    ).resolves.toBe(false);
  });

  it("uses the rollout index for anonymous discovery on the hot path", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag-rollout-index:new-editor", {
      version: 1,
      global: false,
      orgIds: ["builder-org"],
    });

    await expect(store.hasActiveFeatureFlagRollout("new-editor")).resolves.toBe(
      true,
    );
    expect(executeMock).not.toHaveBeenCalled();
    expect(getSettingMock).toHaveBeenCalledWith(
      "feature-flag-rollout-index:new-editor",
    );
  });

  it("repairs a missing rollout index once and caches the result", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          key: "o:builder-org:feature-flag:new-editor",
          value: JSON.stringify({
            version: 1,
            mode: "rules",
            orgIds: ["builder-org"],
          }),
        },
      ],
    });

    await expect(store.hasActiveFeatureFlagRollout("new-editor")).resolves.toBe(
      true,
    );
    expect(executeMock).toHaveBeenCalledWith({
      sql: expect.stringContaining("SELECT key, value FROM"),
      args: ["o:%:feature-flag:new-editor"],
    });
    expect(globalSettings.get("feature-flag-rollout-index:new-editor")).toEqual(
      {
        version: 1,
        global: false,
        orgIds: ["builder-org"],
      },
    );
  });

  it("does not advertise empty or explicitly off scoped rules", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    executeMock.mockResolvedValueOnce({
      rows: [
        { value: JSON.stringify({ version: 1, mode: "off" }) },
        { value: JSON.stringify({ version: 1, mode: "rules" }) },
      ],
    });

    await expect(store.hasActiveFeatureFlagRollout("new-editor")).resolves.toBe(
      false,
    );
  });

  it("does not advertise a rule that can't be read", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag:new-editor", { mode: "on" });
    executeMock.mockResolvedValueOnce({
      rows: [
        { key: "o:org-1:feature-flag:new-editor", value: '{"mode":"on"}' },
        { key: "o:org-2:feature-flag:new-editor", value: "{" },
      ],
    });

    await expect(store.hasActiveFeatureFlagRollout("new-editor")).resolves.toBe(
      false,
    );
  });

  it("reads many flags' rules in one settings batch, org overrides winning over global", async () => {
    registry.registerFeatureFlags([
      { key: "new-editor" },
      { key: "beta-export" },
      { key: "unconfigured-flag" },
    ]);
    globalSettings.set("feature-flag:new-editor", { version: 1, mode: "on" });
    globalSettings.set("feature-flag:beta-export", { version: 1, mode: "off" });
    orgSettings.set("org-1:feature-flag:beta-export", {
      version: 1,
      mode: "on",
    });

    const rules = await store.getFeatureFlagRulesForKeys(
      ["new-editor", "beta-export", "unconfigured-flag"],
      { orgId: "org-1" },
    );

    expect(getSettingsRawMock).toHaveBeenCalledTimes(1);
    expect(rules.get("new-editor")).toMatchObject({
      state: "set",
      rules: { mode: "on" },
    });
    expect(rules.get("beta-export")).toMatchObject({
      state: "set",
      rules: { mode: "on" },
    });
    expect(rules.get("unconfigured-flag")).toEqual({ state: "unset" });
  });

  it("skips the org key entirely when no org is in scope", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag:new-editor", { version: 1, mode: "on" });

    const rules = await store.getFeatureFlagRulesForKeys(["new-editor"], {});

    expect(getSettingsRawMock).toHaveBeenCalledWith(
      ["feature-flag:new-editor"],
      undefined,
    );
    expect(rules.get("new-editor")).toMatchObject({ rules: { mode: "on" } });
  });

  it("refuses to start an org's own rule from the global rule", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag:new-editor", {
      version: 1,
      mode: "rules",
      emails: ["first@example.com"],
    });
    const addSecond = (current: FeatureFlagRules) =>
      store.normalizeFeatureFlagRules({
        ...current,
        emails: [...current.emails, "second@example.com"],
      });

    await expect(
      store.mutateFeatureFlagRules("new-editor", { orgId: "org-1" }, addSecond),
    ).rejects.toMatchObject({
      name: "FeatureFlagRulesError",
      code: "follows-global",
    });
    expect(orgSettings.has("org-1:feature-flag:new-editor")).toBe(false);

    orgSettings.set("org-1:feature-flag:new-editor", {
      version: 1,
      mode: "rules",
      emails: ["first@example.com"],
    });
    const result = await store.mutateFeatureFlagRules(
      "new-editor",
      { orgId: "org-1" },
      addSecond,
    );

    expect(result.emails).toEqual(["first@example.com", "second@example.com"]);
    expect(orgSettings.get("org-1:feature-flag:new-editor")).toMatchObject({
      emails: ["first@example.com", "second@example.com"],
    });
    expect(globalSettings.get("feature-flag-rollout-index:new-editor")).toEqual(
      {
        version: 1,
        global: false,
        orgIds: ["org-1"],
      },
    );
  });

  it("starts an org's own rule from off when no rule exists yet", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);

    const result = await store.mutateFeatureFlagRules(
      "new-editor",
      { orgId: "org-1" },
      (current) => ({ ...current, mode: "rules", emails: ["a@example.com"] }),
    );

    expect(result).toMatchObject({ mode: "rules", emails: ["a@example.com"] });
    expect(orgSettings.get("org-1:feature-flag:new-editor")).toMatchObject({
      version: 1,
      emails: ["a@example.com"],
    });
  });

  it("refuses to change a rule that can't be read, and replaces it only on request", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    const enable = (current: FeatureFlagRules) => ({
      ...current,
      mode: "rules" as const,
      emails: [...current.emails, "me@example.com"],
    });
    const replacement = {
      ...store.defaultFeatureFlagRules(),
      mode: "rules" as const,
      emails: ["me@example.com"],
    };

    globalSettings.set("feature-flag:new-editor", { mode: "on" });
    await expect(
      store.mutateFeatureFlagRules("new-editor", {}, enable),
    ).rejects.toMatchObject({
      name: "FeatureFlagRulesError",
      code: "malformed",
    });
    expect(globalSettings.get("feature-flag:new-editor")).toEqual({
      mode: "on",
    });

    orgSettings.set("org-1:feature-flag:new-editor", null);
    corruptSettings.add("org-1:feature-flag:new-editor");
    await expect(
      store.mutateFeatureFlagRules("new-editor", { orgId: "org-1" }, enable),
    ).rejects.toMatchObject({
      name: "FeatureFlagRulesError",
      code: "malformed",
    });

    await expect(
      store.replaceFeatureFlagRules("new-editor", {}, replacement),
    ).resolves.toMatchObject({ mode: "rules", emails: ["me@example.com"] });
    await store.replaceFeatureFlagRules(
      "new-editor",
      { orgId: "org-1" },
      replacement,
    );
    for (const scope of [{}, { orgId: "org-1" }]) {
      const layers = await store.readFeatureFlagRuleLayers("new-editor", scope);
      expect(store.featureFlagRuleInEffect(layers)).toMatchObject({
        state: "set",
        rules: { mode: "rules", emails: ["me@example.com"] },
      });
    }
  });

  it("reads routing rules strictly: unconfigured is off, malformed or unregistered throws", async () => {
    registry.registerFeatureFlags([{ key: "write-path" }]);
    await expect(
      store.getFeatureFlagRulesStrict("write-path", {}),
    ).resolves.toEqual(store.defaultFeatureFlagRules());

    globalSettings.set("feature-flag:write-path", {
      version: 1,
      mode: "rules",
      emails: ["Owner@Example.com"],
    });
    await expect(
      store.getFeatureFlagRulesStrict("write-path", {}),
    ).resolves.toMatchObject({ mode: "rules", emails: ["owner@example.com"] });

    globalSettings.set("feature-flag:write-path", {
      version: 1,
      mode: "rules",
      percentage: 25,
    });
    await expect(
      store.getFeatureFlagRulesStrict("write-path", {}),
    ).resolves.toMatchObject({ mode: "rules", percentage: 25 });

    for (const malformed of [
      null,
      { mode: "on" },
      { version: 2, mode: "on" },
      { version: 1, mode: "onn" },
      { version: 1, emails: ["owner@example.com"] },
      { version: 1, mode: "rules", emails: "owner@example.com" },
      { version: 1, mode: "rules", orgIds: ["org-1", 7] },
      { version: 1, mode: "rules", percentage: 150 },
      { version: 1, mode: "rules", percentage: 0.5 },
    ]) {
      globalSettings.set("feature-flag:write-path", malformed);
      await expect(
        store.getFeatureFlagRules("write-path", {}),
      ).resolves.toMatchObject({ mode: "off" });
      await expect(
        store.getFeatureFlagRulesStrict("write-path", {}),
      ).rejects.toMatchObject({ code: "malformed", key: "write-path" });
    }

    globalSettings.set("feature-flag:write-path", { version: 1, mode: "on" });
    for (const malformed of [null, { version: 1, mode: "onn" }]) {
      orgSettings.set("org-1:feature-flag:write-path", malformed);
      await expect(
        store.getFeatureFlagRulesStrict("write-path", { orgId: "org-1" }),
      ).rejects.toMatchObject({ code: "malformed" });
    }

    corruptSettings.add("org-1:feature-flag:write-path");
    await expect(
      store.getFeatureFlagRulesStrict("write-path", { orgId: "org-1" }),
    ).rejects.toMatchObject({
      name: "FeatureFlagRulesError",
      code: "malformed",
    });

    await expect(
      store.getFeatureFlagRulesStrict("never-registered", {}),
    ).rejects.toMatchObject({ code: "unregistered", key: "never-registered" });
  });
  it("evaluates a rule that can't be read as off, wherever it is read", async () => {
    registry.registerFeatureFlags([{ key: "new-editor" }]);
    globalSettings.set("feature-flag:new-editor", { version: 1, mode: "on" });
    await expect(
      store.evaluateFeatureFlag("new-editor", { orgId: "org-2" }),
    ).resolves.toBe(true);

    for (const unreadable of [
      null,
      { mode: "on" },
      { version: 1, mode: "onn" },
    ]) {
      orgSettings.set("org-1:feature-flag:new-editor", unreadable);
      await expectOffForOrg1();
    }
    corruptSettings.add("org-1:feature-flag:new-editor");
    await expectOffForOrg1();

    globalSettings.set("feature-flag:new-editor", { mode: "on" });
    await expect(store.evaluateFeatureFlag("new-editor", {})).resolves.toBe(
      false,
    );
    await expect(
      store.evaluateFeatureFlag("new-editor", { orgId: "org-2" }),
    ).resolves.toBe(false);

    async function expectOffForOrg1() {
      const scope = { orgId: "org-1", userEmail: "me@example.com" };
      const layers = await store.readFeatureFlagRuleLayers("new-editor", scope);
      expect(layers.inEffect).toBe("org");
      expect(layers.org).toMatchObject({ state: "unreadable" });
      await expect(
        store.evaluateFeatureFlag("new-editor", scope),
      ).resolves.toBe(false);
      expect(
        (await store.getFeatureFlagRulesForKeys(["new-editor"], scope)).get(
          "new-editor",
        ),
      ).toMatchObject({ state: "unreadable" });
      await expect(
        store.evaluateFeatureFlagStrict("new-editor", scope),
      ).rejects.toMatchObject({ code: "malformed" });
    }
  });
});
