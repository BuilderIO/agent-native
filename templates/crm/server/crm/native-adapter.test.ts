import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NativeCrmAdapter,
  createNativeCrmAdapter,
  createNativeCrmRecord,
  nativeObjectTemplate,
  nextNativeRevision,
  resolveNativeCrmAccessScope,
} from "./native-adapter.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `native-adapter-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../db/schema.js");
let getDb: () => any;
let schema: Schema;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("native CRM contract", () => {
  it("exposes local-authoritative standard object fields", () => {
    const accounts = nativeObjectTemplate("accounts");
    expect(accounts).toMatchObject({
      provider: "native",
      kind: "account",
      custom: false,
    });
    expect(accounts.fields).toContainEqual(
      expect.objectContaining({
        name: "name",
        storagePolicy: "local-authoritative",
        createable: true,
        updateable: true,
      }),
    );
    expect(accounts.fields).toContainEqual(
      expect.objectContaining({
        name: "desiredCadenceDays",
        valueType: "number",
        storagePolicy: "local-authoritative",
      }),
    );
    expect(nativeObjectTemplate("renewals")).toMatchObject({
      provider: "native",
      kind: "custom",
      custom: true,
    });
  });

  it("uses monotonically increasing portable revisions", () => {
    expect(nextNativeRevision(undefined)).toBe("1");
    expect(nextNativeRevision("41")).toBe("42");
    expect(nextNativeRevision("not-a-number")).toBe("1");
  });

  it("uses a stable full-permission native workspace scope", () => {
    const adapter = new NativeCrmAdapter({
      id: "native-connection",
      accountId: null,
      accessScopeKey: "native:native-connection",
      accessScopeJson: JSON.stringify({
        key: "native:native-connection",
        mode: "native",
        recordVisibility: "workspace",
      }),
      ownerEmail: "owner@example.test",
      orgId: "org-42",
      visibility: "org",
    });
    expect(adapter.getAccessScope()).toEqual({
      key: "native:native-connection",
      actorId: "owner@example.test",
      mode: "native",
      objectReadable: true,
      objectCreateable: true,
      objectUpdateable: true,
      objectDeleteable: true,
      recordVisibility: "workspace",
    });
  });

  it("keeps private native connections actor-scoped", () => {
    const adapter = new NativeCrmAdapter({
      id: "private-native-connection",
      accountId: null,
      accessScopeKey: "native:private-native-connection",
      accessScopeJson: "{}",
      ownerEmail: "owner@example.test",
      orgId: null,
      visibility: "private",
    });
    expect(adapter.getAccessScope().recordVisibility).toBe("actor");
  });

  it("fails closed when a mutation addresses another connection", async () => {
    const adapter = new NativeCrmAdapter({
      id: "native-connection",
      accountId: null,
      accessScopeKey: "native:native-connection",
      accessScopeJson: "{}",
      ownerEmail: "owner@example.test",
      orgId: null,
      visibility: "private",
    });
    await expect(
      adapter.applyMutation({
        operation: "create",
        record: {
          connectionId: "other-connection",
          provider: "native",
          objectType: "accounts",
          kind: "account",
          remoteId: "acc-1",
        },
        fields: { name: "Acme" },
        idempotencyKey: "create-acc-1",
      }),
    ).resolves.toMatchObject({ status: "rejected" });
  });
});

describe("native CRM record compare-and-swap", () => {
  const OWNER = "owner@example.test";

  function testConnection(connectionId: string) {
    return {
      id: connectionId,
      accountId: null,
      accessScopeKey: `native:${connectionId}`,
      accessScopeJson: JSON.stringify({
        key: `native:${connectionId}`,
        mode: "native",
        recordVisibility: "actor",
      }),
      ownerEmail: OWNER,
      orgId: null,
      visibility: "private" as const,
    };
  }

  it("rejects a concurrent update racing against a stale revision snapshot and keeps only the winning write", async () => {
    const connectionId = `native-cas-update-${crypto.randomUUID()}`;
    const adapter = new NativeCrmAdapter(testConnection(connectionId), "human");
    const remoteId = `acc-${crypto.randomUUID()}`;
    const record = {
      connectionId,
      provider: "native" as const,
      objectType: "accounts",
      kind: "account" as const,
      remoteId,
    };

    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "create",
        record,
        fields: { name: "Acme", amount: 1 },
        idempotencyKey: `create-${remoteId}`,
      }),
    );
    expect(created.status).toBe("applied");
    const originalRevision = created.remoteRevision;
    if (typeof originalRevision !== "string")
      throw new Error("expected a revision after create");

    const [resultA, resultB] = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        Promise.all([
          adapter.applyMutation({
            operation: "update",
            record,
            fields: { amount: 111 },
            idempotencyKey: `update-a-${remoteId}`,
            expectedRemoteRevision: originalRevision,
          }),
          adapter.applyMutation({
            operation: "update",
            record,
            fields: { amount: 222 },
            idempotencyKey: `update-b-${remoteId}`,
            expectedRemoteRevision: originalRevision,
          }),
        ]),
    );

    expect(resultA.status).toBe("applied");
    expect(resultB).toMatchObject({
      status: "conflict",
      message: "Native CRM record revision changed.",
    });

    const final = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.getRecord({ record, fields: ["amount"] }),
    );
    expect(final?.fields.amount).toBe(111);
  });

  it("rejects a delete after a revision update and never tombstones the stale write", async () => {
    const connectionId = `native-cas-delete-${crypto.randomUUID()}`;
    const adapter = new NativeCrmAdapter(testConnection(connectionId), "human");
    const remoteId = `acc-${crypto.randomUUID()}`;
    const record = {
      connectionId,
      provider: "native" as const,
      objectType: "accounts",
      kind: "account" as const,
      remoteId,
    };

    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "create",
        record,
        fields: { name: "Acme", amount: 1 },
        idempotencyKey: `create-${remoteId}`,
      }),
    );
    const originalRevision = created.remoteRevision;
    if (typeof originalRevision !== "string")
      throw new Error("expected a revision after create");

    const update = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "update",
        record,
        fields: { amount: 42 },
        idempotencyKey: `update-${remoteId}`,
        expectedRemoteRevision: originalRevision,
      }),
    );
    const deletion = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "delete",
        record,
        idempotencyKey: `delete-${remoteId}`,
        expectedRemoteRevision: originalRevision,
      }),
    );

    expect(update.status).toBe("applied");
    expect(deletion).toMatchObject({
      status: "conflict",
      message: "Native CRM record revision changed.",
    });

    const final = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.getRecord({ record, fields: ["amount"] }),
    );
    expect(final?.deleted).toBe(false);
    expect(final?.fields.amount).toBe(42);
  });
});

describe("native CRM connection access tiers", () => {
  const OWNER = "owner@example.test";
  const VIEWER = "viewer@example.test";
  const ORG_ID = "crm-viewer-org";

  it("lets a viewer-shared user read a native connection and its records but not construct a mutation adapter", async () => {
    const connectionId = `native-viewer-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const created = await runWithRequestContext(
      { userEmail: OWNER, orgId: ORG_ID },
      async () => {
        const db = getDb();
        await db.insert(schema.crmConnections).values({
          id: connectionId,
          provider: "native",
          label: "Native SQL",
          mode: "native",
          status: "connected",
          selectedPipelinesJson: "[]",
          selectedObjectTypesJson: "[]",
          accessScopeKey: `native:${connectionId}`,
          accessScopeJson: JSON.stringify({
            key: `native:${connectionId}`,
            mode: "native",
            actorId: OWNER,
            recordVisibility: "actor",
          }),
          ownerEmail: OWNER,
          orgId: ORG_ID,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(schema.crmConnectionShares).values({
          id: crypto.randomUUID(),
          resourceId: connectionId,
          principalType: "user",
          principalId: VIEWER,
          role: "viewer",
          createdBy: OWNER,
          createdAt: now,
        });
        const record = await createNativeCrmRecord({
          connectionId,
          kind: "account",
          displayName: "Acme",
          fields: {},
          idempotencyKey: `create-${connectionId}`,
        });
        if (record.status !== "applied" || !record.record?.ref.localId)
          throw new Error("expected the record to be created");
        const [object] = await db
          .select({ id: schema.crmObjects.id })
          .from(schema.crmObjects)
          .where(
            and(
              eq(schema.crmObjects.connectionId, connectionId),
              eq(schema.crmObjects.objectType, "accounts"),
            ),
          )
          .limit(1);
        if (!object) throw new Error("expected the accounts object to exist");
        await db.insert(schema.crmObjectShares).values({
          id: crypto.randomUUID(),
          resourceId: object.id,
          principalType: "user",
          principalId: VIEWER,
          role: "viewer",
          createdBy: OWNER,
          createdAt: now,
        });
        await db.insert(schema.crmRecordShares).values({
          id: crypto.randomUUID(),
          resourceId: record.record.ref.localId,
          principalType: "user",
          principalId: VIEWER,
          role: "viewer",
          createdBy: OWNER,
          createdAt: now,
        });
        return record;
      },
    );
    if (created.status !== "applied" || !created.record)
      throw new Error("expected the record to be created");
    const remoteId = created.record.ref.remoteId;

    await runWithRequestContext(
      { userEmail: VIEWER, orgId: ORG_ID },
      async () => {
        const scope = await resolveNativeCrmAccessScope({
          connectionId,
          objectType: "accounts",
        });
        expect(scope).not.toBeNull();

        const adapter = await createNativeCrmAdapter({
          connectionId,
          accessTier: "viewer",
        });
        const record = await adapter.getRecord({
          record: {
            connectionId,
            provider: "native",
            objectType: "accounts",
            kind: "account",
            remoteId,
          },
          fields: ["name"],
        });
        expect(record?.displayName).toBe("Acme");

        await expect(
          createNativeCrmAdapter({ connectionId }),
        ).rejects.toThrow();
      },
    );
  });
});
