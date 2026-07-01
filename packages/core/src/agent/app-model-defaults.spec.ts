import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory settings store so we can assert org/user scoping isolation.
const orgStore = new Map<string, Record<string, unknown>>();
const userStore = new Map<string, Record<string, unknown>>();

function orgK(orgId: string, key: string) {
  return `${orgId}::${key}`;
}
function userK(email: string, key: string) {
  return `${email}::${key}`;
}

vi.mock("../settings/index.js", () => ({
  getOrgSetting: vi.fn(async (orgId: string, key: string) =>
    orgStore.has(orgK(orgId, key)) ? orgStore.get(orgK(orgId, key))! : null,
  ),
  putOrgSetting: vi.fn(
    async (orgId: string, key: string, value: Record<string, unknown>) => {
      orgStore.set(orgK(orgId, key), value);
    },
  ),
  deleteOrgSetting: vi.fn(async (orgId: string, key: string) =>
    orgStore.delete(orgK(orgId, key)),
  ),
  getUserSetting: vi.fn(async (email: string, key: string) =>
    userStore.has(userK(email, key)) ? userStore.get(userK(email, key))! : null,
  ),
  putUserSetting: vi.fn(
    async (email: string, key: string, value: Record<string, unknown>) => {
      userStore.set(userK(email, key), value);
    },
  ),
  deleteUserSetting: vi.fn(async (email: string, key: string) =>
    userStore.delete(userK(email, key)),
  ),
}));

let roleRows: Array<{ role: string }> = [];
let roleQueryThrows = false;
const execute = vi.fn(async () => {
  if (roleQueryThrows) throw new Error("db down");
  return { rows: roleRows, rowsAffected: 0 };
});

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  isPostgres: () => false,
}));

// Request-context resolver values for getAgentAppModelDefaultForCurrentRequest.
let requestUserEmail: string | undefined;
let requestOrgId: string | undefined;
vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => requestUserEmail,
  getRequestOrgId: () => requestOrgId,
}));

const {
  AGENT_APP_MODEL_DEFAULT_KEY_PREFIX,
  normalizeAgentAppModelDefaultAppId,
  agentAppModelDefaultSettingsKey,
  readAgentAppModelDefaultSettings,
  writeAgentAppModelDefaultSettings,
  resetAgentAppModelDefaultSettings,
  canUpdateAgentAppModelDefaultSettings,
  getAgentAppModelDefaultForCurrentRequest,
} = await import("./app-model-defaults.js");

beforeEach(() => {
  orgStore.clear();
  userStore.clear();
  roleRows = [];
  roleQueryThrows = false;
  requestUserEmail = undefined;
  requestOrgId = undefined;
  execute.mockClear();
});

describe("normalizeAgentAppModelDefaultAppId", () => {
  it("trims and lower-cases valid slugs", () => {
    expect(normalizeAgentAppModelDefaultAppId("  Mail  ")).toBe("mail");
    expect(normalizeAgentAppModelDefaultAppId("my-app-2")).toBe("my-app-2");
  });

  it("rejects empty, nullish, and structurally invalid ids", () => {
    expect(normalizeAgentAppModelDefaultAppId(null)).toBeNull();
    expect(normalizeAgentAppModelDefaultAppId(undefined)).toBeNull();
    expect(normalizeAgentAppModelDefaultAppId("")).toBeNull();
    expect(normalizeAgentAppModelDefaultAppId("   ")).toBeNull();
    // Must start with a letter.
    expect(normalizeAgentAppModelDefaultAppId("2cool")).toBeNull();
    expect(normalizeAgentAppModelDefaultAppId("-leading")).toBeNull();
    // No underscores, spaces, dots, or other punctuation.
    expect(normalizeAgentAppModelDefaultAppId("my_app")).toBeNull();
    expect(normalizeAgentAppModelDefaultAppId("a b")).toBeNull();
    expect(normalizeAgentAppModelDefaultAppId("a.b")).toBeNull();
  });

  it("builds a namespaced settings key", () => {
    expect(agentAppModelDefaultSettingsKey("mail")).toBe(
      `${AGENT_APP_MODEL_DEFAULT_KEY_PREFIX}:mail`,
    );
  });
});

describe("readAgentAppModelDefaultSettings", () => {
  it("throws on an invalid appId", async () => {
    await expect(
      readAgentAppModelDefaultSettings({ orgId: "org1" }, "bad id"),
    ).rejects.toThrow(/valid appId/);
  });

  it("returns empty default scope when unauthenticated and nothing stored", async () => {
    const s = await readAgentAppModelDefaultSettings({}, "mail");
    expect(s).toEqual({
      appId: "mail",
      engine: null,
      model: null,
      scope: "default",
      source: "default",
    });
  });

  it("reads org scope and ignores a user value for the same app", async () => {
    orgStore.set(orgK("org1", agentAppModelDefaultSettingsKey("mail")), {
      engine: "builder",
      model: "claude-sonnet-5",
      updatedAt: 123,
      updatedBy: "boss@x.com",
    });
    userStore.set(userK("a@b.com", agentAppModelDefaultSettingsKey("mail")), {
      engine: "anthropic",
      model: "should-not-win",
    });
    const s = await readAgentAppModelDefaultSettings(
      { orgId: "org1", userEmail: "a@b.com" },
      "mail",
    );
    expect(s.scope).toBe("org");
    expect(s.source).toBe("org");
    expect(s.engine).toBe("builder");
    expect(s.model).toBe("claude-sonnet-5");
    expect(s.updatedAt).toBe(123);
    expect(s.updatedBy).toBe("boss@x.com");
  });

  it("reads user scope when no org and normalizes the appId casing for the key", async () => {
    userStore.set(userK("a@b.com", agentAppModelDefaultSettingsKey("mail")), {
      engine: "anthropic",
      model: "claude-opus-4-8",
    });
    const s = await readAgentAppModelDefaultSettings(
      { userEmail: "a@b.com" },
      "MAIL",
    );
    expect(s.scope).toBe("user");
    expect(s.source).toBe("user");
    expect(s.engine).toBe("anthropic");
    expect(s.appId).toBe("mail");
  });

  it("treats a stored row missing engine or model as empty (parse guard)", async () => {
    orgStore.set(orgK("org1", agentAppModelDefaultSettingsKey("mail")), {
      engine: "  ",
      model: "x",
    });
    const s = await readAgentAppModelDefaultSettings({ orgId: "org1" }, "mail");
    expect(s.engine).toBeNull();
    expect(s.model).toBeNull();
    expect(s.source).toBe("default");
    // Scope still reflects where we looked.
    expect(s.scope).toBe("org");
  });

  it("drops a non-finite updatedAt and a non-string updatedBy", async () => {
    orgStore.set(orgK("org1", agentAppModelDefaultSettingsKey("mail")), {
      engine: "builder",
      model: "m",
      updatedAt: Number.NaN,
      updatedBy: 42,
    });
    const s = await readAgentAppModelDefaultSettings({ orgId: "org1" }, "mail");
    expect(s.updatedAt).toBeUndefined();
    expect(s.updatedBy).toBeUndefined();
  });
});

describe("writeAgentAppModelDefaultSettings", () => {
  it("persists org selection with a timestamp and updatedBy", async () => {
    const before = Date.now();
    const s = await writeAgentAppModelDefaultSettings(
      { orgId: "org1" },
      "mail",
      {
        engine: " builder ",
        model: " claude-sonnet-5 ",
        updatedBy: "u@x.com",
      },
    );
    expect(s.engine).toBe("builder");
    expect(s.model).toBe("claude-sonnet-5");
    const stored = orgStore.get(
      orgK("org1", agentAppModelDefaultSettingsKey("mail")),
    )!;
    expect(stored.engine).toBe("builder");
    expect(stored.model).toBe("claude-sonnet-5");
    expect(stored.updatedBy).toBe("u@x.com");
    expect(typeof stored.updatedAt).toBe("number");
    expect(stored.updatedAt as number).toBeGreaterThanOrEqual(before);
  });

  it("omits updatedBy when not supplied", async () => {
    await writeAgentAppModelDefaultSettings({ userEmail: "a@b.com" }, "mail", {
      engine: "anthropic",
      model: "claude-opus-4-8",
    });
    const stored = userStore.get(
      userK("a@b.com", agentAppModelDefaultSettingsKey("mail")),
    )!;
    expect("updatedBy" in stored).toBe(false);
  });

  it("rejects blank engine or model after trimming", async () => {
    await expect(
      writeAgentAppModelDefaultSettings({ orgId: "org1" }, "mail", {
        engine: "   ",
        model: "m",
      }),
    ).rejects.toThrow(/engine is required/);
    await expect(
      writeAgentAppModelDefaultSettings({ orgId: "org1" }, "mail", {
        engine: "builder",
        model: "  ",
      }),
    ).rejects.toThrow(/model is required/);
    expect(orgStore.size).toBe(0);
  });

  it("rejects an invalid appId", async () => {
    await expect(
      writeAgentAppModelDefaultSettings({ orgId: "org1" }, "bad id", {
        engine: "builder",
        model: "m",
      }),
    ).rejects.toThrow(/valid appId/);
  });

  it("requires authentication when neither org nor user is present", async () => {
    await expect(
      writeAgentAppModelDefaultSettings({}, "mail", {
        engine: "builder",
        model: "m",
      }),
    ).rejects.toThrow(/Authentication required/);
  });
});

describe("resetAgentAppModelDefaultSettings", () => {
  it("clears the org selection and returns empty", async () => {
    orgStore.set(orgK("org1", agentAppModelDefaultSettingsKey("mail")), {
      engine: "builder",
      model: "m",
    });
    const s = await resetAgentAppModelDefaultSettings(
      { orgId: "org1" },
      "mail",
    );
    expect(orgStore.size).toBe(0);
    expect(s.engine).toBeNull();
    expect(s.model).toBeNull();
  });

  it("clears the user selection when no org is present", async () => {
    userStore.set(userK("a@b.com", agentAppModelDefaultSettingsKey("mail")), {
      engine: "anthropic",
      model: "m",
    });
    await resetAgentAppModelDefaultSettings({ userEmail: "a@b.com" }, "mail");
    expect(userStore.size).toBe(0);
  });

  it("requires authentication when unauthenticated", async () => {
    await expect(resetAgentAppModelDefaultSettings({}, "mail")).rejects.toThrow(
      /Authentication required/,
    );
  });
});

describe("canUpdateAgentAppModelDefaultSettings", () => {
  it("denies unauthenticated callers", async () => {
    expect(await canUpdateAgentAppModelDefaultSettings(null, "org1")).toBe(
      false,
    );
  });

  it("allows any signed-in user with no org (personal scope)", async () => {
    expect(await canUpdateAgentAppModelDefaultSettings("a@b.com", null)).toBe(
      true,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows org owners and admins and denies plain members", async () => {
    roleRows = [{ role: "owner" }];
    expect(await canUpdateAgentAppModelDefaultSettings("a@b.com", "org1")).toBe(
      true,
    );
    roleRows = [{ role: "admin" }];
    expect(await canUpdateAgentAppModelDefaultSettings("a@b.com", "org1")).toBe(
      true,
    );
    roleRows = [{ role: "member" }];
    expect(await canUpdateAgentAppModelDefaultSettings("a@b.com", "org1")).toBe(
      false,
    );
  });

  it("denies when no membership row exists for the org", async () => {
    roleRows = [];
    expect(await canUpdateAgentAppModelDefaultSettings("a@b.com", "org1")).toBe(
      false,
    );
  });

  it("scopes the membership lookup to the org and a lower-cased email", async () => {
    roleRows = [{ role: "owner" }];
    await canUpdateAgentAppModelDefaultSettings("Mixed@Case.COM", "org1");
    const call = execute.mock.calls.at(-1)![0] as { args: unknown[] };
    expect(call.args).toEqual(["org1", "mixed@case.com"]);
  });

  it("fails closed when the membership query throws", async () => {
    roleQueryThrows = true;
    expect(await canUpdateAgentAppModelDefaultSettings("a@b.com", "org1")).toBe(
      false,
    );
  });
});

describe("getAgentAppModelDefaultForCurrentRequest", () => {
  it("returns null for an invalid appId without touching settings", async () => {
    expect(await getAgentAppModelDefaultForCurrentRequest("bad id")).toBeNull();
  });

  it("resolves the org-scoped selection from request context, ignoring the user value", async () => {
    requestOrgId = "org1";
    requestUserEmail = "a@b.com";
    orgStore.set(orgK("org1", agentAppModelDefaultSettingsKey("mail")), {
      engine: "builder",
      model: "claude-sonnet-5",
      updatedAt: 1,
      updatedBy: "boss@x.com",
    });
    // A conflicting user-scoped value must NOT leak when an org is in context.
    userStore.set(userK("a@b.com", agentAppModelDefaultSettingsKey("mail")), {
      engine: "anthropic",
      model: "should-not-win",
    });
    const sel = await getAgentAppModelDefaultForCurrentRequest("mail");
    // Only engine + model are returned (no metadata leakage); org wins.
    expect(sel).toEqual({ engine: "builder", model: "claude-sonnet-5" });
  });

  it("returns null when nothing is stored for the request scope", async () => {
    requestUserEmail = "a@b.com";
    expect(await getAgentAppModelDefaultForCurrentRequest("mail")).toBeNull();
  });
});
