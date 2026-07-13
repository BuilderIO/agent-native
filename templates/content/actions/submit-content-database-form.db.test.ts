import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializePropertyOptions } from "../shared/properties.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-form-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "form-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let submitForm: typeof import("./submit-content-database-form.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  submitForm = (await import("./submit-content-database-form.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function seedFormDatabase() {
  const db = getDb();
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 9);
  const databaseId = `form_database_${suffix}`;
  const databaseDocumentId = `form_database_document_${suffix}`;
  const primaryBlocksId = `description_${suffix}`;
  const additionalBlocksId = `notes_${suffix}`;
  const priorityId = `priority_${suffix}`;
  const deadlineId = `deadline_${suffix}`;
  const requesterId = `requester_${suffix}`;
  await db.insert(schema.documents).values({
    id: databaseDocumentId,
    ownerEmail: OWNER,
    title: "Design asks",
    content: "",
    visibility: "org",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail: OWNER,
    documentId: databaseDocumentId,
    title: "Design asks",
    primaryBlocksPropertyId: primaryBlocksId,
    blocksSeeded: 1,
    viewConfigJson: JSON.stringify({
      activeViewId: "request-form",
      views: [
        {
          id: "request-form",
          name: "Request design",
          type: "form",
          formQuestions: [
            { key: "name", enabled: true, required: true },
            { key: primaryBlocksId, enabled: true, required: true },
            { key: priorityId, enabled: true, required: true },
            { key: deadlineId, enabled: true, required: false },
            { key: requesterId, enabled: true, required: false },
            { key: additionalBlocksId, enabled: true, required: false },
          ],
        },
      ],
    }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values([
    {
      id: primaryBlocksId,
      ownerEmail: OWNER,
      databaseId,
      name: "Description",
      type: "blocks",
      optionsJson: serializePropertyOptions({ blocks: { primary: true } }),
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: priorityId,
      ownerEmail: OWNER,
      databaseId,
      name: "Priority",
      type: "select",
      optionsJson: serializePropertyOptions({
        options: [
          { id: "p0", name: "P0 — Urgent", color: "red" },
          { id: "p1", name: "P1 — High", color: "orange" },
        ],
      }),
      position: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: deadlineId,
      ownerEmail: OWNER,
      databaseId,
      name: "Deadline",
      type: "date",
      position: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: additionalBlocksId,
      ownerEmail: OWNER,
      databaseId,
      name: "Internal notes",
      type: "blocks",
      optionsJson: serializePropertyOptions({ blocks: { primary: false } }),
      position: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: requesterId,
      ownerEmail: OWNER,
      databaseId,
      name: "Requester",
      type: "person",
      position: 4,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return {
    databaseId,
    databaseDocumentId,
    primaryBlocksId,
    additionalBlocksId,
    priorityId,
    deadlineId,
    requesterId,
  };
}

describe("submit-content-database-form", () => {
  it("atomically writes title, primary/additional Blocks, safe options, and an exact link", async () => {
    const seeded = await seedFormDatabase();
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitForm.run({
        databaseId: seeded.databaseId,
        viewId: "request-form",
        title: "Refresh the pricing page",
        propertyValues: {
          Description: "Clarify the enterprise story and update the hero.",
          Priority: "P1 — High",
          [seeded.deadlineId]: "2026-08-15",
          Requester: "requester@example.com\npartner@example.com",
          "Internal notes": "Route through the web design queue.",
        },
      }),
    );

    expect(result).toMatchObject({
      databaseId: seeded.databaseId,
      viewId: "request-form",
      verified: true,
      urlPath: `/page/${result.createdDocumentId}`,
    });
    expect(result.deepLink).toContain(result.createdDocumentId);

    const db = getDb();
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId));
    expect(document).toMatchObject({
      title: "Refresh the pricing page",
      content: "Clarify the enterprise story and update the hero.",
      visibility: "org",
    });

    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        eq(schema.documentPropertyValues.documentId, result.createdDocumentId),
      );
    expect(
      values.find((value) => value.propertyId === seeded.priorityId)?.valueJson,
    ).toBe('"p1"');
    expect(
      values.find((value) => value.propertyId === seeded.deadlineId)?.valueJson,
    ).toContain("2026-08-15");
    expect(
      values.find((value) => value.propertyId === seeded.requesterId)
        ?.valueJson,
    ).toBe('["requester@example.com","partner@example.com"]');

    const [notes] = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(
            schema.documentBlockFieldContents.documentId,
            result.createdDocumentId,
          ),
          eq(
            schema.documentBlockFieldContents.propertyId,
            seeded.additionalBlocksId,
          ),
        ),
      );
    expect(notes.content).toBe("Route through the web design queue.");
  });

  it("rejects missing required questions without creating a partial row", async () => {
    const seeded = await seedFormDatabase();
    const db = getDb();
    const before = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "Missing details",
          propertyValues: { Priority: "P1 — High" },
        }),
      ),
    ).rejects.toThrow("Description");

    const after = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(after).toHaveLength(before.length);
  });

  it("rejects unknown option labels before creating a row", async () => {
    const seeded = await seedFormDatabase();
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        submitForm.run({
          databaseId: seeded.databaseId,
          viewId: "request-form",
          title: "New illustration",
          propertyValues: {
            Description: "Create an illustration for the launch post.",
            Priority: "Extremely urgent",
          },
        }),
      ),
    ).rejects.toThrow('Unknown option "Extremely urgent"');
  });

  it("rolls back the document and item when an in-transaction property write fails", async () => {
    const seeded = await seedFormDatabase();
    const triggerName = `force_form_rollback_${Date.now()}`;
    await getDbExec().execute(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT ON document_property_values
       WHEN NEW.property_id = '${seeded.priorityId}'
       BEGIN SELECT RAISE(ABORT, 'forced form rollback'); END`,
    );
    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          submitForm.run({
            databaseId: seeded.databaseId,
            viewId: "request-form",
            title: "Rollback this row",
            propertyValues: {
              Description: "This write should be rolled back.",
              Priority: "P0 — Urgent",
            },
          }),
        ),
      ).rejects.toThrow("forced form rollback");
    } finally {
      await getDbExec().execute(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }

    const db = getDb();
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.title, "Rollback this row"));
    expect(document).toBeUndefined();
    const items = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(items).toHaveLength(0);
  });
});
