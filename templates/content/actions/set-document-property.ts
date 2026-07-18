import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  blocksStorageTarget,
  isBlocksPropertyType,
  isComputedPropertyType,
  normalizePropertyValue,
  parsePropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { assertContentStatusTransitionReady } from "./_content-database-validation.js";
import {
  appendContentWorkflowEvent,
  wakeContentWorkflowEvent,
} from "./_content-workflow.js";
import {
  listPropertiesForDocument,
  nanoid,
  normalizedValueJson,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export async function setDocumentPropertyValue(
  {
    documentId,
    propertyId,
    value,
  }: { documentId: string; propertyId: string; value: unknown },
  ctx?: ActionRunContext,
) {
  const access = await assertAccess("document", documentId, "editor");
  const document = access.resource;
  const db = getDb();
  const database = await resolvePropertyDatabaseForDocument(document);
  if (!database) throw new Error("Document is not part of a database.");

  const [definition] = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(
      and(
        eq(schema.documentPropertyDefinitions.id, propertyId),
        eq(schema.documentPropertyDefinitions.ownerEmail, document.ownerEmail),
        eq(schema.documentPropertyDefinitions.databaseId, database.id),
      ),
    );
  if (!definition) throw new Error(`Property "${propertyId}" not found`);

  const type = definition.type as DocumentPropertyType;
  if (isComputedPropertyType(type)) {
    throw new Error("Computed properties cannot be edited.");
  }

  const now = new Date().toISOString();

  // Blocks fields store rich-text content, not a property-values row. The
  // primary "Content" field writes to the document body; additional Blocks
  // fields write to their own independent store.
  if (isBlocksPropertyType(type)) {
    const normalized = normalizePropertyValue(type, value);
    const content = typeof normalized === "string" ? normalized : "";
    const target = blocksStorageTarget(
      parsePropertyOptions(definition.optionsJson),
    );
    let workflowEventId = "";
    await db.transaction(async (tx) => {
      if (target === "document_body") {
        await tx
          .update(schema.documents)
          .set({ content, updatedAt: now })
          .where(eq(schema.documents.id, documentId));
      } else {
        await tx
          .insert(schema.documentBlockFieldContents)
          .values({
            id: nanoid(),
            ownerEmail: document.ownerEmail,
            documentId,
            propertyId,
            content,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.documentBlockFieldContents.documentId,
              schema.documentBlockFieldContents.propertyId,
            ],
            set: { content, updatedAt: now },
          });
      }
      const propertySnapshot = await tx
        .select({
          propertyId: schema.documentPropertyValues.propertyId,
          valueJson: schema.documentPropertyValues.valueJson,
        })
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.documentId, documentId));
      workflowEventId = await appendContentWorkflowEvent(tx, {
        topic: "content.database.property.changed",
        subjectType: "content_database_item",
        subjectId: documentId,
        databaseId: database.id,
        documentId,
        ownerEmail: document.ownerEmail,
        orgId: database.orgId,
        occurredAt: now,
        actionContext: ctx,
        payload: {
          propertyId,
          propertyType: type,
          beforeValue: null,
          afterValue: null,
          valuesOmitted: "block_content",
          propertyValues: Object.fromEntries(
            propertySnapshot.map((row) => [
              row.propertyId,
              JSON.parse(row.valueJson),
            ]),
          ),
        },
      });
    });
    wakeContentWorkflowEvent(workflowEventId);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      documentId,
      databaseId: database.id,
      properties: await listPropertiesForDocument({
        ...document,
        content: target === "document_body" ? content : document.content,
        updatedAt: now,
      }),
    };
  }

  const valueJson = normalizedValueJson(type, value);
  if (type === "status") {
    const nextStatusOptionId = JSON.parse(valueJson) as string | null;
    await assertContentStatusTransitionReady({
      databaseId: database.id,
      documentId,
      statusPropertyId: propertyId,
      statusOptionId: nextStatusOptionId,
    });
  }
  let workflowEventId = "";
  await db.transaction(async (tx) => {
    const [existingValue] = await tx
      .select({
        id: schema.documentPropertyValues.id,
        valueJson: schema.documentPropertyValues.valueJson,
      })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      );
    if (existingValue) {
      await tx
        .update(schema.documentPropertyValues)
        .set({ valueJson, updatedAt: now })
        .where(eq(schema.documentPropertyValues.id, existingValue.id));
    } else {
      await tx.insert(schema.documentPropertyValues).values({
        id: nanoid(),
        ownerEmail: document.ownerEmail,
        documentId,
        propertyId,
        valueJson,
        createdAt: now,
        updatedAt: now,
      });
    }
    const propertySnapshot = await tx
      .select({
        propertyId: schema.documentPropertyValues.propertyId,
        valueJson: schema.documentPropertyValues.valueJson,
      })
      .from(schema.documentPropertyValues)
      .where(eq(schema.documentPropertyValues.documentId, documentId));
    workflowEventId = await appendContentWorkflowEvent(tx, {
      topic: "content.database.property.changed",
      subjectType: "content_database_item",
      subjectId: documentId,
      databaseId: database.id,
      documentId,
      ownerEmail: document.ownerEmail,
      orgId: database.orgId,
      occurredAt: now,
      actionContext: ctx,
      payload: {
        propertyId,
        propertyType: type,
        beforeValue: existingValue ? JSON.parse(existingValue.valueJson) : null,
        afterValue: JSON.parse(valueJson),
        propertyValues: Object.fromEntries(
          propertySnapshot.map((row) => [
            row.propertyId,
            JSON.parse(row.valueJson),
          ]),
        ),
      },
    });
  });
  wakeContentWorkflowEvent(workflowEventId);

  await writeAppState("refresh-signal", { ts: Date.now() });

  return {
    documentId,
    databaseId: database.id,
    properties: await listPropertiesForDocument(document),
  };
}

export default defineAction({
  description: "Set a Notion-style property value on a document.",
  schema: z.object({
    documentId: z.string().describe("Document ID (required)"),
    propertyId: z.string().describe("Property definition ID"),
    value: z.unknown().describe("Value for the property type"),
  }),
  run: setDocumentPropertyValue,
});
