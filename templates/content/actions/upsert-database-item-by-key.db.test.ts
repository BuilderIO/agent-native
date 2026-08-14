import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { documentsPositionScope, withPositionLock } from "./_position-utils.js";

// guard:allow-unscoped — isolated SQLite fixtures intentionally inspect rows directly.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-row-mutations-${process.pid}-${Date.now()}.sqlite`,
);
const TEST_DATABASE_URL =
  process.env.CONTENT_ROW_MUTATION_POSTGRES_URL ?? `file:${TEST_DB_PATH}`;
const OWNER = "owner@example.com";
const OUTSIDER = "outsider@example.com";
const COLLABORATOR = "collaborator@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let createRow: typeof import("./add-database-item.js").default;
let updateRow: typeof import("./update-database-item.js").default;
let upsertRow: typeof import("./upsert-database-item-by-key.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);
const asCollaborator = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: COLLABORATOR }, run);

beforeAll(async () => {
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    const databaseName = new URL(TEST_DATABASE_URL).pathname.toLowerCase();
    if (!databaseName.includes("test")) {
      throw new Error(
        "CONTENT_ROW_MUTATION_POSTGRES_URL must name an isolated test database.",
      );
    }
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  getDatabase = (await import("./get-content-database.js")).default;
  createRow = (await import("./add-database-item.js")).default;
  updateRow = (await import("./update-database-item.js")).default;
  upsertRow = (await import("./upsert-database-item-by-key.js")).default;
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    await runFrameworkReleaseMigrations(undefined);
  }
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  if (TEST_DATABASE_URL.startsWith("file:")) {
    for (const suffix of ["", "-shm", "-wal"])
      rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function fixture() {
  const created = await asOwner(() =>
    createDatabase.run({ title: "Reliable rows" }),
  );
  return {
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
  };
}

async function contract(databaseId: string) {
  const response = await asOwner(() => getDatabase.run({ databaseId }));
  if (!("database" in response) || !response.mutationContract)
    throw new Error("Fixture database has no mutation contract.");
  return response.mutationContract;
}

function envelope(
  discovered: Awaited<ReturnType<typeof contract>>,
  idempotencyKey: string,
) {
  return {
    target: {
      authorityScope: discovered.target.authorityScope,
      spaceId: discovered.target.spaceId,
      databaseId: discovered.target.databaseId,
      databaseDocumentId: discovered.target.databaseDocumentId,
    },
    expectedSchemaRevision: discovered.schemaRevision,
    idempotencyKey,
  };
}

async function addProperty(args: {
  databaseId: string;
  databaseDocumentId: string;
  name: string;
  type:
    | "text"
    | "number"
    | "select"
    | "multi_select"
    | "status"
    | "date"
    | "person"
    | "place"
    | "files_media"
    | "checkbox"
    | "url"
    | "email"
    | "phone"
    | "id";
  options?: any;
  naturalKey?: boolean;
}) {
  const response = await asOwner(() =>
    configureProperty.run({
      documentId: args.databaseDocumentId,
      databaseId: args.databaseId,
      name: args.name,
      type: args.type,
      options: args.options,
      naturalKey: args.naturalKey,
    }),
  );
  const property = response.properties.find(
    (candidate) => candidate.definition.name === args.name,
  );
  if (!property) throw new Error(`Property ${args.name} was not created.`);
  return property.definition.id;
}

async function shareDocument(documentId: string) {
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share-${crypto.randomUUID()}`,
      resourceId: documentId,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
}

async function revokeDocumentShare(documentId: string) {
  await getDb()
    .delete(schema.documentShares)
    .where(
      and(
        eq(schema.documentShares.resourceId, documentId),
        eq(schema.documentShares.principalType, "user"),
        eq(schema.documentShares.principalId, COLLABORATOR),
      ),
    );
}

async function waitUntilQueuedBehindPositionLock(
  scope: string,
  blocker: Promise<unknown>,
) {
  await expect
    .poll(() => {
      const locks = (
        globalThis as typeof globalThis & {
          __contentPositionLocks?: Map<string, Promise<unknown>>;
        }
      ).__contentPositionLocks;
      return locks?.get(scope) !== blocker;
    })
    .toBe(true);
}

describe("reliable Content database row mutations", () => {
  it("discovers an exact target, deterministic writable schema, and row revisions", async () => {
    const ids = await fixture();
    const textId = await addProperty({
      ...ids,
      name: "Evidence",
      type: "text",
    });
    const discovered = await contract(ids.databaseId);

    expect(discovered.target).toMatchObject({
      authorityScope: { kind: "personal", id: OWNER },
      databaseId: ids.databaseId,
      databaseDocumentId: ids.databaseDocumentId,
    });
    expect(discovered.schemaRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(discovered.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: textId,
          type: "text",
          writable: true,
          acceptedShape: "string or null",
        }),
        expect.objectContaining({ type: "blocks", writable: false }),
      ]),
    );
  });

  it("creates every supported non-Blocks value without coercion and returns one durable verified receipt", async () => {
    const ids = await fixture();
    const propertyIds = {
      text: await addProperty({ ...ids, name: "Text", type: "text" }),
      number: await addProperty({ ...ids, name: "Number", type: "number" }),
      select: await addProperty({
        ...ids,
        name: "Select",
        type: "select",
        options: {
          options: [{ id: "one", name: "One", color: "blue" }],
        },
      }),
      multi: await addProperty({
        ...ids,
        name: "Multi",
        type: "multi_select",
        options: {
          options: [
            { id: "a", name: "A", color: "blue" },
            { id: "b", name: "B", color: "green" },
          ],
        },
      }),
      status: await addProperty({ ...ids, name: "Status", type: "status" }),
      date: await addProperty({ ...ids, name: "Date", type: "date" }),
      person: await addProperty({ ...ids, name: "Person", type: "person" }),
      place: await addProperty({ ...ids, name: "Place", type: "place" }),
      files: await addProperty({
        ...ids,
        name: "Files",
        type: "files_media",
      }),
      checked: await addProperty({
        ...ids,
        name: "Checked",
        type: "checkbox",
      }),
      url: await addProperty({ ...ids, name: "URL", type: "url" }),
      email: await addProperty({ ...ids, name: "Email", type: "email" }),
      phone: await addProperty({ ...ids, name: "Phone", type: "phone" }),
    };
    const discovered = await contract(ids.databaseId);
    const result = await asOwner(() =>
      createRow.run({
        ...envelope(discovered, "create-all-types"),
        title: "Strict row",
        propertyValues: {
          [propertyIds.text]: "Evidence",
          [propertyIds.number]: 42,
          [propertyIds.select]: "One",
          [propertyIds.multi]: ["b", "A", "b"],
          [propertyIds.status]: "not-started",
          [propertyIds.date]: { start: "2026-08-10", end: "2026-08-11" },
          [propertyIds.person]: ["alice@example.com"],
          [propertyIds.place]: "Indianapolis",
          [propertyIds.files]: ["https://example.com/evidence.pdf"],
          [propertyIds.checked]: true,
          [propertyIds.url]: "https://example.com/feedback/1",
          [propertyIds.email]: "person@example.com",
          [propertyIds.phone]: "+1 555 0100",
        },
      }),
    );

    expect(result.receipt).toMatchObject({
      operation: "create",
      outcome: "created",
      target: {
        databaseId: ids.databaseId,
        databaseDocumentId: ids.databaseDocumentId,
      },
      idempotency: { key: "create-all-types", result: "applied" },
      readback: { verified: true, title: "Strict row" },
    });
    expect(result.receipt.row.rowRevision).toMatch(/^sha256:/);
    expect(result.receipt.readback.propertyValues).toMatchObject({
      [propertyIds.number]: 42,
      [propertyIds.select]: "one",
      [propertyIds.multi]: ["b", "a"],
      [propertyIds.checked]: true,
    });
    const receipts = await getDb()
      .select()
      .from(schema.contentDatabaseRowMutationReceipts)
      .where(
        eq(
          schema.contentDatabaseRowMutationReceipts.databaseId,
          ids.databaseId,
        ),
      );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      itemId: result.receipt.row.itemId,
      documentId: result.receipt.row.documentId,
      postRowRevision: result.receipt.row.rowRevision,
    });
  });

  it("fails loudly and atomically for unknown, computed, Blocks, and invalid structured values", async () => {
    const ids = await fixture();
    const numberId = await addProperty({
      ...ids,
      name: "Number",
      type: "number",
    });
    const computedId = await addProperty({
      ...ids,
      name: "Computed",
      type: "id",
    });
    const response = await asOwner(() =>
      getDatabase.run({ databaseId: ids.databaseId }),
    );
    if (!("database" in response) || !response.mutationContract)
      throw new Error("Missing mutation contract.");
    const blocksId = response.properties.find(
      (property) => property.definition.type === "blocks",
    )!.definition.id;

    for (const [key, value, code] of [
      ["missing", "value", "UNKNOWN_PROPERTY"],
      [computedId, "value", "PROPERTY_NOT_WRITABLE"],
      [blocksId, "body", "PROPERTY_NOT_WRITABLE"],
      [numberId, "42", "INVALID_PROPERTY_VALUE"],
    ] as const) {
      await expect(
        asOwner(() =>
          createRow.run({
            ...envelope(response.mutationContract!, `invalid-${key}`),
            propertyValues: { [key]: value },
          }),
        ),
      ).rejects.toMatchObject({ errorCode: code });
    }
    const rows = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, ids.databaseId));
    expect(rows).toHaveLength(0);
  });

  it("sparsely updates exact IDs, preserves body and omitted fields, and rejects stale row CAS", async () => {
    const ids = await fixture();
    const firstId = await addProperty({ ...ids, name: "First", type: "text" });
    const secondId = await addProperty({
      ...ids,
      name: "Second",
      type: "text",
    });
    const discovered = await contract(ids.databaseId);
    const created = await asOwner(() =>
      createRow.run({
        ...envelope(discovered, "sparse-create"),
        title: "Before",
        propertyValues: { [firstId]: "keep", [secondId]: "change" },
      }),
    );
    await getDb()
      .update(schema.documents)
      .set({ content: "Blocks body stays separate" })
      .where(eq(schema.documents.id, created.receipt.row.documentId));
    const refreshed = await contract(ids.databaseId);
    const updated = await asOwner(() =>
      updateRow.run({
        ...envelope(refreshed, "sparse-update"),
        itemId: created.receipt.row.itemId,
        documentId: created.receipt.row.documentId,
        expectedRowRevision: created.receipt.row.rowRevision,
        title: "After",
        propertyValues: { [secondId]: null },
      }),
    );
    expect(updated.receipt).toMatchObject({
      outcome: "updated",
      affected: { title: true, propertyIds: [secondId] },
      readback: {
        title: "After",
        propertyValues: { [firstId]: "keep", [secondId]: null },
      },
    });
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, created.receipt.row.documentId));
    expect(document.content).toBe("Blocks body stays separate");

    await expect(
      asOwner(() =>
        updateRow.run({
          ...envelope(refreshed, "stale-update"),
          itemId: created.receipt.row.itemId,
          documentId: created.receipt.row.documentId,
          expectedRowRevision: created.receipt.row.rowRevision,
          title: "Stale overwrite",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "ROW_REVISION_CONFLICT" });
  });

  it("configures one text natural key and creates, replays, then CAS-updates one stable row", async () => {
    const ids = await fixture();
    const keyPropertyId = await addProperty({
      ...ids,
      name: "Feedback ID",
      type: "text",
      naturalKey: true,
    });
    const evidenceId = await addProperty({
      ...ids,
      name: "Evidence",
      type: "text",
    });
    await expect(
      asOwner(() =>
        configureProperty.run({
          id: evidenceId,
          documentId: ids.databaseDocumentId,
          databaseId: ids.databaseId,
          name: "Evidence",
          type: "text",
          naturalKey: true,
        }),
      ),
    ).rejects.toThrow("Clear the existing database natural key");
    const discovered = await contract(ids.databaseId);
    expect(discovered.naturalKeyPropertyId).toBe(keyPropertyId);
    const input = {
      ...envelope(discovered, "feedback-upsert-1"),
      keyValue: "feedback-001",
      expectedRowRevision: null,
      title: "Feedback",
      propertyValues: { [evidenceId]: "first" },
    };
    await expect(
      asOwner(() =>
        upsertRow.run({
          ...input,
          idempotencyKey: "feedback-upsert-conflicting-key",
          propertyValues: {
            ...input.propertyValues,
            [keyPropertyId]: "feedback-002",
          },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "INVALID_PROPERTY_VALUE",
      details: { propertyId: keyPropertyId },
    });
    const [noConflictingRow] = await getDb()
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, ids.databaseId))
      .limit(1);
    expect(noConflictingRow).toBeUndefined();

    const created = await asOwner(() => upsertRow.run(input));
    await expect(
      asOwner(() =>
        upsertRow.run({
          ...input,
          propertyValues: {
            ...input.propertyValues,
            [keyPropertyId]: "feedback-002",
          },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "INVALID_PROPERTY_VALUE",
      details: { propertyId: keyPropertyId },
    });
    const replayed = await asOwner(() => upsertRow.run(input));
    expect(replayed.receipt).toMatchObject({
      outcome: "created",
      row: created.receipt.row,
      idempotency: { result: "replayed" },
    });
    await expect(
      asOwner(() => upsertRow.run({ ...input, title: "Different" })),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });

    const updated = await asOwner(() =>
      upsertRow.run({
        ...envelope(discovered, "feedback-upsert-2"),
        keyValue: "feedback-001",
        expectedRowRevision: created.receipt.row.rowRevision,
        propertyValues: { [evidenceId]: "second" },
      }),
    );
    expect(updated.receipt).toMatchObject({
      outcome: "updated",
      row: {
        itemId: created.receipt.row.itemId,
        documentId: created.receipt.row.documentId,
      },
      readback: {
        propertyValues: {
          [keyPropertyId]: "feedback-001",
          [evidenceId]: "second",
        },
      },
    });
  });

  it("replays the committed receipt after a later edit without applying the mutation again", async () => {
    const ids = await fixture();
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "replay-after-later-edit"),
      title: "Committed title",
    };
    const created = await asOwner(() => createRow.run(input));
    await getDb()
      .update(schema.documents)
      .set({ title: "Later legitimate edit" })
      .where(eq(schema.documents.id, created.receipt.row.documentId));

    const replayed = await asOwner(() => createRow.run(input));

    expect(replayed.receipt).toMatchObject({
      receiptId: created.receipt.receiptId,
      row: created.receipt.row,
      idempotency: { result: "replayed" },
      readback: { verified: true, title: "Committed title" },
    });
    const [current] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.receipt.row.documentId));
    expect(current?.title).toBe("Later legitimate edit");
    const receipts = await getDb()
      .select()
      .from(schema.contentDatabaseRowMutationReceipts)
      .where(
        and(
          eq(
            schema.contentDatabaseRowMutationReceipts.databaseId,
            ids.databaseId,
          ),
          eq(
            schema.contentDatabaseRowMutationReceipts.idempotencyKey,
            input.idempotencyKey,
          ),
        ),
      );
    expect(receipts).toHaveLength(1);
  });

  it("denies receipt replay after row access is revoked", async () => {
    const ids = await fixture();
    await shareDocument(ids.databaseDocumentId);
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "revoked-receipt-replay"),
      title: "Private receipt data",
    };
    const created = await asOwner(() => createRow.run(input));
    await expect(
      asCollaborator(() => createRow.run(input)),
    ).resolves.toMatchObject({
      receipt: { idempotency: { result: "replayed" } },
    });

    await revokeDocumentShare(created.receipt.row.documentId);

    await expect(asCollaborator(() => createRow.run(input))).rejects.toThrow();
  });

  it("rechecks exact-update row authorization after waiting for the mutation lock", async () => {
    const ids = await fixture();
    await shareDocument(ids.databaseDocumentId);
    const discovered = await contract(ids.databaseId);
    const created = await asOwner(() =>
      createRow.run({
        ...envelope(discovered, "locked-auth-create"),
        title: "Before lock",
      }),
    );
    const scope = documentsPositionScope(OWNER, ids.databaseDocumentId);
    let releaseLock!: () => void;
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = withPositionLock(scope, async () => {
      markAcquired();
      await lockGate;
    });
    await acquired;
    const pending = asCollaborator(() =>
      updateRow.run({
        ...envelope(discovered, "locked-auth-update"),
        itemId: created.receipt.row.itemId,
        documentId: created.receipt.row.documentId,
        expectedRowRevision: created.receipt.row.rowRevision,
        title: "Must not land",
      }),
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await waitUntilQueuedBehindPositionLock(scope, blocker);
    await revokeDocumentShare(created.receipt.row.documentId);
    releaseLock();

    const outcome = await pending;
    await blocker;
    expect(outcome).toHaveProperty("error");
    const [document] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.receipt.row.documentId));
    expect(document?.title).toBe("Before lock");
  });

  it("rechecks natural-key update authorization after waiting for the mutation lock", async () => {
    const ids = await fixture();
    await shareDocument(ids.databaseDocumentId);
    const keyPropertyId = await addProperty({
      ...ids,
      name: "Feedback ID",
      type: "text",
      naturalKey: true,
    });
    const discovered = await contract(ids.databaseId);
    const created = await asOwner(() =>
      upsertRow.run({
        ...envelope(discovered, "locked-upsert-create"),
        keyValue: "feedback-locked",
        expectedRowRevision: null,
        title: "Before lock",
      }),
    );
    expect(created.receipt.readback.propertyValues[keyPropertyId]).toBe(
      "feedback-locked",
    );
    const scope = documentsPositionScope(OWNER, ids.databaseDocumentId);
    let releaseLock!: () => void;
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = withPositionLock(scope, async () => {
      markAcquired();
      await lockGate;
    });
    await acquired;
    const pending = asCollaborator(() =>
      upsertRow.run({
        ...envelope(discovered, "locked-upsert-update"),
        keyValue: "feedback-locked",
        expectedRowRevision: created.receipt.row.rowRevision,
        title: "Must not land",
      }),
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await waitUntilQueuedBehindPositionLock(scope, blocker);
    await revokeDocumentShare(created.receipt.row.documentId);
    releaseLock();

    const outcome = await pending;
    await blocker;
    expect(outcome).toHaveProperty("error");
    const [document] = await getDb()
      .select({ title: schema.documents.title })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.receipt.row.documentId));
    expect(document?.title).toBe("Before lock");
  });

  it("keeps configured natural-key claims consistent across create and exact update", async () => {
    const ids = await fixture();
    const keyPropertyId = await addProperty({
      ...ids,
      name: "Feedback ID",
      type: "text",
      naturalKey: true,
    });
    const discovered = await contract(ids.databaseId);
    const created = await asOwner(() =>
      createRow.run({
        ...envelope(discovered, "natural-key-create"),
        propertyValues: { [keyPropertyId]: "feedback-created-directly" },
      }),
    );
    await expect(
      asOwner(() =>
        upsertRow.run({
          ...envelope(discovered, "natural-key-upsert-collision"),
          keyValue: "feedback-created-directly",
          expectedRowRevision: null,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "ROW_ALREADY_EXISTS" });
    await expect(
      asOwner(() =>
        updateRow.run({
          ...envelope(discovered, "natural-key-update"),
          itemId: created.receipt.row.itemId,
          documentId: created.receipt.row.documentId,
          expectedRowRevision: created.receipt.row.rowRevision,
          propertyValues: { [keyPropertyId]: "feedback-renamed" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "NATURAL_KEY_IMMUTABLE" });
  });

  it("rejects natural-key configuration when an existing value is only whitespace", async () => {
    const ids = await fixture();
    const keyPropertyId = await addProperty({
      ...ids,
      name: "Candidate key",
      type: "text",
    });
    const discovered = await contract(ids.databaseId);
    await asOwner(() =>
      createRow.run({
        ...envelope(discovered, "whitespace-key"),
        propertyValues: { [keyPropertyId]: "   " },
      }),
    );

    await expect(
      asOwner(() =>
        configureProperty.run({
          id: keyPropertyId,
          documentId: ids.databaseDocumentId,
          databaseId: ids.databaseId,
          name: "Candidate key",
          type: "text",
          naturalKey: true,
        }),
      ),
    ).rejects.toThrow("Natural key values must be non-empty strings");

    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    expect(database.naturalKeyPropertyId).toBeNull();
    const claims = await getDb()
      .select()
      .from(schema.contentDatabaseItemKeyClaims)
      .where(
        eq(schema.contentDatabaseItemKeyClaims.databaseId, ids.databaseId),
      );
    expect(claims).toHaveLength(0);
  });

  it("rejects stale schema, target mismatch, duplicate natural-key configuration, and unauthorized writes without side effects", async () => {
    const ids = await fixture();
    const keyId = await addProperty({
      ...ids,
      name: "Candidate key",
      type: "text",
    });
    const stale = await contract(ids.databaseId);
    await addProperty({ ...ids, name: "Schema drift", type: "text" });
    await expect(
      asOwner(() =>
        createRow.run({
          ...envelope(stale, "stale-schema"),
          title: "No write",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "SCHEMA_REVISION_CONFLICT" });
    const current = await contract(ids.databaseId);
    await expect(
      asOwner(() =>
        createRow.run({
          ...envelope(current, "wrong-target"),
          target: { ...envelope(current, "unused").target, spaceId: "wrong" },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "TARGET_MISMATCH" });
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        createRow.run({ ...envelope(current, "outsider"), title: "Denied" }),
      ),
    ).rejects.toThrow();

    const first = await asOwner(() =>
      createRow.run({
        ...envelope(current, "duplicate-key-1"),
        propertyValues: { [keyId]: "duplicate" },
      }),
    );
    const second = await asOwner(() =>
      createRow.run({
        ...envelope(current, "duplicate-key-2"),
        propertyValues: { [keyId]: "duplicate" },
      }),
    );
    expect(first.receipt.row.itemId).not.toBe(second.receipt.row.itemId);
    await expect(
      asOwner(() =>
        configureProperty.run({
          id: keyId,
          documentId: ids.databaseDocumentId,
          databaseId: ids.databaseId,
          name: "Candidate key",
          type: "text",
          naturalKey: true,
        }),
      ),
    ).rejects.toThrow("more than one row");
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    expect(database.naturalKeyPropertyId).toBeNull();
    const rows = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, ids.databaseId));
    expect(rows).toHaveLength(2);
    const unintended = rows.filter(
      (row: any) =>
        row.documentId !== first.receipt.row.documentId &&
        row.documentId !== second.receipt.row.documentId,
    );
    expect(unintended).toHaveLength(0);
  });

  it("serializes concurrent retries to one side effect and one receipt", async () => {
    const ids = await fixture();
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "concurrent-create"),
      title: "Exactly once",
    };
    const [first, second] = await Promise.all([
      asOwner(() => createRow.run(input)),
      asOwner(() => createRow.run(input)),
    ]);
    expect(first.receipt.row).toEqual(second.receipt.row);
    expect(
      new Set([
        first.receipt.idempotency.result,
        second.receipt.idempotency.result,
      ]),
    ).toEqual(new Set(["applied", "replayed"]));
    const rows = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, ids.databaseId));
    const receipts = await getDb()
      .select()
      .from(schema.contentDatabaseRowMutationReceipts)
      .where(
        and(
          eq(
            schema.contentDatabaseRowMutationReceipts.databaseId,
            ids.databaseId,
          ),
          eq(
            schema.contentDatabaseRowMutationReceipts.idempotencyKey,
            "concurrent-create",
          ),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(receipts).toHaveLength(1);
  });
});
