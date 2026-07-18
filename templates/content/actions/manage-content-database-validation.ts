import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireContentDatabaseOwner } from "./_content-database-hooks.js";
import { validateContentDatabaseValidationConfig } from "./_content-database-validation.js";
import {
  parseDatabaseViewConfig,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";

const validationSchema = z.object({
  requiredForSubmission: z.array(z.string().min(1)).default([]),
  statusRequirements: z
    .array(
      z.object({
        statusPropertyId: z.string().min(1),
        statusOptionId: z.string().min(1),
        requiredPropertyIds: z.array(z.string().min(1)).default([]),
      }),
    )
    .default([]),
});

export default defineAction({
  description:
    "Configure owner-managed required fields for atomic submissions and status transitions in a Content database.",
  schema: z.object({
    databaseId: z.string().min(1),
    validation: validationSchema,
  }),
  run: async ({ databaseId, validation }) => {
    const database = await requireContentDatabaseOwner(databaseId);
    await validateContentDatabaseValidationConfig(databaseId, validation);
    const viewConfig = parseDatabaseViewConfig(database.viewConfigJson);
    const nextViewConfig = {
      ...viewConfig,
      validation,
    };
    const now = new Date().toISOString();
    const serialized = serializeDatabaseViewConfig(nextViewConfig);
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: serialized,
        updatedAt: now,
      })
      .where(eq(schema.contentDatabases.id, databaseId));
    const [saved] = await getDb()
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    if (!saved || saved.viewConfigJson !== serialized) {
      throw new Error("Database validation settings could not be verified.");
    }
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      databaseId,
      validation: parseDatabaseViewConfig(saved.viewConfigJson).validation,
    };
  },
});
