import * as fc from "fast-check";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { checkActionProperties } from "../action-properties.js";
import type { DbExec } from "../db/client.js";
import { __resetSecretsRegistry } from "../secrets/register.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  getWorkspaceConnection,
  getWorkspaceConnectionGrant,
} from "./store.js";
import { createWorkspaceCredentialActions } from "./workspace-credential-actions.js";
import {
  createWorkspaceCredentialService,
  readWorkspaceCredential,
  readWorkspaceCredentialProfile,
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
  job: () => T | Promise<T>,
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

async function setup() {
  const service = api();
  const { connectionId } = await as(() => service.create(input()));
  const opened = await readWorkspaceCredentialProfile({
    appId: APP,
    connectionId,
    provider: provider.id,
    requestContext: context(),
  });
  expect(opened).not.toBeNull();
  return { service, connectionId, revision: opened!.revision };
}
async function persisted() {
  return Promise.all(
    ["workspace_connections", "workspace_connection_grants", "app_secrets"].map(
      (table) => db.query(`SELECT * FROM ${table} ORDER BY id`),
    ),
  );
}
it("validates and atomically edits a connection while preserving creator and grant identity", async () => {
  const { connectionId, revision } = await setup();
  await db.query("INSERT INTO org_members VALUES (?, ?, 'admin', 0, NULL)", [
    ORG,
    OTHER,
  ]);
  const before = await as(() => getWorkspaceConnectionGrant(connectionId, APP));
  const validate = vi.fn(async () => {});
  await as(
    () =>
      api(validate).update({
        connectionId,
        revision,
        name: "QA Renamed",
        config: { project: "edited" },
        secretValues: [{ key: KEY, secret: "replacement-source-credential" }],
      }),
    OTHER,
  );
  expect(validate).toHaveBeenCalledOnce();
  const row = await as(() => getWorkspaceConnection(connectionId)),
    grant = await as(() => getWorkspaceConnectionGrant(connectionId, APP));
  expect(row).toMatchObject({
    label: "QA Renamed",
    ownerEmail: OWNER,
    config: { project: "edited" },
  });
  expect(grant).toMatchObject({
    id: before!.id,
    ownerEmail: OWNER,
    grantedByEmail: OWNER,
    config: row!.config,
    credentialRefs: row!.credentialRefs,
  });
  expect(await read(connectionId)).toBe("replacement-source-credential");
}, 30000);
it("retains omitted credentials and configuration for a name-only edit", async () => {
  const { connectionId, revision, service } = await setup();
  await as(() =>
    service.update({ connectionId, revision, name: "QA Renamed" }),
  );
  expect(await read(connectionId)).toBe(VALUE);
  expect(
    (await as(() => getWorkspaceConnection(connectionId)))!.config.project,
  ).toBe("default-project");
}, 30000);
it("rejects stale edits before validation or storage", async () => {
  const { connectionId, revision, service } = await setup();
  await as(() => service.update({ connectionId, revision, name: "QA First" }));
  const before = await persisted(),
    validate = vi.fn(async () => {});
  await expect(
    as(() =>
      api(validate).update({ connectionId, revision, name: "QA Stale" }),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(validate).not.toHaveBeenCalled();
  expect(await persisted()).toEqual(before);
}, 30000);
it("rolls back vault and both metadata rows on transaction failure", async () => {
  const { connectionId, revision, service } = await setup();
  const before = await persisted();
  transactionMode = "rollback";
  await expect(
    as(() =>
      service.update({
        connectionId,
        revision,
        name: "QA Rollback",
        secretValues: [{ key: KEY, secret: "replacement-source-credential" }],
      }),
    ),
  ).rejects.toMatchObject({ code: "storage_failed" });
  expect(await persisted()).toEqual(before);
}, 30000);
it("validation failure leaves storage unchanged", async () => {
  const { connectionId, revision } = await setup();
  const before = await persisted();
  await expect(
    as(() =>
      api(async () => {
        throw Error("controlled validation");
      }).update({ connectionId, revision, name: "QA Invalid" }),
    ),
  ).rejects.toMatchObject({ code: "validation_failed" });
  expect(await persisted()).toEqual(before);
}, 30000);
for (const [email, org] of [
  [MEMBER, ORG],
  [OTHER, "foreign-org"],
])
  it(`denies unauthorized edit ${email}/${org}`, async () => {
    const { connectionId, revision, service } = await setup();
    const before = await persisted();
    await expect(
      as(
        () => service.update({ connectionId, revision, name: "QA Denied" }),
        email,
        org,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await persisted()).toEqual(before);
  }, 30000);
it("rechecks management authority after validation", async () => {
  const { connectionId, revision } = await setup();
  const before = await persisted();
  await expect(
    as(() =>
      api(async () => {
        await db.query("UPDATE org_members SET role='member' WHERE email=?", [
          OWNER,
        ]);
      }).update({ connectionId, revision, name: "QA Denied" }),
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await persisted()).toEqual(before);
}, 30000);
it("rejects a grant changed during validation", async () => {
  const { connectionId, revision } = await setup();
  await expect(
    as(() =>
      api(async () => {
        await db.query(
          "UPDATE workspace_connection_grants SET config_json='{}' WHERE connection_id=?",
          [connectionId],
        );
      }).update({ connectionId, revision, name: "QA Denied" }),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  expect((await as(() => getWorkspaceConnection(connectionId)))!.label).toBe(
    provider.label,
  );
}, 30000);

it("invalidates a secret-only edit revision even when the clock does not advance", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  const { connectionId, revision, service } = await setup();
  await as(() =>
    service.update({
      connectionId,
      revision,
      secretValues: [{ key: KEY, secret: "replacement-source-credential" }],
    }),
  );
  const before = await persisted();
  await expect(
    as(() =>
      service.update({
        connectionId,
        revision,
        secretValues: [{ key: KEY, secret: "stale-source-credential" }],
      }),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await persisted()).toEqual(before);
}, 30000);
it("refuses unsupported persisted configuration instead of silently dropping it", async () => {
  const { connectionId, service } = await setup();
  const row = await as(() => getWorkspaceConnection(connectionId));
  const config = JSON.stringify({
    ...row!.config,
    unsupportedMetadata: "retain-existing-value",
  });
  await db.query("UPDATE workspace_connections SET config_json=? WHERE id=?", [
    config,
    connectionId,
  ]);
  await db.query(
    "UPDATE workspace_connection_grants SET config_json=? WHERE connection_id=?",
    [config, connectionId],
  );
  const opened = await readWorkspaceCredentialProfile({
    appId: APP,
    connectionId,
    provider: provider.id,
    requestContext: context(),
  });
  const before = await persisted();
  await expect(
    as(() =>
      service.update({
        connectionId,
        revision: opened!.revision,
        name: "QA Unsupported",
      }),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await persisted()).toEqual(before);
}, 30000);

it("detects another request rotating the vault during validation", async () => {
  const { connectionId, revision } = await setup();
  const saved = await db.query("SELECT scope_id FROM app_secrets WHERE key=?", [
    KEY,
  ]);
  const { writeAppSecret } = await import("../secrets/storage.js");
  await expect(
    as(() =>
      api(async () => {
        await runWithRequestContext(context(), () =>
          writeAppSecret({
            key: KEY,
            value: "rotated-source-credential",
            scope: "org",
            scopeId: (saved.rows[0] as { scope_id: string }).scope_id,
          }),
        );
      }).update({ connectionId, revision, name: "QA Stale vault" }),
    ),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await read(connectionId)).toBe("rotated-source-credential");
  expect((await as(() => getWorkspaceConnection(connectionId)))!.label).toBe(
    provider.label,
  );
}, 30000);
it("reports unknown commit acknowledgement without validating or publishing again", async () => {
  const { connectionId, revision } = await setup(),
    validate = vi.fn(async () => {});
  transactionMode = "lost-ack";
  await expect(
    as(() =>
      api(validate).update({
        connectionId,
        revision,
        name: "QA Commit acknowledged later",
      }),
    ),
  ).rejects.toMatchObject({ code: "storage_failed" });
  expect(validate).toHaveBeenCalledOnce();
  expect((await as(() => getWorkspaceConnection(connectionId)))!.label).toBe(
    "QA Commit acknowledged later",
  );
}, 30000);

it("keeps native updates private and dispatches frontend validation through the action", async () => {
  const { connectionId, revision } = await setup(),
    validateCredentials = vi.fn(async () => {});
  const action = createWorkspaceCredentialActions({
    appId: APP,
    provider,
    validateCredentials,
  }).update;
  expect(action.persistInBrowser).toBe(false);
  expect(action.persistInChatHistory).toBe(false);
  expect(action.audit).toMatchObject({ recordInputs: false });
  const args = { connectionId, revision, name: "QA Private update" };
  await expect(
    as(() => action.run(args, { caller: "tool" })),
  ).rejects.toMatchObject({ errorCode: "ui_only_action" });
  expect(validateCredentials).not.toHaveBeenCalled();
  await as(() =>
    checkActionProperties(action, {
      context: { caller: "tool" },
      runs: 12,
      seed: 166,
      overrides: { "/config": fc.constant({}) },
    }),
  );
  await expect(
    as(() => action.run(args, { caller: "frontend" })),
  ).resolves.toEqual({ connectionId });
  expect(validateCredentials).toHaveBeenCalledOnce();
  expect((await as(() => getWorkspaceConnection(connectionId)))!.label).toBe(
    "QA Private update",
  );
}, 30000);
