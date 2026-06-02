import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory settings store keyed by the helper + scope id, so we can assert
// org/user isolation without a real DB.
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

// Role lookup for canUpdate; tests set the row to return.
let roleRows: Array<{ role: string }> = [];
let roleQueryThrows = false;
const execute = vi.fn(async (_q: { sql: string; args: unknown[] }) => {
  if (roleQueryThrows) throw new Error("db down");
  return { rows: roleRows, rowsAffected: 0 };
});

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  isPostgres: () => false,
}));

const {
  AGENT_LOOP_SETTINGS_KEY,
  DEFAULT_AGENT_MAX_ITERATIONS,
  MIN_AGENT_MAX_ITERATIONS,
  MAX_AGENT_MAX_ITERATIONS,
  normalizeMaxIterations,
  validateMaxIterationsInput,
  getDefaultMaxIterations,
  readAgentLoopSettings,
  writeAgentLoopSettings,
  resetAgentLoopSettings,
  canUpdateAgentLoopSettings,
} = await import("./loop-settings.js");

beforeEach(() => {
  orgStore.clear();
  userStore.clear();
  roleRows = [];
  roleQueryThrows = false;
  execute.mockClear();
  vi.unstubAllEnvs();
});

describe("normalizeMaxIterations", () => {
  it("clamps below the minimum up and above the maximum down", () => {
    expect(normalizeMaxIterations(0)).toBe(MIN_AGENT_MAX_ITERATIONS);
    expect(normalizeMaxIterations(-50)).toBe(MIN_AGENT_MAX_ITERATIONS);
    expect(normalizeMaxIterations(99999)).toBe(MAX_AGENT_MAX_ITERATIONS);
  });

  it("returns valid in-range integers unchanged", () => {
    expect(normalizeMaxIterations(42)).toBe(42);
    expect(normalizeMaxIterations(MAX_AGENT_MAX_ITERATIONS)).toBe(
      MAX_AGENT_MAX_ITERATIONS,
    );
  });

  it("parses numeric strings", () => {
    expect(normalizeMaxIterations("7")).toBe(7);
  });

  it("falls back when the value is not a finite integer", () => {
    expect(normalizeMaxIterations(undefined)).toBe(
      DEFAULT_AGENT_MAX_ITERATIONS,
    );
    expect(normalizeMaxIterations("")).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
    expect(normalizeMaxIterations("abc")).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
    expect(normalizeMaxIterations(3.5)).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
    expect(normalizeMaxIterations(NaN)).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
    expect(normalizeMaxIterations(Infinity)).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });

  it("honors a caller-supplied fallback", () => {
    expect(normalizeMaxIterations(null, 25)).toBe(25);
  });
});

describe("validateMaxIterationsInput", () => {
  it("accepts in-range integers", () => {
    expect(validateMaxIterationsInput(50)).toEqual({ ok: true, value: 50 });
    expect(validateMaxIterationsInput("50")).toEqual({ ok: true, value: 50 });
  });

  it("rejects non-integers with a clear error", () => {
    expect(validateMaxIterationsInput(2.5)).toEqual({
      ok: false,
      error: "maxIterations must be an integer.",
    });
    expect(validateMaxIterationsInput("nope").ok).toBe(false);
  });

  it("rejects values below the minimum and above the maximum", () => {
    expect(validateMaxIterationsInput(0)).toEqual({
      ok: false,
      error: `maxIterations must be at least ${MIN_AGENT_MAX_ITERATIONS}.`,
    });
    expect(validateMaxIterationsInput(MAX_AGENT_MAX_ITERATIONS + 1)).toEqual({
      ok: false,
      error: `maxIterations must be at most ${MAX_AGENT_MAX_ITERATIONS}.`,
    });
  });
});

describe("getDefaultMaxIterations env override", () => {
  it("uses the framework default when AGENT_MAX_ITERATIONS is unset", () => {
    expect(getDefaultMaxIterations()).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });

  it("reads and clamps the env override", () => {
    vi.stubEnv("AGENT_MAX_ITERATIONS", "5");
    expect(getDefaultMaxIterations()).toBe(5);
    vi.stubEnv("AGENT_MAX_ITERATIONS", "100000");
    expect(getDefaultMaxIterations()).toBe(MAX_AGENT_MAX_ITERATIONS);
  });

  it("ignores a non-integer env override", () => {
    vi.stubEnv("AGENT_MAX_ITERATIONS", "not-a-number");
    expect(getDefaultMaxIterations()).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });
});

describe("readAgentLoopSettings scope resolution", () => {
  it("returns default scope/source when unauthenticated", async () => {
    const s = await readAgentLoopSettings({});
    expect(s.scope).toBe("default");
    expect(s.source).toBe("default");
    expect(s.maxIterations).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
    expect(s.minMaxIterations).toBe(MIN_AGENT_MAX_ITERATIONS);
    expect(s.maxMaxIterations).toBe(MAX_AGENT_MAX_ITERATIONS);
  });

  it("prefers org scope over user scope when both are present", async () => {
    orgStore.set(orgK("org1", AGENT_LOOP_SETTINGS_KEY), { maxIterations: 7 });
    userStore.set(userK("a@b.com", AGENT_LOOP_SETTINGS_KEY), {
      maxIterations: 999,
    });
    const s = await readAgentLoopSettings({
      orgId: "org1",
      userEmail: "a@b.com",
    });
    expect(s.scope).toBe("org");
    expect(s.source).toBe("org");
    expect(s.maxIterations).toBe(7);
  });

  it("falls to user scope when there is no org", async () => {
    userStore.set(userK("a@b.com", AGENT_LOOP_SETTINGS_KEY), {
      maxIterations: 33,
    });
    const s = await readAgentLoopSettings({ userEmail: "a@b.com" });
    expect(s.scope).toBe("user");
    expect(s.source).toBe("user");
    expect(s.maxIterations).toBe(33);
  });

  it("clamps an out-of-range stored value on read", async () => {
    orgStore.set(orgK("org1", AGENT_LOOP_SETTINGS_KEY), {
      maxIterations: 1000000,
    });
    const s = await readAgentLoopSettings({ orgId: "org1" });
    expect(s.maxIterations).toBe(MAX_AGENT_MAX_ITERATIONS);
  });

  it("uses the env default and source=env when stored row lacks maxIterations", async () => {
    vi.stubEnv("AGENT_MAX_ITERATIONS", "12");
    orgStore.set(orgK("org1", AGENT_LOOP_SETTINGS_KEY), { unrelated: true });
    const s = await readAgentLoopSettings({ orgId: "org1" });
    // No stored maxIterations -> defaultMaxIterations and env source.
    expect(s.maxIterations).toBe(12);
    expect(s.defaultMaxIterations).toBe(12);
    expect(s.source).toBe("env");
    expect(s.scope).toBe("org");
  });

  it("keeps source=scope (not env) when a row stores maxIterations even with the env set", async () => {
    // The stored value wins; source must reflect where it came from, not env.
    vi.stubEnv("AGENT_MAX_ITERATIONS", "12");
    orgStore.set(orgK("org1", AGENT_LOOP_SETTINGS_KEY), { maxIterations: 42 });
    const s = await readAgentLoopSettings({ orgId: "org1" });
    expect(s.maxIterations).toBe(42);
    expect(s.source).toBe("org");
    // The env still informs the surfaced default even though it is not used.
    expect(s.defaultMaxIterations).toBe(12);
  });
});

describe("writeAgentLoopSettings", () => {
  it("writes org settings and echoes the persisted value", async () => {
    const s = await writeAgentLoopSettings({ orgId: "org1" }, 80);
    expect(s.maxIterations).toBe(80);
    expect(s.scope).toBe("org");
    expect(orgStore.get(orgK("org1", AGENT_LOOP_SETTINGS_KEY))).toEqual({
      maxIterations: 80,
    });
  });

  it("writes user settings when no org is present", async () => {
    const s = await writeAgentLoopSettings({ userEmail: "a@b.com" }, 60);
    expect(s.scope).toBe("user");
    expect(userStore.get(userK("a@b.com", AGENT_LOOP_SETTINGS_KEY))).toEqual({
      maxIterations: 60,
    });
  });

  it("rejects invalid input before any write", async () => {
    await expect(writeAgentLoopSettings({ orgId: "org1" }, 0)).rejects.toThrow(
      /at least/,
    );
    expect(orgStore.size).toBe(0);
  });

  it("requires authentication when neither org nor user is set", async () => {
    await expect(writeAgentLoopSettings({}, 50)).rejects.toThrow(
      /Authentication required/,
    );
  });
});

describe("resetAgentLoopSettings", () => {
  it("deletes the org setting and reverts to the env/default", async () => {
    orgStore.set(orgK("org1", AGENT_LOOP_SETTINGS_KEY), { maxIterations: 7 });
    const s = await resetAgentLoopSettings({ orgId: "org1" });
    expect(orgStore.has(orgK("org1", AGENT_LOOP_SETTINGS_KEY))).toBe(false);
    expect(s.maxIterations).toBe(DEFAULT_AGENT_MAX_ITERATIONS);
  });

  it("deletes the user setting when no org is present", async () => {
    userStore.set(userK("a@b.com", AGENT_LOOP_SETTINGS_KEY), {
      maxIterations: 7,
    });
    await resetAgentLoopSettings({ userEmail: "a@b.com" });
    expect(userStore.has(userK("a@b.com", AGENT_LOOP_SETTINGS_KEY))).toBe(
      false,
    );
  });

  it("requires authentication when unauthenticated", async () => {
    await expect(resetAgentLoopSettings({})).rejects.toThrow(
      /Authentication required/,
    );
  });
});

describe("canUpdateAgentLoopSettings", () => {
  it("denies unauthenticated callers", async () => {
    expect(await canUpdateAgentLoopSettings(null, "org1")).toBe(false);
    expect(await canUpdateAgentLoopSettings(undefined, "org1")).toBe(false);
  });

  it("allows any signed-in user when there is no org (personal scope)", async () => {
    expect(await canUpdateAgentLoopSettings("a@b.com", null)).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows org owners and admins only", async () => {
    roleRows = [{ role: "owner" }];
    expect(await canUpdateAgentLoopSettings("a@b.com", "org1")).toBe(true);
    roleRows = [{ role: "admin" }];
    expect(await canUpdateAgentLoopSettings("a@b.com", "org1")).toBe(true);
  });

  it("denies non-admin org members", async () => {
    roleRows = [{ role: "member" }];
    expect(await canUpdateAgentLoopSettings("a@b.com", "org1")).toBe(false);
  });

  it("denies when the member row is missing", async () => {
    roleRows = [];
    expect(await canUpdateAgentLoopSettings("a@b.com", "org1")).toBe(false);
  });

  it("lower-cases the email in the membership lookup", async () => {
    roleRows = [{ role: "owner" }];
    await canUpdateAgentLoopSettings("Mixed@Case.COM", "org1");
    const call = execute.mock.calls.at(-1)![0] as { args: unknown[] };
    expect(call.args).toEqual(["org1", "mixed@case.com"]);
  });

  it("denies (fails closed) when the role query throws", async () => {
    roleQueryThrows = true;
    expect(await canUpdateAgentLoopSettings("a@b.com", "org1")).toBe(false);
  });
});
