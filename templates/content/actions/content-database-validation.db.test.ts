import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializePropertyOptions } from "../shared/properties.js";
import { ContentReadinessError } from "./_content-database-validation.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-validation-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "validation-owner@example.com";
const EDITOR = "validation-editor@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let manageValidation: typeof import("./manage-content-database-validation.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let addItem: typeof import("./add-database-item.js").default;
const spaceId = "validation_space";

const ids = {
  databaseDocumentId: "validation_database_document",
  databaseId: "validation_database",
  itemDocumentId: "validation_item_document",
  itemId: "validation_item",
  statusPropertyId: "validation_status",
  briefPropertyId: "validation_brief",
  draftOptionId: "validation_draft",
  reviewOptionId: "validation_review",
};

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  manageValidation = (await import("./manage-content-database-validation.js"))
    .default;
  setProperty = (await import("./set-document-property.js")).default;
  addItem = (await import("./add-database-item.js")).default;

  const now = new Date().toISOString();
  const { systemIdsForContentSpace } = await import("./_content-spaces.js");
  const filesIds = systemIdsForContentSpace(spaceId, "files");
  await getDb()
    .insert(schema.documents)
    .values([
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
        id: ids.databaseDocumentId,
        spaceId,
        ownerEmail: OWNER,
        title: "Design asks",
        content: "",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.itemDocumentId,
        spaceId,
        ownerEmail: OWNER,
        parentId: ids.databaseDocumentId,
        title: "Homepage refresh",
        content: "",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb().insert(schema.contentDatabases).values({
    id: filesIds.databaseId,
    spaceId,
    systemRole: "files",
    ownerEmail: OWNER,
    documentId: filesIds.documentId,
    title: "Files",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabases).values({
    id: ids.databaseId,
    spaceId,
    ownerEmail: OWNER,
    documentId: ids.databaseDocumentId,
    title: "Design asks",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabaseItems).values({
    id: ids.itemId,
    ownerEmail: OWNER,
    databaseId: ids.databaseId,
    documentId: ids.itemDocumentId,
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documentPropertyDefinitions)
    .values([
      {
        id: ids.statusPropertyId,
        ownerEmail: OWNER,
        databaseId: ids.databaseId,
        name: "Status",
        type: "status",
        optionsJson: serializePropertyOptions({
          options: [
            { id: ids.draftOptionId, name: "Draft", color: "gray" },
            {
              id: ids.reviewOptionId,
              name: "Ready for review",
              color: "blue",
            },
          ],
        }),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.briefPropertyId,
        ownerEmail: OWNER,
        databaseId: ids.databaseId,
        name: "Creative brief",
        type: "text",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb()
    .insert(schema.documentPropertyValues)
    .values({
      id: "validation_status_value",
      ownerEmail: OWNER,
      documentId: ids.itemDocumentId,
      propertyId: ids.statusPropertyId,
      valueJson: JSON.stringify(ids.draftOptionId),
      createdAt: now,
      updatedAt: now,
    });
  await getDb().insert(schema.documentShares).values({
    id: "validation_editor_share",
    resourceId: ids.databaseDocumentId,
    principalType: "user",
    principalId: EDITOR,
    role: "editor",
    createdBy: OWNER,
    createdAt: now,
  });
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("Content database readiness validation", () => {
  it("allows only database admins to configure stable-ID validation", async () => {
    const validation = {
      requiredForSubmission: [ids.briefPropertyId],
      statusRequirements: [
        {
          statusPropertyId: ids.statusPropertyId,
          statusOptionId: ids.reviewOptionId,
          requiredPropertyIds: [ids.briefPropertyId],
        },
      ],
    };
    await expect(
      runWithRequestContext({ userEmail: EDITOR }, () =>
        manageValidation.run({ databaseId: ids.databaseId, validation }),
      ),
    ).rejects.toThrow();

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      manageValidation.run({ databaseId: ids.databaseId, validation }),
    );
    expect(result.validation).toEqual(validation);
  });

  it("rejects validation references outside the database", async () => {
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        manageValidation.run({
          databaseId: ids.databaseId,
          validation: {
            requiredForSubmission: ["foreign_property"],
            statusRequirements: [],
          },
        }),
      ),
    ).rejects.toThrow('Property "foreign_property" does not belong');
  });

  it("keeps ordinary item creation as an incomplete draft", async () => {
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      addItem.run({
        databaseId: ids.databaseId,
        title: "Draft without a brief",
      }),
    );
    const [created] = await getDb()
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.id, result.createdItemId));
    expect(created?.id).toBe(result.createdItemId);
    const submittedEvents = await getDb()
      .select()
      .from(schema.workflowEvents)
      .where(
        and(
          eq(schema.workflowEvents.topic, "content.database.item.submitted"),
          eq(schema.workflowEvents.subjectId, result.createdDocumentId),
        ),
      );
    expect(submittedEvents).toEqual([]);
  });

  it("emits one actor-aware submission event for a complete add", async () => {
    const result = await runWithRequestContext(
      {
        userEmail: OWNER,
        run: {
          owner: OWNER,
          threadId: "submission-thread",
          model: "test-model",
        },
      },
      () =>
        addItem.run({
          databaseId: ids.databaseId,
          title: "Complete brief",
          submissionIntent: "submitted",
          propertyValues: {
            [ids.briefPropertyId]: "All evidence is attached.",
          },
        }),
    );
    const events = await getDb()
      .select()
      .from(schema.workflowEvents)
      .where(
        and(
          eq(schema.workflowEvents.topic, "content.database.item.submitted"),
          eq(schema.workflowEvents.subjectId, result.createdDocumentId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].actorContext)).toMatchObject({
      executor: {
        kind: "agent",
        id: "submission-thread",
        model: "test-model",
      },
    });
  });

  it("blocks a configured status transition before mutation with structured evidence", async () => {
    let error: unknown;
    try {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        setProperty.run({
          documentId: ids.itemDocumentId,
          propertyId: ids.statusPropertyId,
          value: ids.reviewOptionId,
        }),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ContentReadinessError);
    expect(error).toMatchObject({
      code: "CONTENT_READINESS_REQUIRED",
      statusCode: 409,
      details: {
        phase: "status_transition",
        databaseId: ids.databaseId,
        documentId: ids.itemDocumentId,
        statusPropertyId: ids.statusPropertyId,
        statusOptionId: ids.reviewOptionId,
        missingFields: [
          { propertyId: ids.briefPropertyId, name: "Creative brief" },
        ],
      },
    });
    const [statusAfterFailure] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, ids.itemDocumentId),
          eq(schema.documentPropertyValues.propertyId, ids.statusPropertyId),
        ),
      );
    expect(statusAfterFailure.valueJson).toBe(
      JSON.stringify(ids.draftOptionId),
    );
  });

  it("allows the transition after required evidence is present", async () => {
    await runWithRequestContext({ userEmail: OWNER }, () =>
      setProperty.run({
        documentId: ids.itemDocumentId,
        propertyId: ids.briefPropertyId,
        value: "Approved copy and dimensions",
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      setProperty.run({
        documentId: ids.itemDocumentId,
        propertyId: ids.statusPropertyId,
        value: ids.reviewOptionId,
      }),
    );
    const [status] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, ids.itemDocumentId),
          eq(schema.documentPropertyValues.propertyId, ids.statusPropertyId),
        ),
      );
    expect(status.valueJson).toBe(JSON.stringify(ids.reviewOptionId));
  });
});
