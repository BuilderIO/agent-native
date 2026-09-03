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

  it("gives every seeded native field a genuine attribute type, not the text default", () => {
    const accounts = nativeObjectTemplate("accounts");
    const people = nativeObjectTemplate("people");
    const opportunities = nativeObjectTemplate("opportunities");
    const attributeTypeOf = (fields: typeof accounts.fields, name: string) =>
      fields.find((field) => field.name === name)?.attributeType;

    expect(attributeTypeOf(accounts.fields, "name")).toBe("text");
    expect(attributeTypeOf(accounts.fields, "domain")).toBe("domain");
    expect(attributeTypeOf(accounts.fields, "industry")).toBe("text");
    expect(attributeTypeOf(accounts.fields, "ownerName")).toBe("text");

    expect(attributeTypeOf(people.fields, "firstName")).toBe("text");
    expect(attributeTypeOf(people.fields, "lastName")).toBe("text");
    expect(attributeTypeOf(people.fields, "email")).toBe("email-address");
    expect(attributeTypeOf(people.fields, "title")).toBe("text");
    expect(attributeTypeOf(people.fields, "accountId")).toBe(
      "record-reference",
    );

    expect(attributeTypeOf(opportunities.fields, "name")).toBe("text");
    expect(attributeTypeOf(opportunities.fields, "amount")).toBe("currency");
    expect(attributeTypeOf(opportunities.fields, "stage")).toBe("status");
    expect(attributeTypeOf(opportunities.fields, "closeDate")).toBe("date");
    expect(attributeTypeOf(opportunities.fields, "accountId")).toBe(
      "record-reference",
    );

    for (const fields of [
      accounts.fields,
      people.fields,
      opportunities.fields,
    ]) {
      expect(attributeTypeOf(fields, "desiredCadenceDays")).toBe("number");
      expect(attributeTypeOf(fields, "lastMeaningfulInteractionAt")).toBe(
        "timestamp",
      );
      expect(attributeTypeOf(fields, "nextContactAt")).toBe("timestamp");
    }
  });

  it("gives the opportunity amount field a USD currency config and stage its default options", () => {
    const opportunities = nativeObjectTemplate("opportunities");
    const amount = opportunities.fields.find(
      (field) => field.name === "amount",
    );
    expect(amount?.config).toEqual({ currency: { code: "USD" } });

    const stage = opportunities.fields.find((field) => field.name === "stage");
    expect(stage?.options?.map((option) => option.value)).toEqual([
      "new",
      "in-progress",
      "won",
      "lost",
    ]);
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

  it("rejects a concurrent delete racing against a stale revision snapshot", async () => {
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

    const [deletionA, deletionB] = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        Promise.all([
          adapter.applyMutation({
            operation: "delete",
            record,
            idempotencyKey: `delete-a-${remoteId}`,
            expectedRemoteRevision: originalRevision,
          }),
          adapter.applyMutation({
            operation: "delete",
            record,
            idempotencyKey: `delete-b-${remoteId}`,
            expectedRemoteRevision: originalRevision,
          }),
        ]),
    );

    expect(deletionA.status).toBe("applied");
    expect(deletionB).toMatchObject({
      status: "conflict",
      message: "Native CRM record revision changed.",
    });

    const final = await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.getRecord({ record, fields: ["amount"] }),
    );
    expect(final?.deleted).toBe(true);
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

describe("native CRM typed-attribute boundary", () => {
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

  async function fieldPolicy(
    connectionId: string,
    objectType: string,
    fieldName: string,
  ) {
    const [policy] = await getDb()
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.connectionId, connectionId),
          eq(schema.crmFieldPolicies.objectType, objectType),
          eq(schema.crmFieldPolicies.fieldName, fieldName),
        ),
      )
      .limit(1);
    return policy;
  }

  it("writes local-authoritative authority and the genuine attribute type on create", async () => {
    const connectionId = `native-typed-create-${crypto.randomUUID()}`;
    const adapter = new NativeCrmAdapter(testConnection(connectionId), "human");
    const remoteId = `opp-${crypto.randomUUID()}`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "create",
        record: {
          connectionId,
          provider: "native",
          objectType: "opportunities",
          kind: "opportunity",
          remoteId,
        },
        fields: { name: "Acme deal", amount: 184000, stage: "new" },
        idempotencyKey: `create-${remoteId}`,
      }),
    );

    const amountPolicy = await fieldPolicy(
      connectionId,
      "opportunities",
      "amount",
    );
    expect(amountPolicy).toMatchObject({
      attributeType: "currency",
      authority: "local-authoritative",
    });
    expect(JSON.parse(amountPolicy!.configJson)).toEqual({
      currency: { code: "USD" },
    });

    const stagePolicy = await fieldPolicy(
      connectionId,
      "opportunities",
      "stage",
    );
    expect(stagePolicy).toMatchObject({
      attributeType: "status",
      authority: "local-authoritative",
    });
  });

  it("keeps the amount field typed currency after a later update writes it again", async () => {
    // Regression test for the merge-order bug behind the boundary fix:
    // `ensureNativeObject` rebuilds an ad hoc field definition from every
    // written field on every mutation, and before the fix that ad hoc
    // definition (inferred from the raw JS value as generic "number")
    // overwrote the template's "currency" definition on every single write —
    // so the type only looked fixed until the next update.
    const connectionId = `native-typed-update-${crypto.randomUUID()}`;
    const adapter = new NativeCrmAdapter(testConnection(connectionId), "human");
    const remoteId = `opp-${crypto.randomUUID()}`;
    const record = {
      connectionId,
      provider: "native" as const,
      objectType: "opportunities",
      kind: "opportunity" as const,
      remoteId,
    };
    await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "create",
        record,
        fields: { name: "Acme deal", amount: 184000 },
        idempotencyKey: `create-${remoteId}`,
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "update",
        record,
        fields: { amount: 200000 },
        idempotencyKey: `update-${remoteId}`,
      }),
    );

    const amountPolicy = await fieldPolicy(
      connectionId,
      "opportunities",
      "amount",
    );
    expect(amountPolicy?.attributeType).toBe("currency");
  });

  it("seeds managed options for the stage attribute so a status write does not 422", async () => {
    const connectionId = `native-typed-stage-options-${crypto.randomUUID()}`;
    const adapter = new NativeCrmAdapter(testConnection(connectionId), "human");
    const remoteId = `opp-${crypto.randomUUID()}`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      adapter.applyMutation({
        operation: "create",
        record: {
          connectionId,
          provider: "native",
          objectType: "opportunities",
          kind: "opportunity",
          remoteId,
        },
        fields: { name: "Acme deal", stage: "new" },
        idempotencyKey: `create-${remoteId}`,
      }),
    );

    const stagePolicy = await fieldPolicy(
      connectionId,
      "opportunities",
      "stage",
    );
    const options = await getDb()
      .select({ value: schema.crmAttributeOptions.value })
      .from(schema.crmAttributeOptions)
      .where(eq(schema.crmAttributeOptions.attributeId, stagePolicy!.id));
    expect(
      options.map((option: { value: string }) => option.value).sort(),
    ).toEqual(["in-progress", "lost", "new", "won"].sort());
  });

  it("does not mint a separate displayName attribute for an account, but still does for a person", async () => {
    const connectionId = `native-typed-displayname-${crypto.randomUUID()}`;
    await runWithRequestContext({ userEmail: OWNER }, async () => {
      const db = getDb();
      const now = new Date().toISOString();
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
        orgId: null,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });

      const account = await createNativeCrmRecord({
        connectionId,
        kind: "account",
        displayName: "Acme",
        fields: {},
        idempotencyKey: `create-account-${connectionId}`,
      });
      if (account.status !== "applied" || !account.record?.ref.localId) {
        throw new Error("expected the account to be created");
      }
      expect(account.record.displayName).toBe("Acme");
      const accountFieldNames = await db
        .select({ fieldName: schema.crmRecordFields.fieldName })
        .from(schema.crmRecordFields)
        .where(eq(schema.crmRecordFields.recordId, account.record.ref.localId));
      expect(
        accountFieldNames.map((f: { fieldName: string }) => f.fieldName),
      ).not.toContain("displayName");
      expect(
        accountFieldNames.map((f: { fieldName: string }) => f.fieldName),
      ).toContain("name");

      const person = await createNativeCrmRecord({
        connectionId,
        kind: "person",
        displayName: "Ada Lovelace",
        fields: {},
        idempotencyKey: `create-person-${connectionId}`,
      });
      if (person.status !== "applied" || !person.record?.ref.localId) {
        throw new Error("expected the person to be created");
      }
      expect(person.record.displayName).toBe("Ada Lovelace");
      const personFieldNames = await db
        .select({ fieldName: schema.crmRecordFields.fieldName })
        .from(schema.crmRecordFields)
        .where(eq(schema.crmRecordFields.recordId, person.record.ref.localId));
      expect(
        personFieldNames.map((f: { fieldName: string }) => f.fieldName),
      ).toContain("displayName");
    });
  });
});
