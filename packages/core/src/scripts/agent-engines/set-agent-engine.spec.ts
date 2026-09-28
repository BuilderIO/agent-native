import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => unknown) => fn(),
}));

const isStoredEngineUsableForRequest = vi.hoisted(() => vi.fn());

vi.mock("../../agent/engine/index.js", () => {
  const entry = {
    name: "ai-sdk:openai",
    label: "OpenAI",
    description: "",
    capabilities: {},
    defaultModel: "gpt-5.5",
    supportedModels: ["gpt-5.5"],
    requiredEnvVars: ["OPENAI_API_KEY"],
    create: vi.fn(),
  };
  return {
    listAgentEngines: () => [entry],
    getAgentEngineEntry: (name: string) =>
      name === "ai-sdk:openai" ? entry : undefined,
    isAgentEnginePackageInstalled: () => true,
    isStoredEngineUsableForRequest: (...args: unknown[]) =>
      isStoredEngineUsableForRequest(...args),
    normalizeModelForEngine: (_entry: unknown, model: string) => model,
    resolveEngineAcceptsCustomModels: () => false,
    resolveEnginePreservesCustomModels: () => false,
    registerBuiltinEngines: vi.fn(),
  };
});

const { run: runManage } = await import("./manage-agent-engine.js");
const { run: runSet } = await import("./set-agent-engine.js");
const { readDefaultAgentEngineSettingDetailed } =
  await import("../../agent/default-agent-engine.js");
const { runWithRequestContext } =
  await import("../../server/request-context.js");
const { getSetting } = await import("../../settings/store.js");
const { __resetAuditInitForTests } = await import("../../audit/store.js");

async function addMember(orgId: string, email: string, role: string) {
  await pglite.query(
    `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    [`${orgId}:${email}`, orgId, email, role, Date.now()],
  );
}

function as<T>(userEmail: string, orgId: string | undefined, fn: () => T) {
  return runWithRequestContext({ userEmail, orgId }, fn);
}

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetAuditInitForTests();
  isStoredEngineUsableForRequest.mockReset();
  isStoredEngineUsableForRequest.mockResolvedValue(true);
  await pglite.exec(`CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  await pglite.exec(`CREATE TABLE org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await addMember("org-a", "admin@a.test", "admin");
  await addMember("org-a", "member@a.test", "member");
  await addMember("org-b", "owner@b.test", "owner");
});

afterEach(async () => {
  await pglite.close();
  vi.clearAllMocks();
});

describe("manage-agent-engine set", () => {
  it("saves the default for the admin's org only", async () => {
    const result = JSON.parse(
      await as("admin@a.test", "org-a", () =>
        runManage({ action: "set", engine: "ai-sdk:openai", model: "gpt-5.5" }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      engine: "ai-sdk:openai",
      model: "gpt-5.5",
    });
    expect(isStoredEngineUsableForRequest).toHaveBeenCalledWith(
      { engine: "ai-sdk:openai" },
      expect.objectContaining({ requiredEnvVars: ["OPENAI_API_KEY"] }),
    );
    await expect(
      readDefaultAgentEngineSettingDetailed({
        userEmail: "admin@a.test",
        orgId: "org-a",
      }),
    ).resolves.toMatchObject({
      source: "org",
      value: { engine: "ai-sdk:openai", model: "gpt-5.5" },
    });
    await expect(
      readDefaultAgentEngineSettingDetailed({
        userEmail: "owner@b.test",
        orgId: "org-b",
      }),
    ).resolves.toEqual({ source: "none", value: null });
    expect(await getSetting("agent-engine")).toBeNull();
  });

  it("refuses a member with a 403 the agent can relay, and records the attempt", async () => {
    const refusal = as("member@a.test", "org-a", () =>
      runManage(
        { action: "set", engine: "ai-sdk:openai", model: "gpt-5.5" },
        { caller: "tool", actionName: "manage-agent-engine", threadId: "t1" },
      ),
    );

    await expect(refusal).rejects.toMatchObject({
      message:
        "Only organization owners and admins can change the default model.",
      errorCode: "default_model_admin_required",
      statusCode: 403,
    });
    await expect(
      readDefaultAgentEngineSettingDetailed({
        userEmail: "member@a.test",
        orgId: "org-a",
      }),
    ).resolves.toEqual({ source: "none", value: null });
    const { rows } = await pglite.query(
      `SELECT action, caller, actor_kind, actor_email, status, thread_id FROM agent_audit_log`,
    );
    expect(rows).toEqual([
      {
        action: "manage-agent-engine",
        caller: "tool",
        actor_kind: "agent",
        actor_email: "member@a.test",
        status: "denied",
        thread_id: "t1",
      },
    ]);
  });

  it("refuses an admin of another org", async () => {
    await expect(
      as("owner@b.test", "org-a", () =>
        runSet({ engine: "ai-sdk:openai", model: "gpt-5.5" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets a user with no organization set their own default", async () => {
    const result = JSON.parse(
      await as("solo@example.test", undefined, () =>
        runSet({ engine: "ai-sdk:openai" }),
      ),
    );
    expect(result).toMatchObject({ ok: true, model: "gpt-5.5" });
    await expect(
      readDefaultAgentEngineSettingDetailed({ userEmail: "solo@example.test" }),
    ).resolves.toMatchObject({ source: "user" });
  });

  it("warns without saving when required credentials are unreachable", async () => {
    isStoredEngineUsableForRequest.mockResolvedValue(false);

    const result = await as("admin@a.test", "org-a", () =>
      runSet({ engine: "ai-sdk:openai", model: "gpt-5.5" }),
    );

    expect(result).toMatch(/^Warning: .*OPENAI_API_KEY/);
    await expect(
      readDefaultAgentEngineSettingDetailed({
        userEmail: "admin@a.test",
        orgId: "org-a",
      }),
    ).resolves.toEqual({ source: "none", value: null });
  });

  it("reports an unknown engine as an error", async () => {
    await expect(
      as("admin@a.test", "org-a", () => runSet({ engine: "nope" })),
    ).resolves.toMatch(/^Error: Engine "nope" not found/);
  });
});
