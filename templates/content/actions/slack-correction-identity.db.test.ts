import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializePropertyOptions } from "../shared/properties.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `slack-correction-identity-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "slack-correction-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let submitContentDatabaseForm: typeof import("./submit-content-database-form.js").default;
let updateDocument: typeof import("./update-document.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  submitContentDatabaseForm = (
    await import("./submit-content-database-form.js")
  ).default;
  updateDocument = (await import("./update-document.js")).default;
  setDocumentProperty = (await import("./set-document-property.js")).default;

  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function seedDesignAsksDatabase() {
  const { systemIdsForContentSpace } = await import("./_content-spaces.js");
  const suffix = Math.random().toString(36).slice(2, 9);
  const spaceId = `slack_correction_space_${suffix}`;
  const databaseId = `design_asks_${suffix}`;
  const databaseDocumentId = `design_asks_document_${suffix}`;
  const priorityId = `priority_${suffix}`;
  const requesterId = `requester_${suffix}`;
  const filesIds = systemIdsForContentSpace(spaceId, "files");
  const now = new Date().toISOString();
  const db = getDb();

  await db.insert(schema.documents).values([
    {
      id: filesIds.documentId,
      spaceId,
      ownerEmail: OWNER,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: databaseDocumentId,
      spaceId,
      ownerEmail: OWNER,
      title: "Design Asks",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.contentDatabases).values([
    {
      id: filesIds.databaseId,
      spaceId,
      systemRole: "files",
      ownerEmail: OWNER,
      documentId: filesIds.documentId,
      title: "Files",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: databaseId,
      spaceId,
      ownerEmail: OWNER,
      documentId: databaseDocumentId,
      title: "Design Asks",
      viewConfigJson: JSON.stringify({
        activeViewId: "slack-request-form",
        views: [
          {
            id: "slack-request-form",
            name: "Slack request",
            type: "form",
            formQuestions: [
              { key: "name", enabled: true, required: true },
              { key: priorityId, enabled: true, required: true },
              { key: requesterId, enabled: true, required: false },
            ],
          },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.documentPropertyDefinitions).values([
    {
      id: priorityId,
      ownerEmail: OWNER,
      databaseId,
      name: "Priority",
      type: "select",
      optionsJson: serializePropertyOptions({
        options: [
          { id: "p1", name: "P1 - High", color: "orange" },
          { id: "p2", name: "P2 - Medium", color: "yellow" },
        ],
      }),
      position: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: requesterId,
      ownerEmail: OWNER,
      databaseId,
      name: "Requester",
      type: "text",
      position: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return { databaseId, databaseDocumentId, priorityId, requesterId };
}

describe("Content identity supporting Slack Design Ask corrections", () => {
  it("updates the original renamed row sparsely without minting a duplicate", async () => {
    const seeded = await seedDesignAsksDatabase();
    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      submitContentDatabaseForm.run({
        databaseId: seeded.databaseId,
        viewId: "slack-request-form",
        title: "Original Slack design ask",
        propertyValues: {
          Priority: "P2 - Medium",
          Requester: "Apoorva",
        },
      }),
    );
    const originalDocumentId = created.createdDocumentId;
    const originalItemId = created.createdItemId;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocument.run({
        id: originalDocumentId,
        title: "Human-renamed design ask",
        content: "Live design context edited after the Slack request.",
      }),
    );

    const corrected = await runWithRequestContext({ userEmail: OWNER }, () =>
      setDocumentProperty.run({
        documentId: originalDocumentId,
        databaseId: seeded.databaseId,
        propertyId: seeded.priorityId,
        value: "p1",
      }),
    );

    expect(corrected).toMatchObject({
      documentId: originalDocumentId,
      databaseId: seeded.databaseId,
    });

    const db = getDb();
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, originalDocumentId));
    expect(document).toMatchObject({
      id: originalDocumentId,
      parentId: seeded.databaseDocumentId,
      title: "Human-renamed design ask",
      content: "Live design context edited after the Slack request.",
    });

    const memberships = await db
      .select()
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, seeded.databaseId));
    expect(memberships).toEqual([
      expect.objectContaining({
        id: originalItemId,
        databaseId: seeded.databaseId,
        documentId: originalDocumentId,
      }),
    ]);

    const rowDocuments = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.parentId, seeded.databaseDocumentId));
    expect(rowDocuments).toEqual([{ id: originalDocumentId }]);

    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, originalDocumentId));
    expect(
      values.find((value) => value.propertyId === seeded.priorityId)?.valueJson,
    ).toBe('"p1"');
    expect(
      values.find((value) => value.propertyId === seeded.requesterId)
        ?.valueJson,
    ).toBe('"Apoorva"');
    expect(
      values.filter(
        (value) =>
          value.propertyId === seeded.priorityId ||
          value.propertyId === seeded.requesterId,
      ),
    ).toHaveLength(2);
  });
});
