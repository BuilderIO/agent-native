import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { __resetSecretsRegistry } from "../secrets/register.js";
import * as secretStore from "../secrets/storage.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveWorkspaceConnectionCredentialForApp } from "./credentials.js";
import { createPersonalCredentialProviderSnapshot } from "./personal-provider-definitions.js";
import {
  getWorkspaceConnection,
  revokeWorkspaceConnectionGrant,
  upsertWorkspaceConnection,
} from "./store.js";
import {
  createWorkspaceCredentialService,
  readWorkspaceCredential,
  type WorkspaceCredentialServiceOptions,
} from "./workspace-credentials.js";

let exec: DbExec;
vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => actual.getScopedDbExec() ?? exec };
});
const APP = "warehouse-test-app",
  ORG = "warehouse-test-org",
  OWNER = "owner@example.test",
  MEMBER = "member@example.test",
  OTHER = "other@example.test",
  KEY = "WAREHOUSE_CREDENTIAL",
  VALUE = "flagged-source-credential";
const provider = {
  id: "test-warehouse",
  label: "Warehouse",
  credentialKeys: [{ key: KEY, label: "Credential", required: true }],
  configurationFields: [
    { key: "project", label: "Project", defaultValue: "default-project" },
  ],
};
let db: Awaited<ReturnType<typeof createTestPglite>>,
  savedKey: string | undefined;
let transactionMode:
  | "normal"
  | "lost-ack"
  | "rollback"
  | "refused-after-commit";
function context(email = OWNER, orgId = ORG) {
  return { userEmail: email, orgId };
}
async function as<T>(
  job: () => Promise<T>,
  email = OWNER,
  orgId = ORG,
): Promise<T> {
  return runWithRequestContext(context(email, orgId), job);
}
function api(
  validateCredentials: WorkspaceCredentialServiceOptions["validateCredentials"] = async () => {},
  validationTimeoutMs = 15000,
) {
  return createWorkspaceCredentialService({
    appId: APP,
    provider,
    validateCredentials,
    validationTimeoutMs,
  });
}
function input(operationId = "create-operation", secret = VALUE) {
  return { operationId, secretValues: [{ key: KEY, secret }] };
}
function read(connectionId: string, email = MEMBER, orgId = ORG) {
  return readWorkspaceCredential({
    appId: APP,
    connectionId,
    provider: provider.id,
    key: KEY,
    requestContext: context(email, orgId),
  });
}
async function artifacts() {
  const counts: number[] = [];
  for (const table of [
    "workspace_connections",
    "workspace_connection_grants",
    "app_secrets",
  ]) {
    const result = await db.query(
      "SELECT to_regclass(?) IS NOT NULL AS present",
      [`public.${table}`],
    );
    if (!(result.rows[0] as { present: boolean }).present) {
      counts.push(0);
      continue;
    }
    const count = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts.push((count.rows[0] as { n: number }).n);
  }
  return counts;
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  savedKey = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = "workspace-credential-test-key";
  __resetSecretsRegistry();
  transactionMode = "normal";
  db = await createTestPglite({ reuseEmptyBootstrap: true });
  exec = {
    async execute(command) {
      if (typeof command === "string") {
        await db.exec(command);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await db.query(command.sql, [...(command.args ?? [])]);
      return {
        rows: result.rows,
        rowsAffected: result.affectedRows ?? result.rows.length,
      };
    },
    async transaction(job) {
      return db
        .transaction(async (tx) => {
          let ownPublication = false;
          const result = await job({
            execute: async (command) => {
              if (
                typeof command !== "string" &&
                command.sql.startsWith("SELECT pg_advisory_xact_lock") &&
                String(command.args?.[0]).startsWith("workspace-credential:")
              )
                ownPublication = true;
              return tx.execute(command);
            },
          });
          if (ownPublication && transactionMode === "rollback")
            throw new Error("controlled rollback");
          // A lost commit acknowledgement must be thrown AFTER the transaction
          // commits, so return a tagged result to the outer adapter below.
          return { result, ownPublication };
        })
        .then(({ result, ownPublication }) => {
          if (ownPublication && transactionMode === "lost-ack")
            throw new Error("controlled acknowledgement loss");
          if (ownPublication && transactionMode === "refused-after-commit")
            throw Object.assign(new Error("controlled refusal"), {
              statusCode: 409,
            });
          return result;
        });
    },
  };
  await db.exec(
    "CREATE TABLE org_members (org_id TEXT, email TEXT, role TEXT, joined_at BIGINT, federation_removal_pending_at TIMESTAMPTZ)",
  );
  for (const [org, email, role] of [
    [ORG, OWNER, "owner"],
    [ORG, MEMBER, "member"],
    ["foreign-org", OTHER, "owner"],
  ])
    await db.query("INSERT INTO org_members VALUES (?, ?, ?, 0, NULL)", [
      org,
      email,
      role,
    ]);
}, 30000);
afterEach(async () => {
  vi.restoreAllMocks();
  if (savedKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = savedKey;
  __resetSecretsRegistry();
  await db.close();
}, 30000);

describe("native validated workspace credentials", () => {
  it("supports fixed built-in service-account definitions without weakening personal collision protection", () => {
    const definition = {
      id: "bigquery",
      label: "Warehouse",
      credentialKeys: [
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          label: "Service account",
          required: true,
        },
        { key: "BIGQUERY_PROJECT_ID", label: "Project", required: true },
      ],
    };
    expect(() =>
      createWorkspaceCredentialService({
        appId: APP,
        provider: definition,
        validateCredentials: async () => {},
      }),
    ).not.toThrow();
    expect(() =>
      createPersonalCredentialProviderSnapshot([definition]),
    ).toThrow();
  });
  it("publishes exact encrypted credentials for two independent workspace sources and replays durable identity", async () => {
    const service = api(),
      first = await as(() => service.create(input("first"))),
      second = await as(() =>
        service.create(input("second", "another-source-credential")),
      );
    expect(first.connectionId).not.toBe(second.connectionId);
    expect(await read(first.connectionId)).toBe(VALUE);
    expect(await read(second.connectionId)).toBe("another-source-credential");
    expect(
      await as(() => service.findCreatedConnection({ operationId: "first" })),
    ).toEqual(first);
    expect(await as(() => api().create(input("first")))).toEqual(first);
    await expect(
      as(() => service.create(input("first", "changed-source-credential"))),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await artifacts()).toEqual([2, 2, 2]);
    const rows = await db.query("SELECT encrypted_value FROM app_secrets");
    expect(JSON.stringify(rows.rows)).not.toContain(VALUE);
    expect(
      JSON.stringify(
        await as(() => getWorkspaceConnection(first.connectionId)),
      ),
    ).not.toContain(VALUE);
  });
  it("requires current manager to create or look up, and current member in the exact org to read", async () => {
    const service = api(),
      created = await as(() => service.create(input()));
    await expect(
      as(() => service.create(input("member-operation")), MEMBER),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      as(
        () =>
          service.findCreatedConnection({ operationId: input().operationId }),
        MEMBER,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      read(created.connectionId, OTHER, "foreign-org"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(read(created.connectionId, OTHER)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      readWorkspaceCredential({
        appId: APP,
        connectionId: created.connectionId,
        provider: provider.id,
        key: KEY,
        requestContext: undefined,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await read(created.connectionId)).toBe(VALUE);
  });
  it("publishes nothing while validation is pending or rejected, and never retains raw provider errors", async () => {
    const entered = barrier(),
      release = barrier();
    const service = api(async () => {
      entered.resolve();
      await release.promise;
      throw new Error(VALUE);
    });
    const outcome = as(() => service.create(input())).catch((error) => error);
    await entered.promise;
    try {
      expect(await artifacts()).toEqual([0, 0, 0]);
      expect(
        await as(() =>
          service.findCreatedConnection({ operationId: input().operationId }),
        ),
      ).toBeNull();
    } finally {
      release.resolve();
    }
    const error = await outcome;
    expect(error).toMatchObject({ code: "validation_failed" });
    expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain(VALUE);
    expect(await artifacts()).toEqual([0, 0, 0]);
  });
  it("uses an immutable normalized validator snapshot and rejects unexpected callback output", async () => {
    let seen:
      | Parameters<WorkspaceCredentialServiceOptions["validateCredentials"]>[0]
      | undefined;
    const service = api(async (value) => {
      seen = value;
    });
    await as(() =>
      service.create({
        ...input(),
        secretValues: [{ key: ` ${KEY} `, secret: ` ${VALUE} ` }],
      }),
    );
    expect(seen?.config).toEqual({ project: "default-project" });
    expect(seen?.secretValues).toEqual([{ key: KEY, secret: VALUE }]);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(Object.isFrozen(seen?.config)).toBe(true);
    expect(Object.isFrozen(seen?.secretValues[0])).toBe(true);
    const unexpected = api(async () => true as never);
    await expect(
      as(() => unexpected.create(input("unexpected"))),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(await artifacts()).toEqual([1, 1, 1]);
  });
  it("rejects manager demotion during provider validation without publishing artifacts", async () => {
    const service = api(async () => {
      await db.query("UPDATE org_members SET role = 'member' WHERE email = ?", [
        OWNER,
      ]);
    });
    await expect(as(() => service.create(input()))).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await artifacts()).toEqual([0, 0, 0]);
  });
  it("bounds a hung validator and prevents late completion from publishing", async () => {
    const gate = barrier();
    let signal: AbortSignal | undefined;
    const service = api(async (value) => {
      signal = value.signal;
      await gate.promise;
    }, 10);
    try {
      await expect(as(() => service.create(input()))).rejects.toMatchObject({
        code: "validation_failed",
      });
      expect(signal?.aborted).toBe(true);
    } finally {
      gate.resolve();
    }
    await Promise.resolve();
    expect(await artifacts()).toEqual([0, 0, 0]);
  });
  it("requires the explicit app grant even if allowedApps still contains the app", async () => {
    const created = await as(() => api().create(input()));
    await as(() => revokeWorkspaceConnectionGrant(created.connectionId, APP));
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("refuses disabled sources, foreign keys and mixed profiles without legacy fallback", async () => {
    const created = await as(() => api().create(input()));
    await expect(
      readWorkspaceCredential({
        appId: APP,
        connectionId: created.connectionId,
        provider: provider.id,
        key: "OTHER_CREDENTIAL",
        requestContext: context(MEMBER),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await as(() =>
      upsertWorkspaceConnection({
        id: created.connectionId,
        provider: provider.id,
        status: "disabled",
      }),
    );
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
    await as(() =>
      upsertWorkspaceConnection({
        id: created.connectionId,
        provider: provider.id,
        status: "connected",
        credentialRefs: [
          { key: KEY, provider: provider.id, scope: "user", ref: "connection" },
        ],
      }),
    );
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("withholds a decrypted value when membership is removed during the vault read", async () => {
    const created = await as(() => api().create(input()));
    const actual = secretStore.readAppSecret;
    vi.spyOn(secretStore, "readAppSecret").mockImplementation(async (args) => {
      const value = await actual(args);
      await db.query("DELETE FROM org_members WHERE email = ?", [MEMBER]);
      return value;
    });
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("withholds a decrypted value when the explicit app grant is revoked during the vault read", async () => {
    const created = await as(() => api().create(input()));
    const actual = secretStore.readAppSecret;
    vi.spyOn(secretStore, "readAppSecret").mockImplementation(async (args) => {
      const value = await actual(args);
      await as(() => revokeWorkspaceConnectionGrant(created.connectionId, APP));
      return value;
    });
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("reconciles a lost commit acknowledgement exactly once without duplicate sources", async () => {
    transactionMode = "lost-ack";
    const service = api(),
      created = await as(() => service.create(input()));
    expect(await artifacts()).toEqual([1, 1, 1]);
    expect(await read(created.connectionId)).toBe(VALUE);
    transactionMode = "normal";
    expect(
      await as(() =>
        service.findCreatedConnection({ operationId: input().operationId }),
      ),
    ).toEqual(created);
  });
  it("does not turn an explicit refusal into success through committed-row reconciliation", async () => {
    transactionMode = "refused-after-commit";
    await expect(as(() => api().create(input()))).rejects.toMatchObject({
      code: "refused",
    });
    expect(await artifacts()).toEqual([1, 1, 1]);
  });
  it("rolls back secrets, metadata and grants together on a failed transaction", async () => {
    transactionMode = "rollback";
    await expect(as(() => api().create(input()))).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(await artifacts()).toEqual([0, 0, 0]);
  });
  it("serializes concurrent matching and conflicting operation identities", async () => {
    const service = api();
    const matching = await as(() =>
      Promise.all([service.create(input()), service.create(input())]),
    );
    expect(matching[0]).toEqual(matching[1]);
    const conflicting = await as(() =>
      Promise.allSettled([
        service.create(input("race", "first-value")),
        service.create(input("race", "second-value")),
      ]),
    );
    expect(conflicting.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(conflicting.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await artifacts()).toEqual([2, 2, 2]);
  });
  it("refuses unknown fields, duplicate keys, identity injection and accessors without invoking them", async () => {
    const service = api(),
      getter = vi.fn(() => VALUE);
    const secret = Object.defineProperty({ key: KEY }, "secret", {
      get: getter,
      enumerable: true,
    });
    for (const invalid of [
      { ...input(), orgId: "foreign-org" },
      { ...input(), config: { unknown: "value" } },
      {
        ...input(),
        secretValues: [...input().secretValues, ...input().secretValues],
      },
      { ...input(), secretValues: [secret] },
    ]) {
      await expect(
        as(() => service.create(invalid as ReturnType<typeof input>)),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(getter).not.toHaveBeenCalled();
    expect(await artifacts()).toEqual([0, 0, 0]);
  });
  it("resolves through the public explicit resolver with workspace provenance, never ambient defaults or forged identity", async () => {
    const created = await as(() => api().create(input()));
    const resolved = await as(
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: APP,
          provider: provider.id,
          key: KEY,
          connectionId: created.connectionId,
          recordUsage: false,
        }),
      MEMBER,
    );
    expect(resolved).toMatchObject({
      available: true,
      value: VALUE,
      provenance: {
        connectionId: created.connectionId,
        secretScope: "org",
        backend: "secrets",
        credentialRef: { ref: "workspace-connection" },
      },
    });
    const ambient = await as(
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: APP,
          provider: provider.id,
          key: KEY,
          recordUsage: false,
        }),
      MEMBER,
    );
    expect(ambient.available).toBe(false);
    expect(ambient.value).toBeUndefined();
    const forged = await as(
      () =>
        resolveWorkspaceConnectionCredentialForApp({
          appId: APP,
          provider: provider.id,
          key: KEY,
          connectionId: created.connectionId,
          userEmail: OWNER,
          orgId: ORG,
          recordUsage: false,
        }),
      OTHER,
      "foreign-org",
    );
    expect(forged.available).toBe(false);
    expect(forged.value).toBeUndefined();
  });
  it("withholds an old decrypted value when source configuration changes during vault access", async () => {
    const created = await as(() => api().create(input()));
    const actual = secretStore.readAppSecret;
    vi.spyOn(secretStore, "readAppSecret").mockImplementation(async (args) => {
      const value = await actual(args);
      await as(() =>
        upsertWorkspaceConnection({
          id: created.connectionId,
          provider: provider.id,
          label: "Changed warehouse",
        }),
      );
      return value;
    });
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("does not resolve missing or unknown-marked source credentials from legacy org values", async () => {
    const created = await as(() => api().create(input()));
    await secretStore.writeAppSecret({
      key: KEY,
      value: "legacy-source-credential",
      scope: "org",
      scopeId: ORG,
    });
    await db.query("DELETE FROM app_secrets WHERE scope_id <> ?", [ORG]);
    const options = {
      appId: APP,
      provider: provider.id,
      key: KEY,
      connectionId: created.connectionId,
      recordUsage: false,
    };
    expect(
      (
        await as(
          () => resolveWorkspaceConnectionCredentialForApp(options),
          MEMBER,
        )
      ).available,
    ).toBe(false);
    await as(() =>
      upsertWorkspaceConnection({
        id: created.connectionId,
        provider: provider.id,
        credentialRefs: [
          {
            key: KEY,
            provider: provider.id,
            scope: "org",
            ref: "unknown-profile",
          },
        ],
      }),
    );
    expect(
      (
        await as(
          () => resolveWorkspaceConnectionCredentialForApp(options),
          MEMBER,
        )
      ).available,
    ).toBe(false);
  });
});
