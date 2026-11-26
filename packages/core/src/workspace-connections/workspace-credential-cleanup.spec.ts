import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";
import { __resetSecretsRegistry } from "../secrets/register.js";
import {
  getRequestContext,
  runWithRequestContext,
} from "../server/request-context.js";
import { resolveWorkspaceConnectionCredentialForApp } from "./credentials.js";
import {
  getWorkspaceConnection,
  resolveWorkspaceConnectionsForApp,
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
let archiveInterference: "demote" | "identity" | undefined;
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
  archiveInterference = undefined;
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
              const value = await tx.execute(command);
              if (
                typeof command !== "string" &&
                command.sql.startsWith(
                  "UPDATE public.workspace_connections SET status",
                )
              ) {
                if (archiveInterference === "demote")
                  await tx.execute({
                    sql: "UPDATE org_members SET role = 'member' WHERE email = ?",
                    args: [OWNER],
                  });
                if (archiveInterference === "identity") {
                  const current = getRequestContext();
                  if (current) current.authUserId = "changed-auth-actor";
                }
              }
              return value;
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

describe("workspace credential operation cleanup", () => {
  it("archives only its exact created source and survives a new service without removing encrypted records", async () => {
    const service = api(),
      created = await as(() => service.create(input()));
    const neighbor = await as(() => service.create(input("neighbor")));
    const before = await db.query("SELECT * FROM app_secrets ORDER BY id");
    expect(await read(created.connectionId)).toBe(VALUE);
    expect(
      await as(() =>
        service.archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).toEqual({ archived: true });
    expect(
      await as(() =>
        api().findCreatedConnection({ operationId: input().operationId }),
      ),
    ).toBeNull();
    expect(
      (await as(() => getWorkspaceConnection(created.connectionId)))?.status,
    ).toBe("disabled");
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await read(neighbor.connectionId)).toBe(VALUE);
    const publicRead = await as(
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
    expect(publicRead.available).toBe(false);
    expect(publicRead.value).toBeUndefined();
    const active = await as(
      () =>
        resolveWorkspaceConnectionsForApp({
          appId: APP,
          provider: provider.id,
        }),
      MEMBER,
    );
    expect(active.map((row) => row.id)).toEqual([neighbor.connectionId]);
    expect(await artifacts()).toEqual([2, 2, 2]);
    expect(
      (await db.query("SELECT * FROM app_secrets ORDER BY id")).rows,
    ).toEqual(before.rows);
    expect(
      await as(() =>
        api().archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).toEqual({ archived: true });
    await expect(as(() => api().create(input()))).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("does not reach another manager's operation, member, other organization or app", async () => {
    const created = await as(() => api().create(input()));
    await db.query("INSERT INTO org_members VALUES (?, ?, 'admin', 0, NULL)", [
      ORG,
      OTHER,
    ]);
    expect(
      await as(
        () =>
          api().archiveCreatedConnection({ operationId: input().operationId }),
        OTHER,
      ),
    ).toEqual({ archived: false });
    expect(
      await as(
        () =>
          api().archiveCreatedConnection({ operationId: input().operationId }),
        OTHER,
        "foreign-org",
      ),
    ).toEqual({ archived: false });
    const otherApp = createWorkspaceCredentialService({
      appId: "another-warehouse-app",
      provider,
      validateCredentials: async () => {},
    });
    expect(
      await as(() =>
        otherApp.archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).toEqual({ archived: false });
    await expect(
      as(
        () =>
          api().archiveCreatedConnection({ operationId: input().operationId }),
        MEMBER,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await read(created.connectionId)).toBe(VALUE);
  });
  it("refuses a widened profile and leaves its status connected", async () => {
    const created = await as(() => api().create(input()));
    await as(() =>
      upsertWorkspaceConnection({
        id: created.connectionId,
        provider: provider.id,
        allowedApps: [APP, "other-app"],
      }),
    );
    await expect(
      as(() =>
        api().archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (await as(() => getWorkspaceConnection(created.connectionId)))?.status,
    ).toBe("connected");
  });
  it("rolls back its archive when the transaction fails", async () => {
    const created = await as(() => api().create(input()));
    transactionMode = "rollback";
    await expect(
      as(() =>
        api().archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).rejects.toMatchObject({ code: "storage_failed" });
    expect(await read(created.connectionId)).toBe(VALUE);
    expect(
      (await as(() => getWorkspaceConnection(created.connectionId)))?.status,
    ).toBe("connected");
  });
  it("does not reconcile or repeat after explicit refusal, even if commit happened", async () => {
    await as(() => api().create(input()));
    transactionMode = "refused-after-commit";
    await expect(
      as(() =>
        api().archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).rejects.toMatchObject({ code: "refused" });
    expect(
      await as(() =>
        api().findCreatedConnection({ operationId: input().operationId }),
      ),
    ).toBeNull();
    expect(await artifacts()).toEqual([1, 1, 1]);
  });
  it("does not reconcile an unknown commit acknowledgement or revive an archived operation", async () => {
    const created = await as(() => api().create(input()));
    transactionMode = "lost-ack";
    await expect(
      as(() =>
        api().archiveCreatedConnection({ operationId: input().operationId }),
      ),
    ).rejects.toMatchObject({ code: "storage_failed" });
    transactionMode = "normal";
    expect(
      await as(() =>
        api().findCreatedConnection({ operationId: input().operationId }),
      ),
    ).toBeNull();
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("rejects unexpected fields and accessors before invocation", async () => {
    const getter = vi.fn(() => "create-operation");
    const accessor = Object.defineProperty({}, "operationId", {
      get: getter,
      enumerable: true,
    });
    for (const value of [
      { operationId: "" },
      { operationId: "x", connectionId: "foreign" },
      accessor,
    ]) {
      await expect(
        as(() =>
          api().archiveCreatedConnection(value as { operationId: string }),
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(getter).not.toHaveBeenCalled();
    expect(await artifacts()).toEqual([0, 0, 0]);
  });
  it.each(["demote", "identity"] as const)(
    "rolls back if manager %s changes after its update",
    async (interference) => {
      const created = await as(() => api().create(input()));
      archiveInterference = interference;
      await expect(
        as(() =>
          api().archiveCreatedConnection({ operationId: input().operationId }),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      archiveInterference = undefined;
      expect(
        (await as(() => getWorkspaceConnection(created.connectionId)))?.status,
      ).toBe("connected");
      expect(await read(created.connectionId)).toBe(VALUE);
    },
  );
  it("serializes concurrent archives and blocks delayed validation replay from reviving a settled source", async () => {
    const created = await as(() => api().create(input()));
    const entered = barrier(),
      release = barrier();
    const pending = as(() =>
      api(async () => {
        entered.resolve();
        await release.promise;
      }).create(input()),
    ).catch((error) => error);
    await entered.promise;
    try {
      expect(
        await as(() =>
          Promise.all([
            api().archiveCreatedConnection({
              operationId: input().operationId,
            }),
            api().archiveCreatedConnection({
              operationId: input().operationId,
            }),
          ]),
        ),
      ).toEqual([{ archived: true }, { archived: true }]);
    } finally {
      release.resolve();
    }
    expect(await pending).toMatchObject({ code: "conflict" });
    await expect(read(created.connectionId)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await as(() =>
        api().findCreatedConnection({ operationId: input().operationId }),
      ),
    ).toBeNull();
  });
});
