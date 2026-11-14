import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { ActionContractError, NoWriteError } from "../action.js";
import * as credentialCatalog from "../connections/catalog.js";
import type { DbExec } from "../db/client.js";
import {
  __resetSecretsRegistry,
  registerRequiredSecret,
} from "../secrets/register.js";
import {
  ensureTable as ensureAppSecretsTable,
  readAppSecret,
  writeAppSecret,
} from "../secrets/storage.js";
import { writePersonalProviderKeyPolicy } from "../server/personal-provider-key-policy.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import { connectionCredentialScopeId } from "./credential-profile.js";
import { resolveWorkspaceConnectionCredentialForApp } from "./credentials.js";
import { registerWorkspaceConnectionLifecycleListener } from "./lifecycle.js";
import {
  PersonalWorkspaceCredentialError,
  createPersonalWorkspaceCredentialService,
} from "./personal-credentials.js";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  getWorkspaceConnectionGrant,
} from "./store.js";

vi.setConfig({ testTimeout: 120_000 });

type FrameworkClient = DbExec;

let currentExec: FrameworkClient | undefined;

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => actual.getScopedDbExec() ?? currentExec!,
  };
});

type TestPglite = Awaited<ReturnType<typeof createTestPglite>>;

let pglite: TestPglite;
let commitThenThrow = false;
let postCommitHook: (() => Promise<void>) | null = null;
let failBeforeTransaction = false;
let transactionDepth = 0;
let inTransaction = false;
let hideExistingUntilLock = false;
let afterLockHook: ((tx: DbExec) => Promise<void>) | null = null;
let armPostCommitRefusal = false;
let postCommitFailure: unknown;
let trackingReadbacks = false;
let readbackReads = 0;

const APP_ID = "app-personal-credentials";
const ALICE = "alice@example.test";
const BOB = "bob@example.test";
const ORG_ID = "org-personal-credentials";

function sqlOf(input: unknown): string {
  if (typeof input === "string") return input;
  const candidate = input as { sql?: unknown } | null;
  return typeof candidate?.sql === "string" ? candidate.sql : "";
}

function isConnectionRead(sql: string): boolean {
  return /FROM public\.workspace_connections WHERE id = \?/.test(sql);
}

function isGrantRead(sql: string): boolean {
  return /FROM public\.workspace_connection_grants WHERE connection_id = \?/.test(
    sql,
  );
}

function isInspectRead(sql: string): boolean {
  return (
    isConnectionRead(sql) ||
    isGrantRead(sql) ||
    /FROM app_secrets WHERE scope = \?/.test(sql)
  );
}

async function createExec(db: TestPglite): Promise<FrameworkClient> {
  const resultOf = (result: {
    rows: unknown[];
    affectedRows?: number | null;
    rowCount?: number | null;
  }) => ({
    rows: result.rows as any[],
    rowsAffected: Number(
      result.affectedRows ?? result.rowCount ?? result.rows.length,
    ),
  });

  return {
    async execute(input) {
      const sql = sqlOf(input);
      if (
        hideExistingUntilLock &&
        !inTransaction &&
        (isConnectionRead(sql) || isGrantRead(sql))
      ) {
        return { rows: [], rowsAffected: 0 };
      }
      if (typeof input === "string") {
        await db.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await db.query(input.sql, input.args ?? []);
      if (trackingReadbacks && !inTransaction && isInspectRead(sql)) {
        readbackReads++;
      }
      return resultOf(result as any);
    },
    async transaction<T>(fn: (tx: DbExec) => Promise<T>): Promise<T> {
      if (failBeforeTransaction) {
        failBeforeTransaction = false;
        throw new Error("transaction did not start");
      }
      transactionDepth++;
      inTransaction = true;
      try {
        let wrotePersonalConnection = false;
        const result = await db.transaction(async (tx) => {
          const wrapped: DbExec = {
            async execute(input) {
              const sql = sqlOf(input);
              const result = await tx.execute(input);
              if (
                result.rowsAffected > 0 &&
                /^\s*(INSERT INTO|UPDATE)\s+public\.workspace_connections\b/i.test(
                  sql,
                )
              )
                wrotePersonalConnection = true;
              if (afterLockHook && sql.includes("pg_advisory_xact_lock")) {
                const hook = afterLockHook;
                afterLockHook = null;
                await hook(tx);
              }
              if (trackingReadbacks && isInspectRead(sql)) readbackReads++;
              return result;
            },
          };
          return fn(wrapped);
        });
        if (postCommitHook && wrotePersonalConnection) {
          const hook = postCommitHook;
          postCommitHook = null;
          await hook();
        }
        if (commitThenThrow) {
          commitThenThrow = false;
          throw new Error("commit acknowledgement lost");
        }
        if (armPostCommitRefusal) {
          armPostCommitRefusal = false;
          const failure = postCommitFailure;
          postCommitFailure = undefined;
          trackingReadbacks = true;
          throw failure;
        }
        return result;
      } finally {
        inTransaction = false;
        transactionDepth--;
      }
    },
  };
}

function armRefusalAfterCommit(error: unknown): void {
  armPostCommitRefusal = true;
  postCommitFailure = error;
  trackingReadbacks = false;
  readbackReads = 0;
}

function runAs<T>(
  actor: {
    email?: string;
    orgId?: string;
    credentialScope?: "org";
  },
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestContext(
    {
      ...(actor.email ? { userEmail: actor.email } : {}),
      ...(actor.orgId !== undefined ? { orgId: actor.orgId } : {}),
      ...(actor.credentialScope
        ? { credentialScope: actor.credentialScope }
        : {}),
    },
    fn,
  );
}

function service() {
  return createPersonalWorkspaceCredentialService({ appId: APP_ID });
}

function slackInput(operationId: string, secret = "canary-slack-value") {
  return {
    operationId,
    provider: "slack",
    name: "Alice Slack",
    secretValues: [{ key: "SLACK_BOT_TOKEN", secret }],
  };
}

async function seedOrgMember(
  orgId: string,
  email: string,
  role: "owner" | "admin" | "member",
) {
  await pglite.exec(
    `CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT,
      email TEXT,
      role TEXT,
      joined_at BIGINT,
      federation_removal_pending_at TIMESTAMPTZ
    )`,
  );
  await pglite.query(
    `INSERT INTO org_members (org_id, email, role, joined_at, federation_removal_pending_at)
     VALUES (?, ?, ?, 0, NULL)`,
    [orgId, email, role],
  );
}

async function tableCount(table: string): Promise<number> {
  const { rows } = await pglite.query(
    `SELECT to_regclass('public.${table}') IS NOT NULL AS present`,
  );
  if (!rows[0]?.present) return 0;
  const result = await pglite.query(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(result.rows[0]?.n ?? 0);
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

function expectServiceError(
  error: unknown,
  code: PersonalWorkspaceCredentialError["code"],
): PersonalWorkspaceCredentialError {
  expect(error).toBeInstanceOf(PersonalWorkspaceCredentialError);
  const typed = error as PersonalWorkspaceCredentialError;
  expect(typed.code).toBe(code);
  return typed;
}

beforeEach(async () => {
  process.env.SECRETS_ENCRYPTION_KEY = "personal-credentials-test-key";
  __resetSecretsRegistry();
  commitThenThrow = false;
  postCommitHook = null;
  failBeforeTransaction = false;
  transactionDepth = 0;
  inTransaction = false;
  hideExistingUntilLock = false;
  afterLockHook = null;
  armPostCommitRefusal = false;
  postCommitFailure = undefined;
  trackingReadbacks = false;
  readbackReads = 0;
  pglite = await createTestPglite();
  currentExec = await createExec(pglite);
}, 30_000);

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.AGENT_USER_EMAIL;
  __resetSecretsRegistry();
  currentExec = undefined;
  await pglite.close();
}, 30_000);

describe("personal workspace credential service", () => {
  it("creates one owned personal connection, grant, and namespaced secret", async () => {
    const result = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-basic")),
    );
    expect(Object.keys(result)).toEqual(["connectionId"]);

    await runAs({ email: ALICE }, async () => {
      const connection = await getWorkspaceConnection(result.connectionId);
      expect(connection).toMatchObject({
        id: result.connectionId,
        provider: "slack",
        label: "Alice Slack",
        status: "connected",
        ownerEmail: ALICE,
        orgId: null,
        allowedApps: [APP_ID],
        allowedUsers: [ALICE],
      });
      expect(connection?.config.workspaceConnectionScope).toBe("user");
      expect(connection?.credentialRefs).toEqual([
        {
          key: "SLACK_BOT_TOKEN",
          scope: "user",
          provider: "slack",
          ref: "connection",
        },
      ]);

      const grant = await getWorkspaceConnectionGrant(
        result.connectionId,
        APP_ID,
      );
      expect(grant).toMatchObject({
        connectionId: result.connectionId,
        appId: APP_ID,
        provider: "slack",
        grantedByEmail: ALICE,
        ownerEmail: ALICE,
        orgId: null,
      });
      expect(grant?.credentialRefs).toEqual(connection?.credentialRefs);
    });

    const namespace = connectionCredentialScopeId({
      id: result.connectionId,
      ownerEmail: ALICE,
      orgId: null,
    });
    const secret = await readAppSecret({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      scopeId: namespace,
    });
    expect(secret?.value).toBe("canary-slack-value");

    // The generic user scope (keyed by the email) never receives this value.
    const generic = await readAppSecret({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      scopeId: ALICE,
    });
    expect(generic).toBeNull();
  });

  it("keeps unbounded independent profiles for the same provider and key", async () => {
    const created: Array<{ connectionId: string; value: string }> = [];
    for (let index = 0; index < 4; index++) {
      const value = `canary-profile-${index}`;
      const result = await runAs({ email: ALICE }, () =>
        service().create(slackInput(`op-profile-${index}`, value)),
      );
      created.push({ connectionId: result.connectionId, value });
    }

    expect(new Set(created.map((entry) => entry.connectionId)).size).toBe(4);
    expect(await tableCount("workspace_connections")).toBe(4);
    expect(await tableCount("workspace_connection_grants")).toBe(4);
    expect(await tableCount("app_secrets")).toBe(4);

    for (const entry of created) {
      const namespace = connectionCredentialScopeId({
        id: entry.connectionId,
        ownerEmail: ALICE,
        orgId: null,
      });
      const secret = await readAppSecret({
        key: "SLACK_BOT_TOKEN",
        scope: "user",
        scopeId: namespace,
      });
      expect(secret?.value).toBe(entry.value);
    }
  });

  it("resolves each created profile only from its own marked namespace", async () => {
    const first = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-resolve-a", "canary-resolve-a")),
    );
    const second = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-resolve-b", "canary-resolve-b")),
    );

    // A same-named value in the generic native user scope must never answer a
    // marked connection ref read.
    await writeAppSecret({
      key: "SLACK_BOT_TOKEN",
      value: "canary-global-value",
      scope: "user",
      scopeId: ALICE,
    });

    const resolve = (connectionId: string) =>
      runAs({ email: ALICE }, () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: APP_ID,
          provider: "slack",
          key: "SLACK_BOT_TOKEN",
          connectionId,
          recordUsage: false,
        }),
      );

    const resolvedFirst = await resolve(first.connectionId);
    const resolvedSecond = await resolve(second.connectionId);
    expect(resolvedFirst.available).toBe(true);
    expect(resolvedFirst.value).toBe("canary-resolve-a");
    expect(resolvedSecond.available).toBe(true);
    expect(resolvedSecond.value).toBe("canary-resolve-b");
    expect(resolvedFirst.provenance?.credentialRef).toMatchObject({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      provider: "slack",
      ref: "connection",
    });
  });

  it("replays the same operation without overwriting rows", async () => {
    const first = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-replay")),
    );
    const namespace = connectionCredentialScopeId({
      id: first.connectionId,
      ownerEmail: ALICE,
      orgId: null,
    });
    const beforeConnection = await runAs({ email: ALICE }, () =>
      getWorkspaceConnection(first.connectionId),
    );
    const beforeSecret = await readAppSecret({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      scopeId: namespace,
    });

    const replay = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-replay")),
    );
    expect(replay.connectionId).toBe(first.connectionId);

    const afterConnection = await runAs({ email: ALICE }, () =>
      getWorkspaceConnection(first.connectionId),
    );
    const afterSecret = await readAppSecret({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      scopeId: namespace,
    });
    expect(afterConnection?.updatedAt).toBe(beforeConnection?.updatedAt);
    expect(afterSecret?.updatedAt).toBe(beforeSecret?.updatedAt);
    expect(await tableCount("workspace_connections")).toBe(1);
    expect(await tableCount("workspace_connection_grants")).toBe(1);
    expect(await tableCount("app_secrets")).toBe(1);
  });

  it("conflicts on changed values or name without writing", async () => {
    const first = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-conflict", "canary-original")),
    );
    const namespace = connectionCredentialScopeId({
      id: first.connectionId,
      ownerEmail: ALICE,
      orgId: null,
    });
    const before = await readAppSecret({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      scopeId: namespace,
    });

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-conflict", "canary-changed")),
        ),
      ),
      "conflict",
    );
    const changedName = slackInput("op-conflict", "canary-original");
    changedName.name = "Changed name";
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () => service().create(changedName)),
      ),
      "conflict",
    );

    const after = await readAppSecret({
      key: "SLACK_BOT_TOKEN",
      scope: "user",
      scopeId: namespace,
    });
    expect(after?.value).toBe("canary-original");
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(await tableCount("workspace_connections")).toBe(1);
    expect(await tableCount("workspace_connection_grants")).toBe(1);
    expect(await tableCount("app_secrets")).toBe(1);
  });

  it("conflicts on changed provider-declared config without writing", async () => {
    const input = {
      operationId: "op-config",
      provider: "dbt",
      config: {
        semanticLayerBaseUrl: "https://canary.example.test/graphql",
        semanticLayerEnvironmentId: "canary-env",
      },
      secretValues: [{ key: "DBT_SEMANTIC_LAYER_TOKEN", secret: "canary-dbt" }],
    };
    const first = await runAs({ email: ALICE }, () => service().create(input));
    const replay = await runAs({ email: ALICE }, () => service().create(input));
    expect(replay.connectionId).toBe(first.connectionId);

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            ...input,
            config: {
              ...input.config,
              semanticLayerBaseUrl: "https://changed.example.test/graphql",
            },
          }),
        ),
      ),
      "conflict",
    );

    const connection = await runAs({ email: ALICE }, () =>
      getWorkspaceConnection(first.connectionId),
    );
    expect(connection?.config.semanticLayerBaseUrl).toBe(
      "https://canary.example.test/graphql",
    );
  });

  it("never overwrites a same-id row owned outside the request scope", async () => {
    const first = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-foreign")),
    );
    await pglite.query(
      `UPDATE workspace_connections SET owner_email = ? WHERE id = ?`,
      ["mallory@example.test", first.connectionId],
    );
    await pglite.query(
      `UPDATE workspace_connection_grants SET owner_email = ?, granted_by_email = ? WHERE connection_id = ?`,
      ["mallory@example.test", "mallory@example.test", first.connectionId],
    );

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-foreign")),
        ),
      ),
      "conflict",
    );

    const rows = await pglite.query(
      `SELECT owner_email FROM workspace_connections WHERE id = ?`,
      [first.connectionId],
    );
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as any).owner_email).toBe("mallory@example.test");
    expect(await tableCount("workspace_connections")).toBe(1);
    expect(await tableCount("workspace_connection_grants")).toBe(1);
  });

  it("rejects missing, malformed, and ambient-only request context", async () => {
    expectServiceError(
      await caught(service().create(slackInput("op-no-context"))),
      "unauthenticated",
    );

    process.env.AGENT_USER_EMAIL = "ambient@example.test";
    expectServiceError(
      await caught(service().create(slackInput("op-ambient"))),
      "unauthenticated",
    );

    expectServiceError(
      await caught(
        runAs({}, () => service().create(slackInput("op-no-email"))),
      ),
      "unauthenticated",
    );
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("rejects org-only credential contexts and non-members", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID, credentialScope: "org" }, () =>
          service().create(slackInput("op-org-only")),
        ),
      ),
      "forbidden",
    );

    expectServiceError(
      await caught(
        runAs({ email: BOB, orgId: ORG_ID }, () =>
          service().create(slackInput("op-nonmember")),
        ),
      ),
      "forbidden",
    );
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("rejects forged identity, scope, and storage fields", async () => {
    expect(() =>
      createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        userEmail: ALICE,
      } as any),
    ).toThrow(PersonalWorkspaceCredentialError);

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            ...slackInput("op-forged"),
            ownerEmail: ALICE,
          } as any),
        ),
      ),
      "invalid_input",
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-forged-secret",
            provider: "slack",
            secretValues: [
              {
                key: "SLACK_BOT_TOKEN",
                secret: "canary",
                scopeId: connectionCredentialScopeId({
                  id: "forged",
                  ownerEmail: ALICE,
                  orgId: null,
                }),
              },
            ],
          } as any),
        ),
      ),
      "invalid_input",
    );
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("rejects unknown providers, OAuth providers, keys, and config", async () => {
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-unknown-provider",
            provider: "not-a-provider",
            secretValues: [],
          }),
        ),
      ),
      "unsupported_provider",
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-oauth",
            provider: "github",
            secretValues: [{ key: "GITHUB_TOKEN", secret: "canary" }],
          }),
        ),
      ),
      "unsupported_provider",
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-unknown-key",
            provider: "slack",
            secretValues: [
              { key: "SLACK_BOT_TOKEN", secret: "canary" },
              { key: "UNKNOWN_KEY", secret: "canary" },
            ],
          }),
        ),
      ),
      "invalid_input",
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-missing-required",
            provider: "slack",
            secretValues: [],
          }),
        ),
      ),
      "invalid_input",
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-missing-config",
            provider: "dbt",
            secretValues: [],
          }),
        ),
      ),
      "invalid_input",
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-unknown-config",
            provider: "dbt",
            config: {
              semanticLayerBaseUrl: "https://canary.example.test/graphql",
              semanticLayerEnvironmentId: "canary-env",
              unknown: "canary",
            },
            secretValues: [],
          }),
        ),
      ),
      "invalid_input",
    );
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("rejects non-user and OAuth-kind native definitions", async () => {
    registerRequiredSecret({
      key: "SLACK_BOT_TOKEN",
      label: "Slack",
      scope: "org",
      kind: "api-key",
    });
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-org-definition")),
        ),
      ),
      "unsupported_credential",
    );

    __resetSecretsRegistry();
    registerRequiredSecret({
      key: "SLACK_BOT_TOKEN",
      label: "Slack",
      scope: "user",
      kind: "oauth",
    });
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-oauth-definition")),
        ),
      ),
      "unsupported_credential",
    );
    expect(await tableCount("workspace_connections")).toBe(0);
  });

  it("denies restricted members before validators or writes", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const validator = vi.fn(async () => true);
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic",
      scope: "user",
      kind: "api-key",
      validator,
    });
    await writePersonalProviderKeyPolicy(ORG_ID, {
      restricted: true,
      updatedBy: "admin@example.test",
    });

    expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID }, () =>
          service().create({
            operationId: "op-restricted",
            provider: "anthropic-managed-agents",
            secretValues: [
              { key: "ANTHROPIC_API_KEY", secret: "canary-restricted" },
            ],
          }),
        ),
      ),
      "forbidden",
    );
    expect(validator).not.toHaveBeenCalled();
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("allows an owner under the same restricted policy", async () => {
    await seedOrgMember(ORG_ID, ALICE, "owner");
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic",
      scope: "user",
      kind: "api-key",
      validator: async () => true,
    });
    await writePersonalProviderKeyPolicy(ORG_ID, {
      restricted: true,
      updatedBy: ALICE,
    });

    const result = await runAs({ email: ALICE, orgId: ORG_ID }, () =>
      service().create({
        operationId: "op-owner",
        provider: "anthropic-managed-agents",
        secretValues: [{ key: "ANTHROPIC_API_KEY", secret: "canary-owner" }],
      }),
    );
    expect(result.connectionId).toMatch(/^pconn1:/);
    expect(await tableCount("workspace_connections")).toBe(1);
  });

  it("runs controlled native validators after authorization and outside the transaction", async () => {
    let sawTransaction = -1;
    registerRequiredSecret({
      key: "SLACK_BOT_TOKEN",
      label: "Slack",
      scope: "user",
      kind: "api-key",
      validator: async () => {
        sawTransaction = transactionDepth;
        return true;
      },
    });

    await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-validator")),
    );
    expect(sawTransaction).toBe(0);
  });

  it("turns validator refusals and throws into closed, value-free errors", async () => {
    const value = "canary-validator-secret";
    registerRequiredSecret({
      key: "SLACK_BOT_TOKEN",
      label: "Slack",
      scope: "user",
      kind: "api-key",
      validator: async () => ({ ok: false, error: `rejected ${value}` }),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-validator-refuse", value)),
        ),
      ),
      "validator_rejected",
    );
    expect(first.message).not.toContain(value);
    expect(JSON.stringify(first)).not.toContain(value);

    __resetSecretsRegistry();
    registerRequiredSecret({
      key: "SLACK_BOT_TOKEN",
      label: "Slack",
      scope: "user",
      kind: "api-key",
      validator: async () => {
        throw new Error(`provider said ${value}`);
      },
    });
    const second = expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-validator-throw", value)),
        ),
      ),
      "validator_rejected",
    );
    expect(second.message).not.toContain(value);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("runs no validator when the input fails authorization", async () => {
    const validator = vi.fn(async () => true);
    registerRequiredSecret({
      key: "SLACK_BOT_TOKEN",
      label: "Slack",
      scope: "user",
      kind: "api-key",
      validator,
    });
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-missing-before-validator",
            provider: "slack",
            secretValues: [],
          }),
        ),
      ),
      "invalid_input",
    );
    expect(validator).not.toHaveBeenCalled();
  });

  it("rolls back when the first value write fails", async () => {
    await ensureAppSecretsTable();
    await pglite.exec(
      `ALTER TABLE app_secrets ADD CONSTRAINT personal_credentials_fail_value
       CHECK (key <> 'SLACK_BOT_TOKEN')`,
    );

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-rollback-value")),
        ),
      ),
      "write_failed",
    );
    expect(await tableCount("app_secrets")).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("workspace_connection_grants")).toBe(0);
  });

  it("rolls back values when the connection write fails", async () => {
    await ensureAppSecretsTable();
    await ensureWorkspaceConnectionsTable();
    await pglite.exec(
      `ALTER TABLE workspace_connections ADD CONSTRAINT personal_credentials_fail_connection
       CHECK (id NOT LIKE 'pconn1:%')`,
    );

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-rollback-connection")),
        ),
      ),
      "write_failed",
    );
    expect(await tableCount("app_secrets")).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("workspace_connection_grants")).toBe(0);
  });

  it("rolls back values and the connection when the grant write fails", async () => {
    await ensureAppSecretsTable();
    await ensureWorkspaceConnectionsTable();
    await pglite.exec(
      `ALTER TABLE workspace_connection_grants ADD CONSTRAINT personal_credentials_fail_grant
       CHECK (app_id <> '${APP_ID}')`,
    );

    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-rollback-grant")),
        ),
      ),
      "write_failed",
    );
    expect(await tableCount("app_secrets")).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("workspace_connection_grants")).toBe(0);
  });

  it("reconciles one ambiguous post-commit failure without a second write", async () => {
    const warm = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-warm")),
    );
    expect(warm.connectionId).toMatch(/^pconn1:/);

    commitThenThrow = true;
    const result = await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-ambiguous")),
    );
    expect(result.connectionId).toMatch(/^pconn1:/);
    expect(await tableCount("workspace_connections")).toBe(2);
    expect(await tableCount("workspace_connection_grants")).toBe(2);
    expect(await tableCount("app_secrets")).toBe(2);
  });

  it("returns a closed write error when reconciliation finds nothing", async () => {
    await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-warm-2")),
    );
    failBeforeTransaction = true;
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-no-commit")),
        ),
      ),
      "write_failed",
    );
    expect(await tableCount("workspace_connections")).toBe(1);
    expect(await tableCount("workspace_connection_grants")).toBe(1);
    expect(await tableCount("app_secrets")).toBe(1);
  });

  it("preserves native policy fallback when the strict request has no org", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const validator = vi.fn(async () => true);
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic",
      scope: "user",
      kind: "api-key",
      validator,
    });
    await writePersonalProviderKeyPolicy(ORG_ID, {
      restricted: true,
      updatedBy: "admin@example.test",
    });

    const error = expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create({
            operationId: "op-solo-restricted",
            provider: "anthropic-managed-agents",
            secretValues: [{ key: "ANTHROPIC_API_KEY", secret: "canary-solo" }],
          }),
        ),
      ),
      "forbidden",
    );
    expect(error.message).not.toContain("canary-solo");
    expect(validator).not.toHaveBeenCalled();
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("workspace_connection_grants")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("keeps owner exemption under the same native fallback policy", async () => {
    await seedOrgMember(ORG_ID, ALICE, "owner");
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic",
      scope: "user",
      kind: "api-key",
      validator: async () => true,
    });
    await writePersonalProviderKeyPolicy(ORG_ID, {
      restricted: true,
      updatedBy: ALICE,
    });

    const result = await runAs({ email: ALICE }, () =>
      service().create({
        operationId: "op-solo-owner",
        provider: "anthropic-managed-agents",
        secretValues: [{ key: "ANTHROPIC_API_KEY", secret: "canary-owner" }],
      }),
    );
    expect(result.connectionId).toMatch(/^pconn1:/);
    expect(await tableCount("workspace_connections")).toBe(1);
  });

  it.each(["", "   "])(
    "rejects an invalid org string %j instead of treating it as no org",
    async (orgId) => {
      expectServiceError(
        await caught(
          runAs({ email: ALICE, orgId }, () =>
            service().create(slackInput("op-invalid-org")),
          ),
        ),
        "forbidden",
      );
      expect(await tableCount("workspace_connections")).toBe(0);
      expect(await tableCount("app_secrets")).toBe(0);
    },
  );

  it("re-reads native policy at write time after a cross-context change", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const validator = vi.fn(async () => {
      await runWithRequestContext({ userEmail: "admin@example.test" }, () =>
        writePersonalProviderKeyPolicy(ORG_ID, {
          restricted: true,
          updatedBy: "admin@example.test",
        }),
      );
      return true;
    });
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Anthropic",
      scope: "user",
      kind: "api-key",
      validator,
    });

    const error = expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID }, () =>
          service().create({
            operationId: "op-policy-change",
            provider: "anthropic-managed-agents",
            secretValues: [
              { key: "ANTHROPIC_API_KEY", secret: "canary-policy-change" },
            ],
          }),
        ),
      ),
      "forbidden",
    );
    expect(validator).toHaveBeenCalledTimes(1);
    expect(error.message).not.toContain("canary-policy-change");
    expect(await tableCount("workspace_connections")).toBe(0);
    expect(await tableCount("workspace_connection_grants")).toBe(0);
    expect(await tableCount("app_secrets")).toBe(0);
  });

  it("requires current membership before returning a replay match under the lock", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const first = await runAs({ email: ALICE, orgId: ORG_ID }, () =>
      service().create(slackInput("op-replay-auth")),
    );

    hideExistingUntilLock = true;
    afterLockHook = async (tx) => {
      await tx.execute({
        sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
        args: [ORG_ID, ALICE],
      });
    };

    expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID }, () =>
          service().create(slackInput("op-replay-auth")),
        ),
      ),
      "forbidden",
    );
    hideExistingUntilLock = false;
    expect(await tableCount("workspace_connections")).toBe(1);
    expect(await tableCount("workspace_connection_grants")).toBe(1);
    const connection = await runAs({ email: ALICE, orgId: ORG_ID }, () =>
      getWorkspaceConnection(first.connectionId),
    );
    expect(connection?.id).toBe(first.connectionId);
  });

  it.each([401, 403, 409])(
    "stops without readback when a native %i refusal follows commit",
    async (statusCode) => {
      await runAs({ email: ALICE }, () =>
        service().create(slackInput(`op-warm-refusal-${statusCode}`)),
      );
      armRefusalAfterCommit(
        new ActionContractError("native refusal canary", {
          errorCode: "test_refusal",
          statusCode,
        }),
      );

      const error = expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            service().create(slackInput(`op-refusal-${statusCode}`)),
          ),
        ),
        "refused",
      );
      expect(error.statusCode).toBe(statusCode);
      expect(error.message).not.toContain("native refusal canary");
      const readbacks = readbackReads;
      trackingReadbacks = false;
      expect(readbacks).toBe(0);
      expect(await tableCount("workspace_connections")).toBe(2);
      expect(await tableCount("workspace_connection_grants")).toBe(2);
    },
  );

  it("stops without readback on a native no-write failure after commit", async () => {
    await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-warm-no-write")),
    );
    armRefusalAfterCommit(new NoWriteError("native no-write canary"));

    const error = expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-no-write-refusal")),
        ),
      ),
      "refused",
    );
    expect(error.statusCode).toBe(400);
    expect(error.message).not.toContain("native no-write canary");
    const readbacks = readbackReads;
    trackingReadbacks = false;
    expect(readbacks).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(2);
  });

  it("stops without readback when an error prototype cannot be inspected", async () => {
    await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-warm-proxy-error")),
    );
    const error = new Proxy(new Error("opaque driver failure"), {
      getPrototypeOf() {
        throw new Error("proxy classification canary");
      },
    });
    armRefusalAfterCommit(error);
    const failure = await caught(
      runAs({ email: ALICE }, () =>
        service().create(slackInput("op-proxy-error")),
      ),
    );
    expectServiceError(failure, "refused");
    expect(readbackReads).toBe(0);
    trackingReadbacks = false;
    expect(await tableCount("workspace_connections")).toBe(2);
  });

  it("does not describe an unknown outcome as an uncommitted write", () => {
    expect(new PersonalWorkspaceCredentialError("write_failed").message).toBe(
      "The personal workspace credential outcome could not be confirmed.",
    );
  });

  it("fails closed without readback when refusal classification throws", async () => {
    await runAs({ email: ALICE }, () =>
      service().create(slackInput("op-warm-unreadable")),
    );
    const unreadable: { statusCode?: unknown } = {};
    Object.defineProperty(unreadable, "statusCode", {
      get() {
        throw new Error("getter canary");
      },
    });
    armRefusalAfterCommit(unreadable);

    const error = expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().create(slackInput("op-unreadable-refusal")),
        ),
      ),
      "refused",
    );
    expect(error.message).not.toContain("getter canary");
    const readbacks = readbackReads;
    trackingReadbacks = false;
    expect(readbacks).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(2);
  });

  it("rejects request and factory accessors without executing them", async () => {
    let reads = 0;
    const factory = {
      get appId() {
        reads += 1;
        return APP_ID;
      },
    };
    let factoryError: unknown;
    try {
      createPersonalWorkspaceCredentialService(factory);
    } catch (error) {
      factoryError = error;
    }
    expectServiceError(factoryError, "invalid_input");
    const input = {
      ...slackInput("op-getter"),
      get name() {
        reads += 1;
        return "Getter";
      },
    };
    expectServiceError(
      await caught(runAs({ email: ALICE }, () => service().create(input))),
      "invalid_input",
    );
    expect(reads).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(0);
  });

  it("rejects a non-plain config and a reserved own config key", async () => {
    for (const config of [new Map(), JSON.parse('{"__proto__":"hidden"}')]) {
      const input = { ...slackInput("op-data-config"), config };
      expectServiceError(
        await caught(runAs({ email: ALICE }, () => service().create(input))),
        "invalid_input",
      );
    }
    expect(await tableCount("workspace_connections")).toBe(0);
  });

  it("closes a native adapter error before the transaction starts", async () => {
    const original = currentExec;
    if (!original) throw new Error("Expected an owned adapter");
    currentExec = new Proxy(original, {
      get(target, key, receiver) {
        if (key === "transaction") throw new Error("private-adapter-canary");
        return Reflect.get(target, key, receiver);
      },
    });
    const error = await caught(
      runAs({ email: ALICE }, () =>
        service().create(slackInput("op-adapter-error")),
      ),
    );
    expectServiceError(error, "write_failed");
    expect((error as Error).message).not.toContain("private-adapter-canary");
  });

  it("reauthorizes before reading committed values after an ambiguous acknowledgement", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "Model key",
      scope: "user",
      kind: "api-key",
      validator: async () => true,
    });
    postCommitHook = async () => {
      const context = getRequestContext();
      if (!context) throw new Error("Expected the controlled request context");
      context.userEmail = BOB;
      trackingReadbacks = true;
      readbackReads = 0;
      throw new Error("controlled post-commit acknowledgement loss");
    };
    const error = await caught(
      runAs({ email: ALICE, orgId: ORG_ID }, () =>
        service().create({
          operationId: "op-post-commit-policy",
          provider: "anthropic-managed-agents",
          secretValues: [
            { key: "ANTHROPIC_API_KEY", secret: "canary-post-commit-policy" },
          ],
        }),
      ),
    );
    expectServiceError(error, "forbidden");
    expect(readbackReads).toBe(0);
    expect(await tableCount("workspace_connections")).toBe(1);
    expect(await tableCount("app_secrets")).toBe(1);
  });

  it("refreshes authorization before each validator receives a key", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const secondValidator = vi.fn(async () => true);
    registerRequiredSecret({
      key: "ANTHROPIC_API_KEY",
      label: "First",
      scope: "user",
      kind: "api-key",
      validator: async () => {
        await runWithRequestContext({ userEmail: "admin@example.test" }, () =>
          writePersonalProviderKeyPolicy(ORG_ID, {
            restricted: true,
            updatedBy: "admin@example.test",
          }),
        );
        return true;
      },
    });
    registerRequiredSecret({
      key: "OPENAI_API_KEY",
      label: "Second",
      scope: "user",
      kind: "api-key",
      validator: secondValidator,
    });
    const instance = createPersonalWorkspaceCredentialService({
      appId: APP_ID,
      providers: [
        {
          id: "two-model-keys-personal",
          label: "Two keys",
          credentialKeys: [
            { key: "ANTHROPIC_API_KEY", label: "First" },
            { key: "OPENAI_API_KEY", label: "Second" },
          ],
        },
      ],
    });
    expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID }, () =>
          instance.create({
            operationId: "op-validator-authority",
            provider: "two-model-keys-personal",
            secretValues: [
              { key: "ANTHROPIC_API_KEY", secret: "canary-first" },
              { key: "OPENAI_API_KEY", secret: "canary-second" },
            ],
          }),
        ),
      ),
      "forbidden",
    );
    expect(secondValidator).not.toHaveBeenCalled();
    expect(await tableCount("workspace_connections")).toBe(0);
  });

  it("fails closed if a builtin appears after a custom factory snapshot", async () => {
    const original = credentialCatalog.getWorkspaceConnectionProvider;
    let hideBuiltin = true;
    vi.spyOn(
      credentialCatalog,
      "getWorkspaceConnectionProvider",
    ).mockImplementation((id, overrides) =>
      id === "slack" && hideBuiltin ? undefined : original(id, overrides),
    );
    const instance = createPersonalWorkspaceCredentialService({
      appId: APP_ID,
      providers: [
        {
          id: "slack",
          label: "Custom",
          credentialKeys: [{ key: "SLACK_BOT_TOKEN", label: "Token" }],
        },
      ],
    });
    hideBuiltin = false;
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          instance.create(slackInput("op-new-builtin")),
        ),
      ),
      "unsupported_provider",
    );
    expect(await tableCount("workspace_connections")).toBe(0);
  });

  describe("custom provider definitions", () => {
    const CUSTOM_BASIC = {
      id: "http-basic-personal",
      label: "HTTP Basic",
      credentialKeys: [
        { key: "HTTP_BASIC_USERNAME", label: "Username" },
        { key: "HTTP_BASIC_PASSWORD", label: "Password", required: true },
      ],
    };
    const CUSTOM_TOKEN = {
      id: "http-token-personal",
      label: "HTTP Token",
      credentialKeys: [
        { key: "HTTP_BASIC_PASSWORD", label: "Token", required: true },
      ],
    };

    function customService() {
      return createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        providers: [CUSTOM_BASIC, CUSTOM_TOKEN],
      });
    }

    function customBasicInput(
      operationId: string,
      password = "canary-basic-password",
    ) {
      return {
        operationId,
        provider: "http-basic-personal",
        name: "Alice HTTP Basic",
        secretValues: [
          { key: "HTTP_BASIC_USERNAME", secret: "canary-basic-user" },
          { key: "HTTP_BASIC_PASSWORD", secret: password },
        ],
      };
    }

    it("rejects an omitted required config key that names an Object prototype member", async () => {
      const definition = {
        ...CUSTOM_BASIC,
        configurationFields: [
          { key: "toString", label: "Required text", required: true },
        ],
      };
      const instance = createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        providers: [definition],
      });
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            instance.create(customBasicInput("op-required-prototype")),
          ),
        ),
        "invalid_input",
      );
      expect(await tableCount("workspace_connections")).toBe(0);
    });

    it("preserves an explicit empty required configuration default", async () => {
      const definition = {
        ...CUSTOM_BASIC,
        configurationFields: [
          { key: "REALM", label: "Realm", required: true, defaultValue: "" },
        ],
      };
      const instance = createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        providers: [definition],
      });
      const result = await runAs({ email: ALICE }, () =>
        instance.create(customBasicInput("op-empty-default")),
      );
      await runAs({ email: ALICE }, async () => {
        const row = await getWorkspaceConnection(result.connectionId);
        expect(row?.config.REALM).toBe("");
      });
    });

    it("creates a custom Basic profile with two encrypted values and replays it", async () => {
      const first = await runAs({ email: ALICE }, () =>
        customService().create(customBasicInput("op-custom-basic")),
      );
      expect(first.connectionId).toMatch(/^pconn1:/);
      const namespace = connectionCredentialScopeId({
        id: first.connectionId,
        ownerEmail: ALICE,
        orgId: null,
      });
      const username = await readAppSecret({
        key: "HTTP_BASIC_USERNAME",
        scope: "user",
        scopeId: namespace,
      });
      const password = await readAppSecret({
        key: "HTTP_BASIC_PASSWORD",
        scope: "user",
        scopeId: namespace,
      });
      expect(username?.value).toBe("canary-basic-user");
      expect(password?.value).toBe("canary-basic-password");

      await runAs({ email: ALICE }, async () => {
        const connection = await getWorkspaceConnection(first.connectionId);
        expect(connection).toMatchObject({
          provider: "http-basic-personal",
          label: "Alice HTTP Basic",
          ownerEmail: ALICE,
          allowedApps: [APP_ID],
        });
        expect(connection?.credentialRefs.map((ref) => ref.key).sort()).toEqual(
          ["HTTP_BASIC_PASSWORD", "HTTP_BASIC_USERNAME"],
        );
      });

      const replay = await runAs({ email: ALICE }, () =>
        customService().create(customBasicInput("op-custom-basic")),
      );
      expect(replay.connectionId).toBe(first.connectionId);
      expect(await tableCount("workspace_connections")).toBe(1);
      expect(await tableCount("workspace_connection_grants")).toBe(1);
      expect(await tableCount("app_secrets")).toBe(2);
    });

    it("conflicts on a changed custom value or provider without overwriting", async () => {
      const first = await runAs({ email: ALICE }, () =>
        customService().create(customBasicInput("op-custom-conflict")),
      );
      const namespace = connectionCredentialScopeId({
        id: first.connectionId,
        ownerEmail: ALICE,
        orgId: null,
      });

      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            customService().create(
              customBasicInput("op-custom-conflict", "canary-changed"),
            ),
          ),
        ),
        "conflict",
      );
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            customService().create({
              operationId: "op-custom-conflict",
              provider: "http-token-personal",
              secretValues: [
                { key: "HTTP_BASIC_PASSWORD", secret: "canary-basic-password" },
              ],
            }),
          ),
        ),
        "conflict",
      );

      const password = await readAppSecret({
        key: "HTTP_BASIC_PASSWORD",
        scope: "user",
        scopeId: namespace,
      });
      expect(password?.value).toBe("canary-basic-password");
      expect(await tableCount("workspace_connections")).toBe(1);
      expect(await tableCount("workspace_connection_grants")).toBe(1);
      expect(await tableCount("app_secrets")).toBe(2);
    });

    it("keeps the factory snapshot when the caller mutates its definitions", async () => {
      const mutable = {
        id: "http-basic-personal",
        label: "HTTP Basic",
        credentialKeys: [
          { key: "HTTP_BASIC_USERNAME", label: "Username" },
          { key: "HTTP_BASIC_PASSWORD", label: "Password", required: true },
        ],
      };
      const providers = [mutable];
      const snapshotService = createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        providers,
      });
      mutable.label = "Mutated";
      mutable.credentialKeys.push({
        key: "EXTRA_REQUIRED",
        label: "Extra",
        required: true,
      });

      const result = await runAs({ email: ALICE }, () =>
        snapshotService.create({
          operationId: "op-snapshot",
          provider: "http-basic-personal",
          secretValues: [
            { key: "HTTP_BASIC_USERNAME", secret: "canary-snapshot-user" },
            { key: "HTTP_BASIC_PASSWORD", secret: "canary-snapshot-password" },
          ],
        }),
      );
      await runAs({ email: ALICE }, async () => {
        const connection = await getWorkspaceConnection(result.connectionId);
        expect(connection?.label).toBe("HTTP Basic");
      });
      expect(await tableCount("app_secrets")).toBe(2);
    });

    it("does not let another factory app or actor reuse an operation's connection", async () => {
      const first = await runAs({ email: ALICE }, () =>
        customService().create(customBasicInput("op-scope")),
      );
      const otherApp = createPersonalWorkspaceCredentialService({
        appId: "app-other-personal",
        providers: [CUSTOM_BASIC],
      });
      const otherAppResult = await runAs({ email: ALICE }, () =>
        otherApp.create(customBasicInput("op-scope")),
      );
      expect(otherAppResult.connectionId).not.toBe(first.connectionId);

      const bobResult = await runAs({ email: BOB }, () =>
        customService().create(customBasicInput("op-scope")),
      );
      expect(bobResult.connectionId).not.toBe(first.connectionId);

      const strayGrant = await runAs({ email: ALICE }, () =>
        getWorkspaceConnectionGrant(first.connectionId, "app-other-personal"),
      );
      expect(strayGrant ?? null).toBeNull();
      expect(await tableCount("workspace_connections")).toBe(3);
      expect(await tableCount("workspace_connection_grants")).toBe(3);
    });

    it("rejects a factory definition that collides with a builtin provider", () => {
      let thrown: unknown;
      try {
        createPersonalWorkspaceCredentialService({
          appId: APP_ID,
          providers: [
            {
              id: "slack",
              label: "Shadow Slack",
              credentialKeys: [{ key: "SLACK_BOT_TOKEN", label: "Token" }],
            },
          ],
        });
      } catch (error) {
        thrown = error;
      }
      expectServiceError(thrown, "invalid_input");
    });

    const RAW_USER = "  canary-raw-user\t";
    const RAW_PASSWORD = "\n canary-raw-pass \t\n";
    const RAW_BASIC = {
      id: "http-raw-basic-personal",
      label: "HTTP Raw Basic",
      credentialKeys: [
        {
          key: "HTTP_BASIC_USERNAME",
          label: "Username",
          preserveWhitespace: true,
        },
        {
          key: "HTTP_BASIC_PASSWORD",
          label: "Password",
          required: true,
          preserveWhitespace: true,
        },
      ],
    };
    const rawService = () =>
      createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        providers: [RAW_BASIC],
      });
    const rawInput = (
      operationId: string,
      username = RAW_USER,
      password = RAW_PASSWORD,
    ) => ({
      operationId,
      provider: "http-raw-basic-personal",
      name: "Alice Raw Basic",
      secretValues: [
        { key: "HTTP_BASIC_USERNAME", secret: username },
        { key: "HTTP_BASIC_PASSWORD", secret: password },
      ],
    });
    const storedSecret = async (connectionId: string, key: string) =>
      (
        await readAppSecret({
          key,
          scope: "user",
          scopeId: connectionCredentialScopeId({
            id: connectionId,
            ownerEmail: ALICE,
            orgId: null,
          }),
        })
      )?.value;
    const registerPasswordValidator = (
      seen: string[],
      accept: (value: string) => boolean,
    ) =>
      registerRequiredSecret({
        key: "HTTP_BASIC_PASSWORD",
        kind: "api-key",
        scope: "user",
        validator: (value: string) => {
          seen.push(value);
          return accept(value);
        },
      });

    it("stores exact raw literals, keeps ciphertext opaque, and replays by id", async () => {
      const first = await runAs({ email: ALICE }, () =>
        rawService().create(rawInput("op-raw")),
      );
      expect(
        await storedSecret(first.connectionId, "HTTP_BASIC_USERNAME"),
      ).toBe(RAW_USER);
      expect(
        await storedSecret(first.connectionId, "HTTP_BASIC_PASSWORD"),
      ).toBe(RAW_PASSWORD);
      const dump = (await pglite.query("SELECT * FROM app_secrets")).rows
        .map((row) => Object.values(row).join("|"))
        .join("\n");
      expect(dump).not.toContain("canary-raw-user");
      expect(dump).not.toContain("canary-raw-pass");
      const replay = await runAs({ email: ALICE }, () =>
        rawService().create(rawInput("op-raw")),
      );
      expect(replay.connectionId).toBe(first.connectionId);
      expect(await tableCount("workspace_connections")).toBe(1);
      expect(await tableCount("workspace_connection_grants")).toBe(1);
      expect(await tableCount("app_secrets")).toBe(2);
    });

    it("persists a whitespace-only preserved value and rejects a truly empty one", async () => {
      const first = await runAs({ email: ALICE }, () =>
        rawService().create(rawInput("op-raw-blank", RAW_USER, "   ")),
      );
      expect(
        await storedSecret(first.connectionId, "HTTP_BASIC_PASSWORD"),
      ).toBe("   ");
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            rawService().create(rawInput("op-raw-empty", RAW_USER, "")),
          ),
        ),
        "invalid_input",
      );
      expect(await tableCount("workspace_connections")).toBe(1);
    });

    it("conflicts on changed literal whitespace under one operation without overwriting", async () => {
      const first = await runAs({ email: ALICE }, () =>
        rawService().create(rawInput("op-raw-conflict")),
      );
      for (const input of [
        rawInput("op-raw-conflict", RAW_USER, RAW_PASSWORD.trim()),
        rawInput("op-raw-conflict", RAW_USER.trim(), RAW_PASSWORD),
      ]) {
        expectServiceError(
          await caught(
            runAs({ email: ALICE }, () => rawService().create(input)),
          ),
          "conflict",
        );
      }
      expect(
        await storedSecret(first.connectionId, "HTTP_BASIC_PASSWORD"),
      ).toBe(RAW_PASSWORD);
      expect(
        await storedSecret(first.connectionId, "HTTP_BASIC_USERNAME"),
      ).toBe(RAW_USER);
      expect(await tableCount("workspace_connections")).toBe(1);
      expect(await tableCount("app_secrets")).toBe(2);
    });

    it("keeps trimming for flag-absent fields and builtins, rejecting blanks before any write", async () => {
      const custom = await runAs({ email: ALICE }, () =>
        customService().create({
          operationId: "op-trim",
          provider: "http-basic-personal",
          secretValues: [
            { key: "HTTP_BASIC_USERNAME", secret: "  canary-trim-user  " },
            { key: "HTTP_BASIC_PASSWORD", secret: "canary-trim-pass" },
          ],
        }),
      );
      expect(
        await storedSecret(custom.connectionId, "HTTP_BASIC_USERNAME"),
      ).toBe("canary-trim-user");
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            customService().create(customBasicInput("op-blank", "   ")),
          ),
        ),
        "invalid_input",
      );
      const slack = await runAs({ email: ALICE }, () =>
        service().create(slackInput("op-slack-trim", "  canary-slack-trim  ")),
      );
      expect(await storedSecret(slack.connectionId, "SLACK_BOT_TOKEN")).toBe(
        "canary-slack-trim",
      );
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            service().create(slackInput("op-slack-blank", "   ")),
          ),
        ),
        "invalid_input",
      );
      expect(await tableCount("workspace_connections")).toBe(2);
    });

    it("never accepts the flag per call or on configuration fields", async () => {
      const smuggled = {
        key: "HTTP_BASIC_USERNAME",
        secret: RAW_USER,
        preserveWhitespace: true,
      };
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            rawService().create({
              ...rawInput("op-call-flag"),
              secretValues: [
                smuggled,
                { key: "HTTP_BASIC_PASSWORD", secret: RAW_PASSWORD },
              ],
            }),
          ),
        ),
        "invalid_input",
      );
      const badField = {
        key: "REALM",
        label: "Realm",
        preserveWhitespace: true,
      };
      let thrown: unknown;
      try {
        createPersonalWorkspaceCredentialService({
          appId: APP_ID,
          providers: [{ ...CUSTOM_BASIC, configurationFields: [badField] }],
        });
      } catch (error) {
        thrown = error;
      }
      expectServiceError(thrown, "invalid_input");
      expect(await tableCount("workspace_connections")).toBe(0);
    });

    it("gives a registered validator the exact literal and still honors its rejection", async () => {
      const seen: string[] = [];
      registerPasswordValidator(seen, (value) => value === RAW_PASSWORD);
      const ok = await runAs({ email: ALICE }, () =>
        rawService().create(rawInput("op-validator")),
      );
      expect(seen).toEqual([RAW_PASSWORD]);
      expect(await storedSecret(ok.connectionId, "HTTP_BASIC_PASSWORD")).toBe(
        RAW_PASSWORD,
      );
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            customService().create(
              customBasicInput("op-validator-trim", RAW_PASSWORD),
            ),
          ),
        ),
        "validator_rejected",
      );
      expect(seen).toEqual([RAW_PASSWORD, "canary-raw-pass"]);
      expect(await tableCount("workspace_connections")).toBe(1);
    });

    it("stops before the validator when org membership denies the write", async () => {
      const seen: string[] = [];
      registerPasswordValidator(seen, () => true);
      expectServiceError(
        await caught(
          runAs({ email: ALICE, orgId: ORG_ID }, () =>
            rawService().create(rawInput("op-denied")),
          ),
        ),
        "forbidden",
      );
      expect(seen).toEqual([]);
      expect(await tableCount("workspace_connections")).toBe(0);
    });

    it("keeps the held service's preserve flag immune to caller mutation", async () => {
      const passwordKey = {
        key: "HTTP_BASIC_PASSWORD",
        label: "Password",
        preserveWhitespace: true,
      };
      const mutable = {
        id: "http-mutable-raw-personal",
        label: "Mutable Raw",
        credentialKeys: [passwordKey],
      };
      const instance = createPersonalWorkspaceCredentialService({
        appId: APP_ID,
        providers: [mutable],
      });
      passwordKey.preserveWhitespace = false;
      const result = await runAs({ email: ALICE }, () =>
        instance.create({
          operationId: "op-immutable",
          provider: "http-mutable-raw-personal",
          secretValues: [{ key: "HTTP_BASIC_PASSWORD", secret: RAW_PASSWORD }],
        }),
      );
      expect(
        await storedSecret(result.connectionId, "HTTP_BASIC_PASSWORD"),
      ).toBe(RAW_PASSWORD);
    });
  });

  it("emits no lifecycle event for a create", async () => {
    const listener = vi.fn();
    const unsubscribe = registerWorkspaceConnectionLifecycleListener(listener);
    try {
      await runAs({ email: ALICE }, () =>
        service().create(slackInput("op-no-event")),
      );
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

describe("saved personal credential identity lookup", () => {
  it("returns exact saved identities for distinct operations without reading secrets or writing", async () => {
    const first = await runAs({ email: ALICE }, () =>
      service().create(slackInput("lookup-first")),
    );
    const second = await runAs({ email: ALICE }, () =>
      service().create(slackInput("lookup-second")),
    );
    const exec = currentExec;
    if (!exec) throw new Error("Expected fixture executor");
    const originalExecute = exec.execute.bind(exec);
    // raw-sql-ok: spy forwards the caller's statement unchanged
    const execute = vi
      .spyOn(exec, "execute")
      .mockImplementation(async (input) => {
        if (/app_secrets|INSERT|UPDATE|DELETE/i.test(sqlOf(input)))
          throw new Error("Forbidden lookup effect");
        return originalExecute(input);
      });
    await expect(
      runAs({ email: ALICE }, () =>
        service().findCreatedConnection({ operationId: " lookup-first " }),
      ),
    ).resolves.toEqual(first);
    await expect(
      runAs({ email: ALICE }, () =>
        service().findCreatedConnection({ operationId: "lookup-second" }),
      ),
    ).resolves.toEqual(second);
    expect(first.connectionId).not.toBe(second.connectionId);
    expect(execute).toHaveBeenCalled();
    expect(
      execute.mock.calls.some(([input]) =>
        /app_secrets|INSERT|UPDATE|DELETE/i.test(sqlOf(input)),
      ),
    ).toBe(false);
  });

  it("does not disclose another actor, app or organization's saved identity", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const created = await runAs({ email: ALICE, orgId: ORG_ID }, () =>
      service().create(slackInput("lookup-scope")),
    );
    for (const actor of [{ email: BOB }, { email: ALICE }]) {
      await expect(
        runAs(actor, () =>
          service().findCreatedConnection({ operationId: "lookup-scope" }),
        ),
      ).resolves.toBeNull();
    }
    await expect(
      runAs({ email: ALICE, orgId: ORG_ID }, () =>
        createPersonalWorkspaceCredentialService({
          appId: "different-app",
        }).findCreatedConnection({
          operationId: "lookup-scope",
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      runAs({ email: ALICE, orgId: ORG_ID }, () =>
        service().findCreatedConnection({ operationId: "lookup-scope" }),
      ),
    ).resolves.toEqual(created);
  });

  it.each([
    {},
    { operationId: "" },
    { operationId: "lookup", secretValues: [] },
    { operationId: "lookup", appId: APP_ID },
  ])("rejects invalid or scope-bearing lookup input %j", async (input) => {
    const error = await caught(
      runAs({ email: ALICE }, () =>
        service().findCreatedConnection(input as { operationId: string }),
      ),
    );
    expectServiceError(error, "invalid_input");
  });

  it("rejects missing authentication and revoked membership before disclosing presence", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    await runAs({ email: ALICE, orgId: ORG_ID }, () =>
      service().create(slackInput("lookup-revoked")),
    );
    expectServiceError(
      await caught(
        runAs({}, () =>
          service().findCreatedConnection({ operationId: "lookup-revoked" }),
        ),
      ),
      "unauthenticated",
    );
    await pglite.query(
      "DELETE FROM org_members WHERE org_id = ? AND email = ?",
      [ORG_ID, ALICE],
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID }, () =>
          service().findCreatedConnection({ operationId: "lookup-revoked" }),
        ),
      ),
      "forbidden",
    );
  });

  it("distinguishes absent operations from partial records and unreadable storage", async () => {
    await expect(
      runAs({ email: ALICE }, () =>
        service().findCreatedConnection({ operationId: "lookup-absent" }),
      ),
    ).resolves.toBeNull();
    const created = await runAs({ email: ALICE }, () =>
      service().create(slackInput("lookup-partial")),
    );
    await pglite.query(
      "DELETE FROM workspace_connection_grants WHERE connection_id = ?",
      [created.connectionId],
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().findCreatedConnection({ operationId: "lookup-partial" }),
        ),
      ),
      "conflict",
    );
    const exec = currentExec;
    if (!exec) throw new Error("Expected fixture executor");
    vi.spyOn(exec, "execute").mockRejectedValue(
      new Error("test-private-value"),
    );
    const error = expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().findCreatedConnection({ operationId: "lookup-partial" }),
        ),
      ),
      "lookup_failed",
    );
    expect(error.message).not.toContain("test-private-value");
  });

  it.each(["userEmail", "authUserId"] as const)(
    "fails closed when %s changes while a persisted record is read",
    async (field) => {
      await runAs({ email: ALICE }, () =>
        service().create(slackInput("lookup-race")),
      );
      const exec = currentExec;
      if (!exec) throw new Error("Expected fixture executor");
      const originalExecute = exec.execute.bind(exec);
      // raw-sql-ok: spy forwards the caller's statement unchanged
      vi.spyOn(exec, "execute").mockImplementation(async (input) => {
        const result = await originalExecute(input);
        if (isGrantRead(sqlOf(input))) {
          const context = getRequestContext();
          if (!context) throw new Error("Expected fixture context");
          context[field] = BOB;
        }
        return result;
      });
      expectServiceError(
        await caught(
          runAs({ email: ALICE }, () =>
            service().findCreatedConnection({ operationId: "lookup-race" }),
          ),
        ),
        "forbidden",
      );
    },
  );
});

describe("saved identity authorization and metadata", () => {
  it("applies fresh personal-key policy to an existing saved operation", async () => {
    await seedOrgMember(ORG_ID, ALICE, "member");
    const input = {
      operationId: "lookup-policy",
      provider: "anthropic-managed-agents",
      secretValues: [
        { key: "ANTHROPIC_API_KEY", secret: "test-private-value" },
      ],
    };
    await runAs({ email: ALICE, orgId: ORG_ID }, () => service().create(input));
    await writePersonalProviderKeyPolicy(ORG_ID, {
      restricted: true,
      updatedBy: "admin@example.test",
    });
    expectServiceError(
      await caught(
        runAs({ email: ALICE, orgId: ORG_ID }, () =>
          service().findCreatedConnection({ operationId: input.operationId }),
        ),
      ),
      "forbidden",
    );
  });

  it("reads trusted custom provider operations including empty optional credentials", async () => {
    const instance = createPersonalWorkspaceCredentialService({
      appId: APP_ID,
      providers: [
        {
          id: "request-test",
          label: "Test request",
          credentialKeys: [{ key: "TEST_OPTIONAL_VALUE", label: "Value" }],
        },
      ],
    });
    const created = await runAs({ email: ALICE }, () =>
      instance.create({
        operationId: "lookup-custom",
        provider: "request-test",
        secretValues: [],
      }),
    );
    await expect(
      runAs({ email: ALICE }, () =>
        instance.findCreatedConnection({ operationId: "lookup-custom" }),
      ),
    ).resolves.toEqual(created);
  });

  it.each([
    ["status", "disabled"],
    ["allowed_apps_json", JSON.stringify([APP_ID, "other-app"])],
    ["allowed_users_json", JSON.stringify([ALICE, BOB])],
    ["config_json", JSON.stringify({ workspaceConnectionScope: "org" })],
  ])("refuses a saved record with altered %s", async (column, value) => {
    const created = await runAs({ email: ALICE }, () =>
      service().create(slackInput("lookup-altered")),
    );
    // The table-driven column names are fixed fixture identifiers.
    await pglite.query(
      `UPDATE workspace_connections SET ${column} = ? WHERE id = ?`,
      [value, created.connectionId],
    );
    expectServiceError(
      await caught(
        runAs({ email: ALICE }, () =>
          service().findCreatedConnection({ operationId: "lookup-altered" }),
        ),
      ),
      "conflict",
    );
  });
});
