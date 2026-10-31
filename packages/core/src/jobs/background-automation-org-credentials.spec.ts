import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { getEngineCredentialOwner } from "../agent/engine/credential-owner.js";
import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import type { AutomationExecutionIdentity } from "../automations/service.js";

const pglite = await createTestPglite();

const store = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  settings: new Map<string, Record<string, unknown>>(),
  orgIdsSeenByReads: [] as Array<string | undefined>,
  orgMembersFailure: undefined as Error | undefined,
}));

afterAll(async () => {
  await pglite.close();
});

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    if (store.orgMembersFailure && /org_members/.test(input.sql)) {
      throw store.orgMembersFailure;
    }
    const result = await pglite.query(input.sql, input.args ?? []);
    return { rows: result.rows as unknown[], rowsAffected: 0 };
  }),
};

vi.mock(import("../db/client.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  getDbExec: () => rawClient,
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => store.settings.get(key) ?? null,
  getSettings: async (keys: readonly string[]) =>
    new Map(keys.map((key) => [key, store.settings.get(key) ?? null])),
}));

vi.mock("../secrets/storage.js", async (importOriginal) => {
  const { getRequestOrgId } = await import("../server/request-context.js");
  const read = async (ref: { key: string; scope: string; scopeId: string }) => {
    store.orgIdsSeenByReads.push(getRequestOrgId());
    const value = store.secrets.get(`${ref.scope}:${ref.scopeId}:${ref.key}`);
    return value ? { value, last4: value.slice(-4), updatedAt: 1 } : null;
  };
  return {
    ...(await importOriginal<typeof import("../secrets/storage.js")>()),
    readAppSecret: read,
    readAppSecrets: async (args: {
      keys: readonly string[];
      scope: string;
      scopeId: string;
    }) => {
      const found = new Map<string, unknown>();
      for (const key of args.keys) {
        const secret = await read({ key, ...args });
        if (secret) found.set(key, secret);
      }
      return found;
    },
  };
});

vi.mock("../extensions/url-safety.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extensions/url-safety.js")>()),
  isBlockedExtensionUrlWithDns: async () => false,
}));

const {
  checkBackgroundAutomationCredentials,
  resolveBackgroundAutomationIdentity,
} = await import("./background-automation-runner.js");
const { automationRunScopeContext } = await import("../automations/service.js");
const { resolveEngine } = await import("../agent/engine/index.js");
const { resolveSecretDetailed } =
  await import("../server/credential-provider.js");
const { getRequestContext, getRequestOrgId, runWithRequestContext } =
  await import("../server/request-context.js");

const ORG = "org-a";
const OTHER_ORG = "org-b";
const MEMBER = "member@example.com";
const ADMIN = "admin@example.com";
const OUTSIDER = "outsider@example.com";
const ORG_URL = "https://org-llm.example.test/v1";
const USER_URL = "https://member-llm.example.test/v1";

const policyKey = (orgId: string) =>
  `o:${orgId}:restrict-personal-provider-keys`;
const activeOrgKey = (email: string) => `u:${email}:active-org-id`;

function secret(scope: string, scopeId: string, key: string, value: string) {
  store.secrets.set(`${scope}:${scopeId}:${key}`, value);
}

async function addMember(
  orgId: string,
  email: string,
  role: "owner" | "admin" | "member",
  joinedAt = 1,
) {
  await pglite.query(
    `INSERT INTO org_members (org_id, email, role, joined_at) VALUES (?, ?, ?, ?)`,
    [orgId, email, role, joinedAt],
  );
}

function defaultEngine(email: string, engine: string) {
  store.settings.set(`u:${email}:agent-engine`, { engine });
}

function personalAutomation(owner: string) {
  return {
    name: "daily-digest",
    body: "Summarize my day.",
    resource: { id: "automation-1", owner, path: "jobs/daily-digest.md" },
    meta: {
      schedule: "",
      enabled: true,
      triggerType: "event",
      createdBy: owner,
    },
  } as any;
}

const deps = { getActions: () => ({}), getSystemPrompt: async () => "system" };

async function credentialCheckFor(owner: string) {
  const resolved = await resolveBackgroundAutomationIdentity(
    personalAutomation(owner),
  );
  if (!resolved.ok) return { resolved } as const;
  return {
    resolved,
    check: await checkBackgroundAutomationCredentials(resolved.identity, deps),
  } as const;
}

function inRun<T>(
  identity: AutomationExecutionIdentity,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestContext(
    { userEmail: identity.userEmail, ...automationRunScopeContext(identity) },
    fn,
  );
}

async function keyUsedByRun(owner: string, runDeps: typeof deps = deps) {
  const resolved = await resolveBackgroundAutomationIdentity(
    personalAutomation(owner),
  );
  if (!resolved.ok) throw new Error(resolved.reason);
  const check = await checkBackgroundAutomationCredentials(
    resolved.identity,
    runDeps,
  );
  if (!check.ok) throw new Error(check.failure.message);
  return {
    apiKey: (check.engine as any).apiKey as string | undefined,
    owner: getEngineCredentialOwner(check.engine),
  };
}

beforeAll(async () => {
  await pglite.exec(`CREATE TABLE "user" (id TEXT, email TEXT)`);
  await pglite.exec(`CREATE TABLE org_members (
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at BIGINT NOT NULL DEFAULT 0,
    federation_removal_pending_at BIGINT
  )`);
  for (const email of [MEMBER, ADMIN, OUTSIDER]) {
    await pglite.query(`INSERT INTO "user" (id, email) VALUES (?, ?)`, [
      email,
      email,
    ]);
  }
});

beforeEach(async () => {
  store.secrets.clear();
  store.settings.clear();
  store.orgIdsSeenByReads.length = 0;
  store.orgMembersFailure = undefined;
  await pglite.exec(`DELETE FROM org_members`);
  vi.unstubAllEnvs();
  for (const name of [
    ...PROVIDER_ENV_VARS,
    "OPENAI_BASE_URL",
    "BUILDER_PRIVATE_KEY",
    "BUILDER_PUBLIC_KEY",
    "BUILDER_GATEWAY_TOKEN",
    "BUILDER_GATEWAY_SPACE_ID",
  ]) {
    vi.stubEnv(name, undefined);
  }
  await addMember(ORG, MEMBER, "member");
  await addMember(ORG, ADMIN, "admin");
  store.settings.set(activeOrgKey(MEMBER), { orgId: ORG });
  store.settings.set(activeOrgKey(ADMIN), { orgId: ORG });
});

describe("a personal automation whose provider key is saved at organization scope", () => {
  it("runs on the organization's key when its creator has none", async () => {
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    const { resolved, check } = await credentialCheckFor(MEMBER);

    expect(resolved).toMatchObject({ ok: true });
    expect(check).toMatchObject({ ok: true });
    expect(await keyUsedByRun(MEMBER)).toMatchObject({
      apiKey: "sk-ant-org",
      owner: "customer",
    });
  });

  it("runs on the organization's OpenAI key when that is the creator's default engine", async () => {
    defaultEngine(MEMBER, "ai-sdk:openai");
    secret("org", ORG, "OPENAI_API_KEY", "sk-openai-org");

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({ ok: true });
    expect((check as any).engine.name).toBe("ai-sdk:openai");
  });

  it("stays a personal run: no read sees an organization and ChatGPT is still refused", async () => {
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    const { resolved } = await credentialCheckFor(MEMBER);
    if (!resolved.ok) throw new Error(resolved.reason);
    store.orgIdsSeenByReads.length = 0;
    await keyUsedByRun(MEMBER);

    expect(store.orgIdsSeenByReads.length).toBeGreaterThan(0);
    expect(store.orgIdsSeenByReads.every((orgId) => orgId === undefined)).toBe(
      true,
    );
    expect(
      await inRun(resolved.identity, async () => getRequestOrgId()),
    ).toBeUndefined();
    await expect(
      inRun(resolved.identity, () =>
        resolveEngine({
          engineOption: "chatgpt-subscription",
          credentialIdentity: { userEmail: MEMBER },
        }),
      ),
    ).rejects.toThrow(/ChatGPT/);
  });

  it("ignores an organization key that is not in the creator's active organization", async () => {
    await addMember(OTHER_ORG, MEMBER, "member", 2);
    secret("org", OTHER_ORG, "ANTHROPIC_API_KEY", "sk-ant-other-org");

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({
      ok: false,
      failure: { code: "missing_credentials" },
    });
  });

  it("uses only personal keys when the creator chose no organization", async () => {
    store.settings.set(activeOrgKey(MEMBER), { orgId: null });
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    const { resolved, check } = await credentialCheckFor(MEMBER);

    expect(resolved).toMatchObject({ ok: true });
    expect(check).toMatchObject({
      ok: false,
      failure: { code: "missing_credentials" },
    });
  });

  it("pauses for credentials, not for a missing owner, once the creator left the organization", async () => {
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    const { resolved, check } = await credentialCheckFor(OUTSIDER);

    expect(resolved).toMatchObject({ ok: true });
    expect(check).toMatchObject({
      ok: false,
      failure: { code: "missing_credentials" },
    });
  });

  it("retries later when the membership read fails transiently", async () => {
    store.orgMembersFailure = Object.assign(new Error("statement timeout"), {
      code: "57014",
    });

    const { resolved } = await credentialCheckFor(MEMBER);

    expect(resolved).toMatchObject({ ok: false, code: "owner_unverifiable" });
  });

  it("keeps running on personal keys when the deployment has no organization tables", async () => {
    store.orgMembersFailure = Object.assign(
      new Error('relation "org_members" does not exist'),
      { code: "42P01" },
    );
    secret("user", MEMBER, "ANTHROPIC_API_KEY", "sk-ant-member");

    const { resolved, check } = await credentialCheckFor(MEMBER);

    expect(resolved).toMatchObject({ ok: true });
    expect(check).toMatchObject({ ok: true });
    expect(await keyUsedByRun(MEMBER)).toMatchObject({
      apiKey: "sk-ant-member",
    });
  });
});

describe("Restrict personal API keys in a personal automation", () => {
  beforeEach(() => {
    store.settings.set(policyKey(ORG), { restricted: true });
  });

  it("skips a restricted member's own key and uses the organization's", async () => {
    secret("user", MEMBER, "ANTHROPIC_API_KEY", "sk-ant-member");
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    expect(await keyUsedByRun(MEMBER)).toMatchObject({
      apiKey: "sk-ant-org",
    });
  });

  it("refuses a restricted member's own key when the organization has none", async () => {
    secret("user", MEMBER, "ANTHROPIC_API_KEY", "sk-ant-member");

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({
      ok: false,
      failure: { code: "missing_credentials" },
    });
  });

  it("keeps an admin's own key", async () => {
    secret("user", ADMIN, "ANTHROPIC_API_KEY", "sk-ant-admin");
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    expect(await keyUsedByRun(ADMIN)).toMatchObject({
      apiKey: "sk-ant-admin",
    });
  });

  it("leaves a restricted member's personal Builder connection as it is today", async () => {
    secret("user", MEMBER, "BUILDER_PRIVATE_KEY", "bpk-member");
    secret("user", MEMBER, "BUILDER_PUBLIC_KEY", "pub-member");
    store.settings.set(activeOrgKey(MEMBER), { orgId: ORG });

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({ ok: true });
    expect((check as any).engine.name).toBe("builder");
  });
});

describe("a personal automation that works today", () => {
  it.each([
    ["an admin's own key beats the organization's", ADMIN, "user", ADMIN],
    ["a member's own key beats the organization's", MEMBER, "user", MEMBER],
    [
      "a member's pre-organization solo key beats the organization's",
      MEMBER,
      "workspace",
      `solo:${MEMBER}`,
    ],
  ])("%s", async (_name, owner, scope, scopeId) => {
    secret(scope, scopeId, "ANTHROPIC_API_KEY", "sk-ant-personal");
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");

    expect(await keyUsedByRun(owner)).toMatchObject({
      apiKey: "sk-ant-personal",
    });
    expect((await credentialCheckFor(owner)).check).toMatchObject({ ok: true });
  });

  it("still runs on a member's own key when the organization has none", async () => {
    secret("user", MEMBER, "ANTHROPIC_API_KEY", "sk-ant-member");

    expect(await keyUsedByRun(MEMBER)).toMatchObject({
      apiKey: "sk-ant-member",
    });
  });

  it("does not send a member's own OpenAI key to the organization's endpoint", async () => {
    defaultEngine(MEMBER, "ai-sdk:openai");
    secret("user", MEMBER, "OPENAI_API_KEY", "sk-openai-member");
    secret("org", ORG, "OPENAI_BASE_URL", ORG_URL);

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({ ok: true });
    expect((check as any).engine.baseUrl).not.toBe(ORG_URL);
  });
});

describe("a personal automation on the organization's OpenAI key", () => {
  beforeEach(() => defaultEngine(MEMBER, "ai-sdk:openai"));

  it("sends it to the organization's endpoint", async () => {
    secret("org", ORG, "OPENAI_API_KEY", "sk-openai-org");
    secret("org", ORG, "OPENAI_BASE_URL", ORG_URL);

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({ ok: true });
    expect((check as any).engine.baseUrl).toBe(ORG_URL);
  });

  it("never sends it to an endpoint the member controls", async () => {
    secret("org", ORG, "OPENAI_API_KEY", "sk-openai-org");
    secret("user", MEMBER, "OPENAI_BASE_URL", USER_URL);

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({ ok: false });
  });
});

describe("the organization's key is the last resort of a personal automation", () => {
  beforeEach(() => {
    secret("org", ORG, "ANTHROPIC_API_KEY", "sk-ant-org");
  });

  it("keeps the deployment's own key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-deploy");

    expect(await keyUsedByRun(MEMBER)).toEqual({
      apiKey: "sk-ant-deploy",
      owner: "deployment",
    });
  });

  it("keeps the host's key", async () => {
    expect(
      await keyUsedByRun(MEMBER, { ...deps, apiKey: "sk-ant-host" }),
    ).toEqual({ apiKey: "sk-ant-host", owner: "deployment" });
  });

  it("keeps the designated vault's key", async () => {
    vi.stubEnv("AGENT_VAULT_ORG_ID", "org-vault");
    secret("org", "org-vault", "ANTHROPIC_API_KEY", "sk-ant-vault");

    expect(await keyUsedByRun(MEMBER)).toMatchObject({
      apiKey: "sk-ant-vault",
    });
  });

  it("sends the organization's OpenAI key to the organization's endpoint, not the deployment's", async () => {
    defaultEngine(MEMBER, "ai-sdk:openai");
    vi.stubEnv("OPENAI_BASE_URL", "https://deploy-gw.example.test/v1");
    secret("org", ORG, "OPENAI_API_KEY", "sk-openai-org");
    secret("org", ORG, "OPENAI_BASE_URL", ORG_URL);

    const { check } = await credentialCheckFor(MEMBER);

    expect(check).toMatchObject({ ok: true });
    expect((check as any).engine.baseUrl).toBe(ORG_URL);
  });

  it("answers for the user the organization was resolved for, not for another in the same context", async () => {
    const resolved = await resolveBackgroundAutomationIdentity(
      personalAutomation(MEMBER),
    );
    if (!resolved.ok) throw new Error(resolved.reason);

    const [forMember, forOther] = await inRun(resolved.identity, () =>
      Promise.all(
        [MEMBER, ADMIN].map((userEmail) =>
          runWithRequestContext({ ...getRequestContext(), userEmail }, () =>
            resolveSecretDetailed("ANTHROPIC_API_KEY"),
          ),
        ),
      ),
    );

    expect(forMember).toMatchObject({ value: "sk-ant-org" });
    expect(forOther).toMatchObject({ value: null });
  });
});
