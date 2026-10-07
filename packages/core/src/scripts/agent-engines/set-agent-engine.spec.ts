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
const getUserLabEnabled = vi.hoisted(() => vi.fn());
const listChatGPTSubscriptionModels = vi.hoisted(() => vi.fn());

vi.mock("../../agent/engine/index.js", () => {
  const entry = {
    name: "ai-sdk:openai",
    label: "OpenAI",
    description: "",
    capabilities: {},
    defaultModel: "gpt-5.5",
    supportedModels: [
      "gpt-5.5",
      "old-model",
      "calendar-model",
      "mail-model",
      "pinned-model",
    ],
    requiredEnvVars: ["OPENAI_API_KEY"],
    create: vi.fn(),
  };
  const chatGPTEntry = {
    name: "chatgpt-subscription",
    label: "ChatGPT plan access",
    description: "",
    capabilities: {},
    defaultModel: "personal-model",
    supportedModels: ["personal-model"],
    requiredEnvVars: [],
    create: vi.fn(),
  };
  return {
    listAgentEngines: () => [entry, chatGPTEntry],
    detectEngineFromEnv: () => null,
    detectEngineFromUserSecrets: async () => null,
    getAgentEngineEntry: (name: string) =>
      name === "ai-sdk:openai"
        ? entry
        : name === "chatgpt-subscription"
          ? chatGPTEntry
          : undefined,
    isAgentEnginePackageInstalled: () => true,
    isStoredEngineUsableForRequest: (...args: unknown[]) =>
      isStoredEngineUsableForRequest(...args),
    normalizeModelForEngine: (_entry: unknown, model: string) => model,
    resolveEngineAcceptsCustomModels: () => false,
    resolveEnginePreservesCustomModels: () => false,
    registerBuiltinEngines: vi.fn(),
  };
});

vi.mock("../../agent/engine/chatgpt-subscription-engine.js", () => ({
  listChatGPTSubscriptionModels: (...args: unknown[]) =>
    listChatGPTSubscriptionModels(...args),
}));

vi.mock("../../labs/store.js", () => ({
  getUserLabEnabled: (...args: unknown[]) => getUserLabEnabled(...args),
}));

const { run: runManage } = await import("./manage-agent-engine.js");
const { run: runSet } = await import("./set-agent-engine.js");
const { readAgentAppModelDefaultSettings, writeAgentAppModelDefaultSettings } =
  await import("../../agent/app-model-defaults.js");
const { defineAppConfig, resetAppConfigForTests, getAppConfig } =
  await import("../../app-config/index.js");
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
  resetAppConfigForTests();
  pglite = await createTestPglite();
  __resetAuditInitForTests();
  isStoredEngineUsableForRequest.mockReset();
  isStoredEngineUsableForRequest.mockResolvedValue(true);
  getUserLabEnabled.mockReset();
  getUserLabEnabled.mockResolvedValue(true);
  listChatGPTSubscriptionModels.mockReset();
  listChatGPTSubscriptionModels.mockResolvedValue({
    models: ["personal-model"],
    modelDisplayNames: { "personal-model": "Personal model" },
  });
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
  resetAppConfigForTests();
  await pglite.close();
  vi.clearAllMocks();
});

describe("manage-agent-engine set", () => {
  it.each([false, true])(
    "reports unavailable configuration and synthetic fallback truthfully (synthetic=%s)",
    async (isSyntheticTraffic) => {
      defineAppConfig({ agent: { engine: "chatgpt-subscription" } });
      isStoredEngineUsableForRequest.mockImplementation(
        (_stored, entry) => entry.name !== "chatgpt-subscription",
      );
      const ctx = {
        userEmail: "admin@a.test",
        orgId: "org-a",
        isSyntheticTraffic,
      };
      await writeAgentAppModelDefaultSettings(ctx, "calendar", {
        engine: "ai-sdk:openai",
        model: "old-model",
      });
      const result = JSON.parse(
        await runWithRequestContext(ctx, () =>
          runSet({ engine: "ai-sdk:openai", appId: "calendar" }),
        ),
      );
      expect(result.effective).toMatchObject(
        isSyntheticTraffic
          ? { configured: true, model: "old-model", source: "app-default" }
          : { configured: false, source: "configuration" },
      );
      expect(result.message).toContain(
        isSyntheticTraffic
          ? "Its app override is preserved"
          : "no usable model",
      );
    },
  );
  it("reports the app override when configured engine is unregistered", async () => {
    defineAppConfig({ agent: { engine: "missing-engine" } });
    const ctx = { userEmail: "admin@a.test", orgId: "org-a" };
    await writeAgentAppModelDefaultSettings(ctx, "calendar", {
      engine: "ai-sdk:openai",
      model: "old-model",
    });
    const result = JSON.parse(
      await as(ctx.userEmail, ctx.orgId, () =>
        runSet({ engine: "ai-sdk:openai", appId: "calendar" }),
      ),
    );
    expect(result.effective).toMatchObject({
      model: "old-model",
      source: "app-default",
    });
    expect(result.message).not.toContain("App configuration currently uses");
  });

  it("reports preserved configuration for app changes and explicit reset", async () => {
    defineAppConfig({
      agent: { engine: "ai-sdk:openai", model: "pinned-model" },
    });
    for (const action of ["set-app-default", "reset-app-default"]) {
      const result = JSON.parse(
        await as("admin@a.test", "org-a", () =>
          runManage({
            action,
            appId: "calendar",
            engine: "ai-sdk:openai",
            model: "old-model",
          }),
        ),
      );
      expect(result).toMatchObject({
        requestedScope: "app",
        effective: {
          configured: true,
          model: "pinned-model",
          source: "configuration",
        },
      });
      expect(result.message).toContain(
        "App configuration currently uses pinned-model",
      );
    }
  });
  it("uses the requesting app identity ahead of caller arguments", async () => {
    const ctx = { userEmail: "admin@a.test", orgId: "org-a" };
    for (const appId of ["calendar", "mail"]) {
      await writeAgentAppModelDefaultSettings(ctx, appId, {
        engine: "ai-sdk:openai",
        model: `${appId}-model`,
      });
    }
    const result = JSON.parse(
      await as(ctx.userEmail, ctx.orgId, () =>
        runManage(
          { action: "set", engine: "ai-sdk:openai", appId: "mail" },
          { ...ctx, appId: "calendar", caller: "tool" },
        ),
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      scope: "org",
      requestedScope: "org",
      appId: "calendar",
      appDefaultReset: false,
      effective: {
        engine: "ai-sdk:openai",
        model: "calendar-model",
        source: "app-default",
      },
    });
    expect(
      await readAgentAppModelDefaultSettings(ctx, "calendar"),
    ).toMatchObject({ model: "calendar-model" });
    expect(await readAgentAppModelDefaultSettings(ctx, "mail")).toMatchObject({
      model: "mail-model",
    });
  });

  it.each([
    { userEmail: "admin@a.test", orgId: "org-a" },
    { userEmail: "solo@example.test", orgId: undefined },
  ])(
    "preserves every app override and reports the effective model for $userEmail",
    async (ctx) => {
      defineAppConfig({ app: { id: "calendar" } });
      await writeAgentAppModelDefaultSettings(ctx, "calendar", {
        engine: "ai-sdk:openai",
        model: "old-model",
      });
      await writeAgentAppModelDefaultSettings(ctx, "mail", {
        engine: "ai-sdk:openai",
        model: "mail-model",
      });
      const result = JSON.parse(
        await as(ctx.userEmail, ctx.orgId, () =>
          runManage({
            action: "set",
            engine: "ai-sdk:openai",
            model: "gpt-5.5",
          }),
        ),
      );
      expect(result).toMatchObject({
        ok: true,
        scope: ctx.orgId ? "org" : "user",
        appId: "calendar",
        appDefaultReset: false,
        preservedOverrides: ["app-models", "chat-models", "automation-models"],
        effective: {
          engine: "ai-sdk:openai",
          model: "old-model",
          source: "app-default",
        },
      });
      expect(result.message).toContain("old-model");
      expect(result.message).toContain("calendar");
      expect(result.message).toContain("gpt-5.5");
      await expect(
        readAgentAppModelDefaultSettings(ctx, "calendar"),
      ).resolves.toMatchObject({ engine: "ai-sdk:openai", model: "old-model" });
      await expect(
        readAgentAppModelDefaultSettings(ctx, "mail"),
      ).resolves.toMatchObject({ model: "mail-model" });
    },
  );

  it("saves only the shared default and reports preserved deployment configuration", async () => {
    defineAppConfig({
      agent: { engine: "ai-sdk:openai", model: "pinned-model" },
    });
    const result = JSON.parse(
      await as("admin@a.test", "org-a", () =>
        runSet({ engine: "ai-sdk:openai", model: "gpt-5.5" }),
      ),
    );
    expect(result).toMatchObject({
      requestedScope: "org",
      model: "gpt-5.5",
      effective: { model: "pinned-model", source: "configuration" },
    });
    expect(result.message).toContain("pinned-model");
    expect(getAppConfig().agent.model).toBe("pinned-model");
    await expect(
      readDefaultAgentEngineSettingDetailed({ orgId: "org-a" }),
    ).resolves.toMatchObject({ value: { model: "gpt-5.5" } });
  });

  it("rejects unreadable app state before changing the shared default", async () => {
    defineAppConfig({ app: { id: "calendar" } });
    const execute = rawClient.execute.getMockImplementation()!;
    rawClient.execute.mockImplementation(async (input) => {
      if (
        typeof input !== "string" &&
        /^SELECT/i.test(input.sql) &&
        input.args?.[0] === "o:org-a:agent-app-model-default:calendar"
      ) {
        throw new Error("app default unreadable");
      }
      return execute(input);
    });
    try {
      await expect(
        as("admin@a.test", "org-a", () =>
          runSet({ engine: "ai-sdk:openai", model: "gpt-5.5" }),
        ),
      ).rejects.toThrow("app default unreadable");
      expect(await getSetting("o:org-a:agent-engine")).toBeNull();
    } finally {
      rawClient.execute.mockImplementation(execute);
    }
  });

  it("preserves an unavailable app override while reporting the usable shared default", async () => {
    const ctx = { userEmail: "admin@a.test", orgId: "org-a" };
    defineAppConfig({ app: { id: "calendar" } });
    await writeAgentAppModelDefaultSettings(ctx, "calendar", {
      engine: "unregistered-fixture",
      model: "old-model",
    });
    const result = JSON.parse(
      await as(ctx.userEmail, ctx.orgId, () =>
        runSet({ engine: "ai-sdk:openai" }),
      ),
    );
    expect(result).toMatchObject({
      scope: "org",
      effective: { model: "gpt-5.5", source: "org" },
      appDefaultReset: false,
    });
    expect(
      await readAgentAppModelDefaultSettings(ctx, "calendar"),
    ).toMatchObject({ engine: "unregistered-fixture", model: "old-model" });
  });

  it("does not clear the app override when the caller is a member", async () => {
    const ctx = { userEmail: "member@a.test", orgId: "org-a" };
    await writeAgentAppModelDefaultSettings(ctx, "calendar", {
      engine: "ai-sdk:openai",
      model: "old-model",
    });
    await expect(
      as(ctx.userEmail, ctx.orgId, () =>
        runSet({ engine: "ai-sdk:openai", appId: "calendar" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      readAgentAppModelDefaultSettings(ctx, "calendar"),
    ).resolves.toMatchObject({ model: "old-model" });
  });

  it("returns localized success copy for the caller's preference", async () => {
    const { putUserSetting } = await import("../../settings/user-settings.js");
    await putUserSetting("solo@example.test", "localization", {
      locale: "es-ES",
    });
    const result = JSON.parse(
      await as("solo@example.test", undefined, () =>
        runSet({ engine: "ai-sdk:openai" }),
      ),
    );
    expect(result.message).toContain(
      "Modelo predeterminado personal establecido",
    );
    expect(result.message).toContain("gpt-5.5");
  });

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

  it("rejects ChatGPT plan access as an organization default", async () => {
    const result = await as("admin@a.test", "org-a", () =>
      runSet({ engine: "chatgpt-subscription", model: "personal-model" }),
    );

    expect(result).toBe(
      "Error: ChatGPT plan access is personal and cannot be selected as an organization default.",
    );
    await expect(
      readDefaultAgentEngineSettingDetailed({
        userEmail: "admin@a.test",
        orgId: "org-a",
      }),
    ).resolves.toEqual({ source: "none", value: null });
    expect(isStoredEngineUsableForRequest).not.toHaveBeenCalled();
  });

  it("lets a user without an organization select their ChatGPT personal default", async () => {
    const result = JSON.parse(
      await as("solo@example.test", undefined, () =>
        runSet({
          engine: "chatgpt-subscription",
          model: "personal-model",
        }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      engine: "chatgpt-subscription",
      model: "personal-model",
    });
    await expect(
      readDefaultAgentEngineSettingDetailed({
        userEmail: "solo@example.test",
      }),
    ).resolves.toMatchObject({
      source: "user",
      value: { engine: "chatgpt-subscription", model: "personal-model" },
    });
  });

  it("rejects ChatGPT plan access as an organization app default before loading its catalog", async () => {
    const result = await as("admin@a.test", "org-a", () =>
      runManage({
        action: "set-app-default",
        appId: "mail",
        engine: "chatgpt-subscription",
        model: "personal-model",
      }),
    );

    expect(result).toBe(
      "Error: ChatGPT plan access is personal and cannot be selected as an organization default.",
    );
    expect(listChatGPTSubscriptionModels).not.toHaveBeenCalled();
    await expect(
      readAgentAppModelDefaultSettings(
        { userEmail: "admin@a.test", orgId: "org-a" },
        "mail",
      ),
    ).resolves.toMatchObject({ engine: null, model: null, source: "default" });
  });

  it("lets a user without an organization set their ChatGPT app default", async () => {
    const result = JSON.parse(
      await as("solo@example.test", undefined, () =>
        runManage({
          action: "set-app-default",
          appId: "mail",
          engine: "chatgpt-subscription",
          model: "personal-model",
        }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      engine: "chatgpt-subscription",
      model: "personal-model",
      source: "user",
    });
    expect(listChatGPTSubscriptionModels).toHaveBeenCalledWith(
      "solo@example.test",
    );
    await expect(
      readAgentAppModelDefaultSettings(
        { userEmail: "solo@example.test" },
        "mail",
      ),
    ).resolves.toMatchObject({
      engine: "chatgpt-subscription",
      model: "personal-model",
      source: "user",
    });
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
