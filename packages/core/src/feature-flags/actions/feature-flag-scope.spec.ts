import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
}));

const rows = new Map<string, string>();
const corruptKeys = new Set<string>();
const readRow = (key: string) => {
  const raw = rows.get(key);
  if (raw === undefined) return { found: false as const };
  if (corruptKeys.has(key)) throw new SyntaxError("Unexpected token");
  return { found: true as const, value: JSON.parse(raw) };
};
const mutateRow = async (
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
) => {
  const raw = rows.get(key);
  const next = await updater(raw === undefined ? null : JSON.parse(raw));
  rows.set(key, JSON.stringify(next));
  return next;
};
const orgKey = (orgId: string, key: string) => `o:${orgId}:${key}`;

vi.mock("../../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../settings/store.js")>()),
  getSetting: async (key: string) => {
    const entry = readRow(key);
    return entry.found ? entry.value : null;
  },
  getSettingEntry: async (key: string) => readRow(key),
  mutateSetting: (key: string, updater: any) => mutateRow(key, updater),
}));
vi.mock("../../settings/org-settings.js", () => ({
  getOrgSetting: async (orgId: string, key: string) => {
    const entry = readRow(orgKey(orgId, key));
    return entry.found ? entry.value : null;
  },
  getOrgSettingEntry: async (orgId: string, key: string) =>
    readRow(orgKey(orgId, key)),
  mutateOrgSetting: (orgId: string, key: string, updater: any) =>
    mutateRow(orgKey(orgId, key), updater),
}));
vi.mock("../../db/client.js", () => ({
  getDbExec: () => ({ execute: vi.fn(async () => ({ rows: [] })) }),
}));

const roles = new Map<string, string>();
vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: async (orgId: string, email: string) =>
    roles.get(`${orgId}:${email}`) ?? null,
}));
vi.mock("../../org/context.js", () => ({
  getOrgDomain: async () => "example.test",
}));

const verifyA2ATokenWithClaims = vi.fn();
const consumeOneTimeJti = vi.fn();
vi.mock("h3", () => ({
  getHeader: (_event: unknown, name: string) =>
    name === "authorization"
      ? "Bearer eyJhbGciOiJub25lIn0.eyJzY29wZSI6ImZsYWdzOndyaXRlIn0.signature"
      : undefined,
}));
vi.mock("../../a2a-claims.js", () => ({
  verifyA2ATokenWithClaims: (...args: unknown[]) =>
    verifyA2ATokenWithClaims(...args),
}));
vi.mock("../../server/identity-sso-store.js", () => ({
  consumeOneTimeJti: (...args: unknown[]) => consumeOneTimeJti(...args),
}));

const registry = await import("../registry.js");
const labsRegistry = await import("../../labs/registry.js");
const setAction = (await import("./set-feature-flag.js")).default;
const listAction = (await import("./list-feature-flags.js")).default;
const { createFeatureFlagA2AActionRouteAuth } =
  await import("../a2a-action-route.js");
const { runWithRequestContext } =
  await import("../../server/request-context.js");

const KEY = "new-editor";
const GLOBAL_ROW = `feature-flag:${KEY}`;
const ORG_ROW = `o:org-1:feature-flag:${KEY}`;
const owner = { userEmail: "owner@example.test", orgId: "org-1" };
const siteAdmin = { userEmail: "site-admin@example.test", orgId: "org-1" };
const turnOn = {
  operation: "replace-rules" as const,
  key: KEY,
  rules: { mode: "on" as const },
};
const stored = (key: string) => {
  const raw = rows.get(key);
  return raw === undefined ? undefined : JSON.parse(raw);
};

beforeEach(() => {
  rows.clear();
  corruptKeys.clear();
  roles.clear();
  vi.clearAllMocks();
  registry._resetFeatureFlagRegistryForTests();
  labsRegistry._resetLabRegistryForTests();
  registry.registerFeatureFlags([{ key: KEY }]);
  roles.set("org-1:owner@example.test", "owner");
  roles.set("org-1:site-admin@example.test", "member");
  roles.set("org-1:member@example.test", "member");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "AGENT_NATIVE_FEATURE_FLAG_ADMIN_EMAILS",
    "site-admin@example.test",
  );
  consumeOneTimeJti.mockResolvedValue(false);
});

describe("set-feature-flag scope", () => {
  it("keeps an explicit scope through schema parsing", () => {
    expect(setAction.schema.parse({ ...turnOn, scope: "global" })).toEqual(
      expect.objectContaining({ scope: "global" }),
    );
    expect(() =>
      setAction.schema.parse({ ...turnOn, scope: "everyone" }),
    ).toThrow();
  });

  it("refuses a global write from an org owner who is not on the admin list", async () => {
    await expect(
      setAction.run({ ...turnOn, scope: "global" }, owner),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(stored(GLOBAL_ROW)).toBeUndefined();
  });

  it("lands a listed admin's global write in the global row while they sit in an org", async () => {
    const result = await setAction.run(
      { ...turnOn, scope: "global" },
      siteAdmin,
    );

    expect(result.scope).toEqual({
      kind: "global",
      orgId: null,
      orgDomain: null,
    });
    expect(stored(GLOBAL_ROW)).toMatchObject({
      mode: "on",
      updatedBy: "site-admin@example.test",
    });
    expect(stored(ORG_ROW)).toBeUndefined();
  });

  it("still requires an org owner or admin for an org write, list or no list", async () => {
    await expect(
      setAction.run({ ...turnOn, scope: "org" }, siteAdmin),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      setAction.run(
        { ...turnOn, scope: "org" },
        { userEmail: "member@example.test", orgId: "org-1" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    const result = await setAction.run({ ...turnOn, scope: "org" }, owner);
    expect(result.scope).toEqual({
      kind: "org",
      orgId: "org-1",
      orgDomain: "example.test",
    });
    expect(stored(ORG_ROW)).toMatchObject({ mode: "on" });
    expect(stored(GLOBAL_ROW)).toBeUndefined();
  });

  it("writes the active org's rule when scope is omitted, even for a listed admin", async () => {
    roles.set("org-1:site-admin@example.test", "admin");

    const result = await setAction.run(turnOn, siteAdmin);

    expect(result.scope.kind).toBe("org");
    expect(stored(ORG_ROW)).toMatchObject({ mode: "on" });
    expect(stored(GLOBAL_ROW)).toBeUndefined();
  });

  it("writes the global rule when scope is omitted by a caller with no org", async () => {
    await expect(
      setAction.run(turnOn, { userEmail: "owner@example.test", orgId: null }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const result = await setAction.run(turnOn, {
      userEmail: "site-admin@example.test",
      orgId: null,
    });
    expect(result.scope.kind).toBe("global");
    expect(stored(GLOBAL_ROW)).toMatchObject({ mode: "on" });
  });

  it("refuses an org write from a caller with no org", async () => {
    await expect(
      setAction.run(
        { ...turnOn, scope: "org" },
        { userEmail: "site-admin@example.test", orgId: null },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("list-feature-flags precedence", () => {
  it("reports the global rule, the org rule, and that the org rule applies", async () => {
    rows.set(GLOBAL_ROW, JSON.stringify({ version: 1, mode: "on" }));
    rows.set(
      ORG_ROW,
      JSON.stringify({ version: 1, mode: "rules", emails: ["a@example.test"] }),
    );

    const result = await listAction.run({}, owner);

    expect(result.flags).toEqual([
      expect.objectContaining({
        key: KEY,
        rules: expect.objectContaining({ mode: "rules" }),
        enabledForCurrentUser: false,
        scopes: {
          inEffect: "org",
          global: expect.objectContaining({
            state: "set",
            rules: expect.objectContaining({ mode: "on" }),
            canManage: false,
          }),
          org: expect.objectContaining({
            orgId: "org-1",
            state: "set",
            rules: expect.objectContaining({ mode: "rules" }),
            canManage: true,
          }),
        },
      }),
    ]);
  });

  it("reports the global rule in effect when the org has none", async () => {
    rows.set(GLOBAL_ROW, JSON.stringify({ version: 1, mode: "on" }));

    const result = await listAction.run({}, siteAdmin);

    expect(result.status).toBe("ready");
    expect(result.flags[0]).toMatchObject({
      enabledForCurrentUser: true,
      scopes: {
        inEffect: "global",
        global: { state: "set", canManage: true },
        org: { orgId: "org-1", state: "unset", canManage: false },
      },
    });
  });

  it("tells no rule apart from a rule that could not be read", async () => {
    let result = await listAction.run({}, owner);
    expect(result.flags[0]).toMatchObject({
      rules: expect.objectContaining({ mode: "off" }),
      scopes: { inEffect: "none", global: { state: "unset" } },
    });

    rows.set(ORG_ROW, JSON.stringify({ version: 1, mode: "everyone" }));
    rows.set(GLOBAL_ROW, "{");
    corruptKeys.add(GLOBAL_ROW);
    result = await listAction.run({}, owner);

    const [flag] = result.flags;
    expect(flag).not.toHaveProperty("rules");
    expect(flag).not.toHaveProperty("enabledForCurrentUser");
    expect(flag?.scopes).toEqual({
      inEffect: "org",
      global: {
        state: "unreadable",
        problem: "stored rules are not JSON",
        canManage: false,
      },
      org: {
        orgId: "org-1",
        state: "unreadable",
        problem: expect.stringContaining("mode"),
        canManage: true,
      },
    });
  });

  it("stays forbidden for a member who is not on the admin list", async () => {
    await expect(
      listAction.run({}, { userEmail: "member@example.test", orgId: "org-1" }),
    ).resolves.toMatchObject({ status: "forbidden", flags: [] });
  });
});

describe("A2A global writes", () => {
  const event = {} as any;
  const delegate = async (email: string, jti: string) => {
    verifyA2ATokenWithClaims.mockResolvedValue({
      email,
      orgId: "org-1",
      orgDomain: "example.test",
      scope: ["flags:write"],
      jti,
    });
    const caller =
      await createFeatureFlagA2AActionRouteAuth(
        "set-feature-flag",
      ).resolveCaller(event);
    return setAction.run(
      { ...turnOn, scope: "global" },
      { caller: "a2a", userEmail: caller!.owner, orgId: caller!.orgId },
    );
  };

  it("refuses a delegated email that is not on the target app's list", async () => {
    await expect(delegate("owner@example.test", "jti-1")).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(consumeOneTimeJti).toHaveBeenCalledWith("jti-1");
    expect(stored(GLOBAL_ROW)).toBeUndefined();
  });

  it("accepts a delegated email on the target app's list", async () => {
    await expect(
      delegate("site-admin@example.test", "jti-2"),
    ).resolves.toMatchObject({ scope: { kind: "global", orgId: null } });
    expect(consumeOneTimeJti).toHaveBeenCalledWith("jti-2");
    expect(stored(GLOBAL_ROW)).toMatchObject({ mode: "on" });
  });

  describe("from an org-member delegation", () => {
    const orgMember = {
      userEmail: "site-admin@example.test",
      orgId: "org-1",
      a2aIdentityAssurance: "org-member" as const,
    };

    it("refuses a global write even for an email on the list", async () => {
      await expect(
        runWithRequestContext(orgMember, () =>
          delegate("site-admin@example.test", "jti-4"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(stored(GLOBAL_ROW)).toBeUndefined();
    });

    it("gives an email on the list no read access either", async () => {
      await expect(
        runWithRequestContext(orgMember, () => listAction.run({}, orgMember)),
      ).resolves.toMatchObject({ status: "forbidden", flags: [] });
    });
  });

  it("still refuses a replayed delegation before writing", async () => {
    consumeOneTimeJti.mockResolvedValue(true);
    await expect(delegate("site-admin@example.test", "jti-3")).rejects.toThrow(
      "Invalid feature flag delegation",
    );
    expect(stored(GLOBAL_ROW)).toBeUndefined();
  });
});
