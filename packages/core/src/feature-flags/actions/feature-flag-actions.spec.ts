import { beforeEach, describe, expect, it, vi } from "vitest";

// The action modules only need Zod to construct their schemas. Keep this unit
// test isolated from the workspace dependency installation while exercising
// the action contract itself.
const chain = () => {
  const value: Record<string, unknown> = {};
  for (const method of ["min", "max", "email", "int", "optional"]) {
    value[method] = () => value;
  }
  return value;
};

vi.mock("zod", () => ({
  z: {
    object: () => chain(),
    string: () => chain(),
    number: () => chain(),
    enum: () => chain(),
    array: () => chain(),
    literal: () => chain(),
    discriminatedUnion: () => chain(),
  },
}));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const listFeatureFlagsMock = vi.fn();
const getFeatureFlagDefinitionMock = vi.fn();
vi.mock("../registry.js", () => ({
  listFeatureFlags: () => listFeatureFlagsMock(),
  getFeatureFlagDefinition: (...args: any[]) =>
    getFeatureFlagDefinitionMock(...args),
}));

const requireFeatureFlagManagerMock = vi.fn();
vi.mock("../permissions.js", () => ({
  requireFeatureFlagManager: (...args: any[]) =>
    requireFeatureFlagManagerMock(...args),
}));

const defaultFeatureFlagRulesMock = vi.fn();
const getFeatureFlagRulesMock = vi.fn();
const normalizeFeatureFlagRulesMock = vi.fn((value) => value);
const mutateFeatureFlagRulesMock = vi.fn(
  async (
    key: string,
    scope: unknown,
    updater: (current: Record<string, unknown>) => Record<string, unknown>,
  ) => updater(await getFeatureFlagRulesMock(key, scope)),
);
vi.mock("../store.js", () => ({
  defaultFeatureFlagRules: () => defaultFeatureFlagRulesMock(),
  getFeatureFlagRules: (...args: any[]) => getFeatureFlagRulesMock(...args),
  mutateFeatureFlagRules: (...args: any[]) =>
    mutateFeatureFlagRulesMock(...args),
  normalizeFeatureFlagRules: (...args: any[]) =>
    normalizeFeatureFlagRulesMock(...args),
}));

const listAction = (await import("./list-feature-flags.js")).default;
const setAction = (await import("./set-feature-flag.js")).default;

beforeEach(() => {
  vi.clearAllMocks();
  listFeatureFlagsMock.mockReturnValue([
    { key: "new-editor", defaultValue: false },
  ]);
  getFeatureFlagDefinitionMock.mockReturnValue({ key: "new-editor" });
  requireFeatureFlagManagerMock.mockResolvedValue({
    email: "admin@example.com",
    orgId: "org-1",
  });
  defaultFeatureFlagRulesMock.mockReturnValue({
    version: 1,
    mode: "off",
    emails: [],
    orgIds: [],
    percentage: 0,
    updatedAt: null,
    updatedBy: null,
  });
  getFeatureFlagRulesMock.mockResolvedValue({
    version: 1,
    mode: "off",
    emails: [],
    orgIds: [],
    percentage: 0,
    updatedAt: 123,
    updatedBy: "admin@example.com",
  });
});

describe("feature flag action contracts", () => {
  it("does not leak operator rules to a non-manager", async () => {
    requireFeatureFlagManagerMock.mockRejectedValue(
      Object.assign(new Error("forbidden"), { statusCode: 403 }),
    );

    await expect(listAction.run({}, { caller: "frontend" })).resolves.toEqual({
      contractVersion: 1,
      status: "forbidden",
      reason: "forbidden",
      flags: [],
      canManage: false,
    });
    expect(getFeatureFlagRulesMock).not.toHaveBeenCalled();
  });

  it("reports no definitions only after authorizing the manager", async () => {
    listFeatureFlagsMock.mockReturnValue([]);

    await expect(
      listAction.run(
        {},
        { caller: "a2a", userEmail: "admin@example.com", orgId: "org-1" },
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      status: "no-definitions",
      reason: "no-definitions",
      flags: [],
      canManage: true,
    });
    expect(requireFeatureFlagManagerMock).toHaveBeenCalledOnce();
  });

  it("keeps administrative mutation out of extensions and returns persisted rules", async () => {
    const result = await setAction.run(
      { operation: "off", key: "new-editor" },
      { caller: "tool", userEmail: "admin@example.com", orgId: "org-1" },
    );

    expect(setAction.toolCallable).toBe(false);
    expect(setAction.agentInputSchema).toBeDefined();
    expect(setAction.audit).toEqual(
      expect.objectContaining({
        target: expect.any(Function),
        summary: expect.any(Function),
      }),
    );
    expect(mutateFeatureFlagRulesMock).toHaveBeenCalledWith(
      "new-editor",
      { email: "admin@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(result).toEqual({
      contractVersion: 1,
      status: "ready",
      key: "new-editor",
      rules: expect.objectContaining({
        updatedAt: expect.any(Number),
        updatedBy: "admin@example.com",
      }),
      scope: { orgId: "org-1" },
    });
  });

  it("does not narrow a globally-on flag when enabling the current user", async () => {
    getFeatureFlagRulesMock.mockResolvedValueOnce({
      version: 1,
      mode: "on",
      emails: [],
      orgIds: [],
      percentage: 0,
      updatedAt: 5,
      updatedBy: "other@example.com",
    });

    await setAction.run(
      { operation: "enable-for-current-user", key: "new-editor" },
      { caller: "tool", userEmail: "admin@example.com", orgId: "org-1" },
    );

    expect(normalizeFeatureFlagRulesMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "on", emails: ["admin@example.com"] }),
    );
  });

  it("derives replacement rules inside the atomic mutation", async () => {
    await setAction.run(
      {
        operation: "replace-rules",
        key: "new-editor",
        rules: { mode: "rules", percentage: 50 },
      },
      { caller: "tool", userEmail: "admin@example.com", orgId: "org-1" },
    );

    expect(mutateFeatureFlagRulesMock).toHaveBeenCalledOnce();
    expect(normalizeFeatureFlagRulesMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "rules", percentage: 50 }),
    );
  });
});
