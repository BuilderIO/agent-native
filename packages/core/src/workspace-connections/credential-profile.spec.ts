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
import { resetAppConfigForTests } from "../app-config/index.js";
import { writeAppSecret } from "../secrets/storage.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  connectionCredentialMarkerState,
  connectionCredentialScopeId,
  readMarkedConnectionCredential,
  type MarkedConnectionCredentialConnection,
  type MarkedConnectionCredentialRefShape,
} from "./credential-profile.js";
import {
  resolveExplicitUserConnectionCredential,
  resolveWorkspaceConnectionCredentialForApp,
} from "./credentials.js";
import {
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  type WorkspaceConnectionCredentialRef,
} from "./store.js";

const policyState = vi.hoisted(() => ({
  restrict: false,
  forcePolicyKey: false,
  calls: [] as Array<{
    email: string;
    orgId: string | null | undefined;
    contextOrgId: string | undefined;
    contextEmail: string | undefined;
  }>,
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => sharedClient,
    isProductionServerlessFunctionRuntime:
      actual.isProductionServerlessFunctionRuntime,
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

vi.mock("../server/personal-provider-key-policy.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >();
  const { getRequestContext } = await import("../server/request-context.js");
  return {
    ...actual,
    isPersonalProviderPolicyKey: (key: string) =>
      policyState.forcePolicyKey || actual.isPersonalProviderPolicyKey(key),
    isPersonalProviderKeyUseRestricted: async (input: {
      email: string;
      orgId?: string | null;
    }) => {
      const context = getRequestContext();
      policyState.calls.push({
        email: input.email,
        orgId: input.orgId,
        contextOrgId: context?.orgId,
        contextEmail: context?.userEmail,
      });
      return policyState.restrict;
    },
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args?: unknown[] }): Promise<{
    rows: Record<string, unknown>[];
    rowsAffected: number;
  }>;
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};
let previousSecretsEncryptionKey: string | undefined;

const OWNER = { userEmail: "alice@example.com", orgId: "org-1" };
const OTHER = { userEmail: "bob@example.com", orgId: "org-1" };
const PROVIDER = "slack";
const KEY = "SLACK_BOT_TOKEN";

beforeAll(async () => {
  previousSecretsEncryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = "credential-profile-test-key";
  pglite = await createTestPglite();
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as Record<string, unknown>[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

beforeEach(async () => {
  policyState.restrict = false;
  policyState.forcePolicyKey = false;
  policyState.calls = [];
  resetAppConfigForTests();
  for (const table of [
    "workspace_connection_grants",
    "workspace_connections",
    "app_secrets",
    "settings",
    "org_members",
  ]) {
    try {
      await pglite.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // The owning test creates each table through its store initializer.
    }
  }
});

afterAll(async () => {
  if (previousSecretsEncryptionKey === undefined) {
    delete process.env.SECRETS_ENCRYPTION_KEY;
  } else {
    process.env.SECRETS_ENCRYPTION_KEY = previousSecretsEncryptionKey;
  }
  await pglite.close();
});

function namespaceFor(id: string, owner = OWNER): string {
  return connectionCredentialScopeId({
    id,
    ownerEmail: owner.userEmail,
    orgId: owner.orgId,
  });
}

async function seedMarkedConnection(input: {
  id: string;
  provider?: string;
  allowedApps?: string[];
  config?: Record<string, unknown>;
  key?: string;
  refScope?: "user" | "org" | "workspace";
  marker?: unknown;
  includeMarker?: boolean;
  namespaceValue?: string;
  ownerContext?: { userEmail: string; orgId: string | null };
}): Promise<void> {
  const provider = input.provider ?? PROVIDER;
  const key = input.key ?? KEY;
  const ownerContext = input.ownerContext ?? OWNER;
  const ref: Record<string, unknown> = {
    key,
    scope: input.refScope ?? "user",
  };
  if (input.includeMarker !== false) {
    ref.ref = input.marker === undefined ? "connection" : input.marker;
  }
  await runWithRequestContext(ownerContext, () =>
    upsertWorkspaceConnection({
      id: input.id,
      provider,
      label: `Connection ${input.id}`,
      allowedApps: input.allowedApps ?? ["brain"],
      config: input.config ?? { workspaceConnectionScope: "user" },
      credentialRefs: [ref as WorkspaceConnectionCredentialRef],
    }),
  );
  if (input.namespaceValue !== undefined) {
    await writeAppSecret({
      key,
      value: input.namespaceValue,
      scope: "user",
      scopeId: namespaceFor(input.id, ownerContext as typeof OWNER),
    });
  }
}

function resolveMarked(options: {
  appId?: string;
  provider?: string;
  key?: string;
  connectionId?: string;
  userEmail?: string;
  orgId?: string;
  credentialScope?: "org";
  recordUsage?: boolean;
}) {
  return resolveWorkspaceConnectionCredentialForApp({
    appId: options.appId ?? "brain",
    provider: options.provider ?? PROVIDER,
    key: options.key ?? KEY,
    connectionId: options.connectionId,
    userEmail: options.userEmail,
    orgId: options.orgId,
    credentialScope: options.credentialScope,
    recordUsage: options.recordUsage,
  });
}

describe("connectionCredentialScopeId", () => {
  it("derives a stable namespaced digest and normalizes the owner email", () => {
    const base = connectionCredentialScopeId({
      id: "conn-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(base).toBe(
      "connv1:88fb804af5983e94764a64eca9dd21707314ce664660ce3ae5166aaf8cb3eb3a",
    );
    expect(base).toMatch(/^connv1:[0-9a-f]{64}$/);
    expect(
      connectionCredentialScopeId({
        id: "conn-1",
        ownerEmail: "  Alice@Example.COM  ",
        orgId: "org-1",
      }),
    ).toBe(base);
  });

  it("changes when the id or org changes", () => {
    const base = connectionCredentialScopeId({
      id: "conn-1",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    expect(
      connectionCredentialScopeId({
        id: "conn-2",
        ownerEmail: "alice@example.com",
        orgId: "org-1",
      }),
    ).not.toBe(base);
    expect(
      connectionCredentialScopeId({
        id: "conn-1",
        ownerEmail: "alice@example.com",
        orgId: null,
      }),
    ).toBe(
      "connv1:dcbbea01fe2ef3a26800e7b8ae3ac8ffe4f2f8064ecef33e0f1fa32d77245590",
    );
  });
});

describe("connectionCredentialMarkerState", () => {
  it("treats an absent or undefined marker as the legacy path", () => {
    expect(connectionCredentialMarkerState({})).toBe("legacy");
    expect(connectionCredentialMarkerState({ ref: undefined })).toBe("legacy");
  });

  it("accepts only the connection marker", () => {
    expect(connectionCredentialMarkerState({ ref: "connection" })).toBe(
      "connection",
    );
  });

  it("rejects every other present marker as invalid", () => {
    for (const marker of ["legacy", "", "connv1", null, 0, false, {}]) {
      expect(connectionCredentialMarkerState({ ref: marker })).toBe("invalid");
    }
  });
});

describe("readMarkedConnectionCredential", () => {
  const connection = {
    id: "conn-direct",
    provider: PROVIDER,
    ownerEmail: OWNER.userEmail,
    orgId: OWNER.orgId,
    config: { workspaceConnectionScope: "user" },
    appAccess: { available: true },
  };
  const markedRef = { key: KEY, scope: "user" as const, ref: "connection" };

  it("closes malformed refs before reading a value", async () => {
    await seedMarkedConnection({
      id: "conn-direct",
      namespaceValue: "should-not-be-read",
    });
    for (const ref of [
      { key: KEY, scope: "user" as const, ref: "bogus" },
      { key: KEY, scope: "org" as const, ref: "connection" },
      {
        key: KEY,
        scope: "user" as const,
        provider: "github",
        ref: "connection",
      },
    ]) {
      const outcome = await readMarkedConnectionCredential({
        connection,
        provider: PROVIDER,
        ref,
        requestContext: { userEmail: OWNER.userEmail, orgId: OWNER.orgId },
      });
      expect(outcome.status).toBe("invalid_ref");
    }
  });

  it("requires native app access on the resolved row", async () => {
    const outcome = await readMarkedConnectionCredential({
      connection: {
        id: connection.id,
        provider: connection.provider,
        ownerEmail: connection.ownerEmail,
        orgId: connection.orgId,
        config: connection.config,
      },
      provider: PROVIDER,
      ref: markedRef,
      requestContext: { userEmail: OWNER.userEmail, orgId: OWNER.orgId },
    });
    expect(outcome.status).toBe("not_available");
  });

  it("denies a foreign actor, org, and non-personal connection scope", async () => {
    await seedMarkedConnection({
      id: "conn-direct",
      namespaceValue: "should-not-be-read",
    });
    const foreignActor = await readMarkedConnectionCredential({
      connection,
      provider: PROVIDER,
      ref: markedRef,
      requestContext: { userEmail: OTHER.userEmail, orgId: OWNER.orgId },
    });
    expect(foreignActor.status).toBe("not_available");

    const foreignOrg = await readMarkedConnectionCredential({
      connection,
      provider: PROVIDER,
      ref: markedRef,
      requestContext: { userEmail: OWNER.userEmail, orgId: "org-2" },
    });
    expect(foreignOrg.status).toBe("not_available");

    const orgOnly = await readMarkedConnectionCredential({
      connection,
      provider: PROVIDER,
      ref: markedRef,
      requestContext: {
        userEmail: OWNER.userEmail,
        orgId: OWNER.orgId,
        credentialScope: "org",
      },
    });
    expect(orgOnly.status).toBe("not_available");

    const noRequestContext = await readMarkedConnectionCredential({
      connection: { ...connection, config: {} },
      provider: PROVIDER,
      ref: markedRef,
      requestContext: { userEmail: OWNER.userEmail, orgId: OWNER.orgId },
    });
    expect(noRequestContext.status).toBe("not_available");
  });
});

describe("marked connection credential resolution", () => {
  it("keeps two same-provider connections' values distinct", async () => {
    await seedMarkedConnection({ id: "conn-a", namespaceValue: "value-a" });
    await seedMarkedConnection({ id: "conn-b", namespaceValue: "value-b" });

    const a = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-a" }),
    );
    const b = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-b" }),
    );

    expect(a).toMatchObject({
      available: true,
      status: "resolved",
      value: "value-a",
      provenance: {
        connectionId: "conn-a",
        secretScope: "user",
        backend: "secrets",
        credentialRef: { key: KEY, ref: "connection", source: "connection" },
      },
    });
    expect(b).toMatchObject({
      available: true,
      status: "resolved",
      value: "value-b",
      provenance: { connectionId: "conn-b" },
    });
    expect(a.value).not.toBe(b.value);
  });

  it("never falls back to a same-named generic user or global value", async () => {
    await seedMarkedConnection({ id: "conn-empty" });
    await writeAppSecret({
      key: KEY,
      value: "generic-user-value",
      scope: "user",
      scopeId: OWNER.userEmail,
    });
    await writeAppSecret({
      key: KEY,
      value: "org-value",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-empty" }),
    );

    expect(resolution).toMatchObject({
      available: false,
      status: "missing_secret",
    });
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("generic-user-value");
    expect(JSON.stringify(resolution)).not.toContain("org-value");

    await writeAppSecret({
      key: KEY,
      value: "namespace-value",
      scope: "user",
      scopeId: namespaceFor("conn-empty"),
    });
    const resolved = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-empty" }),
    );
    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "namespace-value",
    });
  });

  it("does not read a connection namespace from a foreign actor, org, or app", async () => {
    await seedMarkedConnection({ id: "conn-a", namespaceValue: "value-a" });

    const foreignActor = await runWithRequestContext(OTHER, () =>
      resolveMarked({ connectionId: "conn-a" }),
    );
    expect(foreignActor.available).toBe(false);
    expect(foreignActor.value).toBeUndefined();

    const foreignOrg = await runWithRequestContext(
      { userEmail: OWNER.userEmail, orgId: "org-2" },
      () => resolveMarked({ connectionId: "conn-a" }),
    );
    expect(foreignOrg.available).toBe(false);
    expect(foreignOrg.value).toBeUndefined();

    await seedMarkedConnection({
      id: "conn-other-app",
      allowedApps: ["other-app"],
      namespaceValue: "other-app-value",
    });
    const otherApp = await runWithRequestContext(OWNER, () =>
      resolveMarked({ appId: "brain", connectionId: "conn-other-app" }),
    );
    expect(otherApp.available).toBe(false);
    expect(otherApp.value).toBeUndefined();
  });

  it("refuses to impersonate an owner through caller identity overrides", async () => {
    await seedMarkedConnection({ id: "conn-a", namespaceValue: "value-a" });

    const overridden = await runWithRequestContext(OTHER, () =>
      resolveMarked({
        connectionId: "conn-a",
        userEmail: OWNER.userEmail,
        orgId: OWNER.orgId,
      }),
    );
    expect(overridden.available).toBe(false);
    expect(overridden.value).toBeUndefined();
  });

  it("needs a request context even when the ambient deploy identity matches", async () => {
    await seedMarkedConnection({ id: "conn-a", namespaceValue: "value-a" });
    const previousEmail = process.env.AGENT_USER_EMAIL;
    const previousOrg = process.env.AGENT_ORG_ID;
    process.env.AGENT_USER_EMAIL = OWNER.userEmail;
    process.env.AGENT_ORG_ID = OWNER.orgId;
    try {
      expect(getRequestContext()).toBeUndefined();
      const ambient = await resolveMarked({ connectionId: "conn-a" });
      expect(ambient).toMatchObject({
        available: false,
        status: "missing_context",
      });
      expect(ambient.value).toBeUndefined();
    } finally {
      if (previousEmail === undefined) delete process.env.AGENT_USER_EMAIL;
      else process.env.AGENT_USER_EMAIL = previousEmail;
      if (previousOrg === undefined) delete process.env.AGENT_ORG_ID;
      else process.env.AGENT_ORG_ID = previousOrg;
    }
  });

  it("closes a malformed marker instead of reading the legacy value", async () => {
    await seedMarkedConnection({
      id: "conn-bad-marker",
      marker: "bogus",
      namespaceValue: "namespace-value",
    });
    await writeAppSecret({
      key: KEY,
      value: "legacy-should-not-be-read",
      scope: "user",
      scopeId: OWNER.userEmail,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-bad-marker" }),
    );
    expect(resolution.available).toBe(false);
    expect(resolution.status).toBe("not_available");
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain(
      "legacy-should-not-be-read",
    );
  });

  it("closes the marker when paired with a non-user scope", async () => {
    await seedMarkedConnection({
      id: "conn-bad-scope",
      refScope: "org",
    });
    await writeAppSecret({
      key: KEY,
      value: "org-should-not-be-read",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-bad-scope" }),
    );
    expect(resolution.available).toBe(false);
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("org-should-not-be-read");
  });

  it("refuses a restricted personal provider key before reading the vault", async () => {
    await seedMarkedConnection({
      id: "conn-policy",
      key: "OPENAI_API_KEY",
      namespaceValue: "policy-value",
    });
    policyState.forcePolicyKey = true;
    policyState.restrict = true;

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ key: "OPENAI_API_KEY", connectionId: "conn-policy" }),
    );
    expect(resolution.available).toBe(false);
    expect(resolution.status).toBe("not_available");
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("policy-value");
  });

  it("reports a vault read failure as error without a value", async () => {
    await seedMarkedConnection({
      id: "conn-a",
      namespaceValue: "value-a",
    });
    const originalExecute = sharedClient.execute.bind(sharedClient);
    const execute = vi
      .spyOn(sharedClient, "execute")
      .mockImplementation(async (arg) => {
        const sql = typeof arg === "string" ? arg : arg.sql;
        if (/select[\s\S]*from app_secrets/i.test(sql))
          throw new Error("synthetic vault failure");
        return originalExecute(arg);
      });
    try {
      const resolution = await runWithRequestContext(OWNER, () =>
        resolveMarked({ connectionId: "conn-a" }),
      );
      expect(resolution).toMatchObject({
        available: false,
        status: "error",
      });
      expect(resolution.value).toBeUndefined();
    } finally {
      execute.mockRestore();
    }
  });

  it("resolves a marked ref through the explicit owner-bound grant path", async () => {
    await runWithRequestContext(OWNER, async () => {
      await upsertWorkspaceConnection({
        id: "conn-explicit",
        provider: PROVIDER,
        label: "Explicit",
        allowedApps: [],
        config: { workspaceConnectionScope: "user" },
      });
      await upsertWorkspaceConnectionGrant({
        connectionId: "conn-explicit",
        appId: "brain",
        provider: PROVIDER,
        credentialRefs: [
          { key: KEY, scope: "user", provider: PROVIDER, ref: "connection" },
        ],
      });
    });
    await writeAppSecret({
      key: KEY,
      value: "explicit-value",
      scope: "user",
      scopeId: namespaceFor("conn-explicit"),
    });

    const resolved = await runWithRequestContext(OWNER, () =>
      resolveExplicitUserConnectionCredential({
        appId: "brain",
        provider: PROVIDER,
        connectionId: "conn-explicit",
        key: KEY,
      }),
    );
    expect(resolved).toMatchObject({
      available: true,
      status: "resolved",
      value: "explicit-value",
      provenance: {
        connectionId: "conn-explicit",
        credentialRef: { ref: "connection", source: "grant" },
      },
    });

    const foreign = await runWithRequestContext(OTHER, () =>
      resolveExplicitUserConnectionCredential({
        appId: "brain",
        provider: PROVIDER,
        connectionId: "conn-explicit",
        key: KEY,
      }),
    );
    expect(foreign.available).toBe(false);
    expect(foreign.value).toBeUndefined();
  });

  it("prints provenance for connection summaries with the marker but no value", async () => {
    await seedMarkedConnection({ id: "conn-a", namespaceValue: "value-a" });
    const { listWorkspaceConnectionsForApp } = await import("./store.js");
    const connections = await runWithRequestContext(OWNER, () =>
      listWorkspaceConnectionsForApp({ appId: "brain", provider: PROVIDER }),
    );
    expect(connections[0].credentialRefs[0]).toMatchObject({
      key: KEY,
      scope: "user",
      ref: "connection",
    });
    expect(JSON.stringify(connections)).not.toContain("value-a");
  });
});

describe("legacy unmarked refs", () => {
  it("keeps the existing scope waterfall and returns the stored value", async () => {
    await runWithRequestContext(OWNER, () =>
      upsertWorkspaceConnection({
        id: "conn-legacy",
        provider: PROVIDER,
        label: "Legacy",
        allowedApps: ["brain"],
        credentialRefs: [{ key: KEY, scope: "org" }],
      }),
    );
    await writeAppSecret({
      key: KEY,
      value: "legacy-org-value",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-legacy" }),
    );
    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "legacy-org-value",
      provenance: {
        connectionId: "conn-legacy",
        secretScope: "org",
        backend: "secrets",
      },
    });
    expect(resolution.provenance?.credentialRef.ref).toBeUndefined();
  });
});

describe("F1 native personal-provider policy org resolution", () => {
  it("passes undefined, not null, so the native policy can resolve the active org", async () => {
    await seedMarkedConnection({
      id: "conn-policy-no-org",
      key: "OPENAI_API_KEY",
      namespaceValue: "policy-value",
      ownerContext: { userEmail: OWNER.userEmail, orgId: null },
    });
    policyState.forcePolicyKey = true;
    policyState.restrict = false;

    const resolution = await runWithRequestContext(
      { userEmail: OWNER.userEmail },
      () =>
        resolveMarked({
          key: "OPENAI_API_KEY",
          connectionId: "conn-policy-no-org",
        }),
    );

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "policy-value",
    });
    const call = policyState.calls.at(-1);
    expect(call?.orgId).toBeUndefined();
    expect(call?.contextOrgId).toBeUndefined();
  });

  it("runs the policy under the genuine captured context for an org connection", async () => {
    await seedMarkedConnection({
      id: "conn-policy-org",
      key: "OPENAI_API_KEY",
      namespaceValue: "policy-org-value",
    });
    policyState.forcePolicyKey = true;
    policyState.restrict = false;

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({
        key: "OPENAI_API_KEY",
        connectionId: "conn-policy-org",
      }),
    );

    expect(resolution).toMatchObject({
      available: true,
      value: "policy-org-value",
    });
    const call = policyState.calls.at(-1);
    expect(call?.orgId).toBe(OWNER.orgId);
    expect(call?.contextOrgId).toBe(OWNER.orgId);
    expect(call?.contextEmail).toBe(OWNER.userEmail);
  });

  it("does not silently treat an explicit empty request org as no org", async () => {
    await seedMarkedConnection({
      id: "conn-empty-request-org",
      namespaceValue: "should-not-be-read",
      ownerContext: { userEmail: OWNER.userEmail, orgId: null },
    });

    const resolution = await runWithRequestContext(
      { userEmail: OWNER.userEmail, orgId: "" },
      () => resolveMarked({ connectionId: "conn-empty-request-org" }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("should-not-be-read");
  });
});

describe("F2 explicit connection key has no legacy fallback", () => {
  it("does not answer from a legacy grant ref when a marked connection ref exists", async () => {
    await runWithRequestContext(OWNER, async () => {
      await upsertWorkspaceConnection({
        id: "conn-mixed-grant-legacy",
        provider: PROVIDER,
        label: "Mixed grant legacy",
        allowedApps: ["brain"],
        config: { workspaceConnectionScope: "user" },
        credentialRefs: [
          { key: KEY, scope: "user", provider: PROVIDER, ref: "connection" },
        ],
      });
      await upsertWorkspaceConnectionGrant({
        connectionId: "conn-mixed-grant-legacy",
        appId: "brain",
        provider: PROVIDER,
        credentialRefs: [{ key: KEY, scope: "org" }],
      });
    });
    await writeAppSecret({
      key: KEY,
      value: "org-legacy-grant-value",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-mixed-grant-legacy" }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("org-legacy-grant-value");
  });

  it("does not answer from a legacy connection ref when a marked grant ref exists", async () => {
    await runWithRequestContext(OWNER, async () => {
      await upsertWorkspaceConnection({
        id: "conn-mixed-connection-legacy",
        provider: PROVIDER,
        label: "Mixed connection legacy",
        allowedApps: ["brain"],
        config: { workspaceConnectionScope: "user" },
        credentialRefs: [{ key: KEY, scope: "org" }],
      });
      await upsertWorkspaceConnectionGrant({
        connectionId: "conn-mixed-connection-legacy",
        appId: "brain",
        provider: PROVIDER,
        credentialRefs: [
          { key: KEY, scope: "user", provider: PROVIDER, ref: "connection" },
        ],
      });
    });
    await writeAppSecret({
      key: KEY,
      value: "org-legacy-connection-value",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-mixed-connection-legacy" }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain(
      "org-legacy-connection-value",
    );
  });

  it("does not answer a denied policy ref from a legacy fallback", async () => {
    await runWithRequestContext(OWNER, () =>
      upsertWorkspaceConnection({
        id: "conn-mixed-policy",
        provider: PROVIDER,
        label: "Mixed policy",
        allowedApps: ["brain"],
        config: { workspaceConnectionScope: "user" },
        credentialRefs: [
          {
            key: "OPENAI_API_KEY",
            scope: "user",
            provider: PROVIDER,
            ref: "connection",
          },
          { key: "OPENAI_API_KEY", scope: "org" },
        ],
      }),
    );
    await writeAppSecret({
      key: "OPENAI_API_KEY",
      value: "org-policy-fallback",
      scope: "org",
      scopeId: OWNER.orgId,
    });
    policyState.forcePolicyKey = true;
    policyState.restrict = true;

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({
        key: "OPENAI_API_KEY",
        connectionId: "conn-mixed-policy",
      }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("org-policy-fallback");
  });

  it("does not answer an invalid marker from a legacy fallback", async () => {
    await runWithRequestContext(OWNER, () =>
      upsertWorkspaceConnection({
        id: "conn-mixed-invalid",
        provider: PROVIDER,
        label: "Mixed invalid",
        allowedApps: ["brain"],
        config: { workspaceConnectionScope: "user" },
        credentialRefs: [
          { key: KEY, scope: "user", ref: "bogus" },
          { key: KEY, scope: "org" },
        ],
      }),
    );
    await writeAppSecret({
      key: KEY,
      value: "org-invalid-fallback",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-mixed-invalid" }),
    );

    expect(resolution.available).toBe(false);
    expect(resolution.value).toBeUndefined();
    expect(JSON.stringify(resolution)).not.toContain("org-invalid-fallback");
  });

  it("keeps ordinary cross-connection selection when no connection is pinned", async () => {
    await runWithRequestContext(OWNER, () =>
      upsertWorkspaceConnection({
        id: "conn-plain-legacy",
        provider: PROVIDER,
        label: "Plain legacy",
        allowedApps: ["brain"],
        credentialRefs: [{ key: KEY, scope: "org" }],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runWithRequestContext(OWNER, () =>
      upsertWorkspaceConnection({
        id: "conn-marked-empty",
        provider: PROVIDER,
        label: "Marked empty",
        allowedApps: ["brain"],
        config: { workspaceConnectionScope: "user" },
        credentialRefs: [
          { key: KEY, scope: "user", provider: PROVIDER, ref: "connection" },
        ],
      }),
    );
    await writeAppSecret({
      key: KEY,
      value: "org-cross-connection",
      scope: "org",
      scopeId: OWNER.orgId,
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({}),
    );

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "org-cross-connection",
      provenance: { connectionId: "conn-plain-legacy" },
    });
  });
});

describe("F4 malformed runtime shapes close with a static reason", () => {
  const connection: MarkedConnectionCredentialConnection = {
    id: "conn-direct",
    provider: PROVIDER,
    ownerEmail: OWNER.userEmail,
    orgId: OWNER.orgId,
    config: { workspaceConnectionScope: "user" },
    appAccess: { available: true },
  };
  const requestContext = { userEmail: OWNER.userEmail, orgId: OWNER.orgId };

  it("rejects non-string marker fields without a raw TypeError", async () => {
    const refs: MarkedConnectionCredentialRefShape[] = [
      { key: KEY, ref: "connection", provider: 123 } as never,
      { key: KEY, ref: "connection", scope: 123 } as never,
      { key: 123, ref: "connection" } as never,
    ];
    for (const ref of refs) {
      const outcome = await readMarkedConnectionCredential({
        connection,
        provider: PROVIDER,
        ref,
        requestContext,
      });
      expect(outcome.status).toBe("invalid_ref");
      if (outcome.status === "invalid_ref") {
        expect(outcome.reason).not.toMatch(/trim|is not a function|TypeError/);
      }
    }
  });

  it("rejects a throwing accessor with a static reason", async () => {
    const ref = {
      key: KEY,
      ref: "connection",
      get provider(): string {
        throw new Error("GETTER_BOOM_SECRET");
      },
    };
    const outcome = await readMarkedConnectionCredential({
      connection,
      provider: PROVIDER,
      ref: ref as never,
      requestContext,
    });
    expect(outcome.status).toBe("invalid_ref");
    if (outcome.status === "invalid_ref") {
      expect(outcome.reason).not.toContain("GETTER_BOOM_SECRET");
    }
  });

  it("rejects a malformed connection row without a raw TypeError", async () => {
    const outcome = await readMarkedConnectionCredential({
      connection: { ...connection, ownerEmail: 123 } as never,
      provider: PROVIDER,
      ref: { key: KEY, ref: "connection" },
      requestContext,
    });
    expect(outcome.status).toBe("not_available");
  });
});

describe("F7 public ref projection", () => {
  const baseRef = {
    key: KEY,
    scope: "user" as const,
    provider: PROVIDER,
    label: undefined,
    source: "connection" as const,
  };

  it("does not project an invalid stored marker into app summaries", async () => {
    const { summarizeWorkspaceConnectionProviderForApp } =
      await import("./store.js");
    const summary = summarizeWorkspaceConnectionProviderForApp({
      providerId: PROVIDER,
      appId: "brain",
      includeConnections: "all",
      connections: [
        {
          id: "conn-bad-public-marker",
          provider: PROVIDER,
          label: "Bad marker",
          accountId: null,
          accountLabel: null,
          status: "connected",
          scopes: [],
          config: {},
          allowedApps: ["brain"],
          allowedUsers: [],
          credentialRefs: [
            { key: KEY, scope: "user", ref: "sk-misplaced-secret" },
          ],
          ownerEmail: OWNER.userEmail,
          orgId: OWNER.orgId,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: null,
        },
      ],
      grants: [],
    });

    expect(summary.connections[0].credentialRefs[0]).toMatchObject({
      key: KEY,
      scope: "user",
      source: "connection",
    });
    expect(summary.connections[0].credentialRefs[0].ref).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain("sk-misplaced-secret");
  });

  it("projects only the literal connection marker", async () => {
    const { summarizeWorkspaceConnectionProviderForApp } =
      await import("./store.js");
    const summary = summarizeWorkspaceConnectionProviderForApp({
      providerId: PROVIDER,
      appId: "brain",
      includeConnections: "all",
      connections: [
        {
          id: "conn-good-public-marker",
          provider: PROVIDER,
          label: "Good marker",
          accountId: null,
          accountLabel: null,
          status: "connected",
          scopes: [],
          config: {},
          allowedApps: ["brain"],
          allowedUsers: [],
          credentialRefs: [
            { key: KEY, scope: "user", provider: PROVIDER, ref: "connection" },
          ],
          ownerEmail: OWNER.userEmail,
          orgId: OWNER.orgId,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastCheckedAt: null,
          lastError: null,
        },
      ],
      grants: [],
    });

    expect(summary.connections[0].credentialRefs[0]).toMatchObject({
      ...baseRef,
      ref: "connection",
    });
  });

  it("does not leak an invalid marker through resolution messages", async () => {
    await seedMarkedConnection({
      id: "conn-bad-resolution-marker",
      marker: "sk-misplaced-secret",
    });

    const resolution = await runWithRequestContext(OWNER, () =>
      resolveMarked({ connectionId: "conn-bad-resolution-marker" }),
    );

    expect(resolution.available).toBe(false);
    expect(JSON.stringify(resolution)).not.toContain("sk-misplaced-secret");
  });
});

describe("unbound background resolution", () => {
  it("keeps eligible legacy connections available when a marked candidate needs strict context", async () => {
    await runWithRequestContext(OWNER, () =>
      upsertWorkspaceConnection({
        id: "conn-background-legacy",
        provider: PROVIDER,
        label: "Background legacy",
        allowedApps: ["brain"],
        credentialRefs: [{ key: KEY, scope: "org" }],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    await seedMarkedConnection({
      id: "conn-background-marked",
      namespaceValue: "marked-only-value",
    });
    await writeAppSecret({
      key: KEY,
      value: "background-legacy-value",
      scope: "org",
      scopeId: OWNER.orgId,
    });
    expect(getRequestContext()).toBeUndefined();
    const resolution = await resolveMarked({
      userEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
      recordUsage: false,
    });
    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "background-legacy-value",
      provenance: { connectionId: "conn-background-legacy" },
    });
    expect(resolution.checked).toContainEqual(
      expect.objectContaining({
        connectionId: "conn-background-marked",
        status: "not_available",
      }),
    );
    expect(JSON.stringify(resolution)).not.toContain("marked-only-value");
  });

  it("still closes a pinned marked connection and an exhausted unbound lookup without strict context", async () => {
    await seedMarkedConnection({
      id: "conn-background-only",
      namespaceValue: "marked-only-value",
    });
    for (const options of [{}, { connectionId: "conn-background-only" }]) {
      const resolution = await resolveMarked({
        ...options,
        userEmail: OWNER.userEmail,
        orgId: OWNER.orgId,
        recordUsage: false,
      });
      expect(resolution).toMatchObject({
        available: false,
        status: "missing_context",
      });
      expect(resolution.value).toBeUndefined();
      expect(JSON.stringify(resolution)).not.toContain("marked-only-value");
    }
  });
});
