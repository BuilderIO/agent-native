import { defineAction } from "@agent-native/core";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireContentDatabaseOwner } from "./_content-database-hooks.js";
import { CONTENT_DEFAULT_PERSON_POLICY_KEY } from "./_content-default-person-rule.js";
import { allocateContentWorkflowEventSequence } from "./_content-workflow.js";
import {
  nanoid,
  parseDatabaseViewConfig,
  serializeDatabaseViewConfig,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Update owner-only Content database policies for schema locking and default Person notifications.",
  schema: z
    .object({
      databaseId: z.string().min(1),
      schemaLocked: z.boolean().optional(),
      defaultPersonNotificationsEnabled: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.schemaLocked !== undefined ||
        value.defaultPersonNotificationsEnabled !== undefined,
      { message: "At least one database policy must be provided." },
    ),
  run: async ({
    databaseId,
    schemaLocked,
    defaultPersonNotificationsEnabled,
  }) => {
    const database = await requireContentDatabaseOwner(databaseId);
    const viewConfig = parseDatabaseViewConfig(database.viewConfigJson);
    const defaultPersonPolicyChanged =
      defaultPersonNotificationsEnabled !== undefined &&
      defaultPersonNotificationsEnabled !==
        viewConfig.defaultPersonNotificationsEnabled;
    const now = new Date().toISOString();
    const next = await getDb().transaction(async (tx) => {
      let nextPolicyVersion =
        viewConfig.defaultPersonNotificationsPolicyVersion ?? 1;
      if (
        defaultPersonPolicyChanged &&
        defaultPersonNotificationsEnabled !== undefined
      ) {
        const [latestPolicy] = await tx
          .select({ version: schema.contentDatabasePolicies.version })
          .from(schema.contentDatabasePolicies)
          .where(
            and(
              eq(schema.contentDatabasePolicies.databaseId, databaseId),
              eq(
                schema.contentDatabasePolicies.policyKey,
                CONTENT_DEFAULT_PERSON_POLICY_KEY,
              ),
            ),
          )
          .orderBy(desc(schema.contentDatabasePolicies.version))
          .limit(1);
        nextPolicyVersion = (latestPolicy?.version ?? 1) + 1;
        const activeAfterSequence =
          await allocateContentWorkflowEventSequence(tx);
        await tx.insert(schema.contentDatabasePolicies).values({
          id: nanoid(),
          databaseId,
          policyKey: CONTENT_DEFAULT_PERSON_POLICY_KEY,
          version: nextPolicyVersion,
          enabled: defaultPersonNotificationsEnabled,
          activeAfterSequence,
          ownerEmail: database.ownerEmail,
          orgId: database.orgId ?? "",
          createdAt: now,
        });
      }
      const serialized = serializeDatabaseViewConfig({
        ...viewConfig,
        ...(schemaLocked === undefined ? {} : { schemaLocked }),
        ...(defaultPersonNotificationsEnabled === undefined
          ? {}
          : { defaultPersonNotificationsEnabled }),
        defaultPersonNotificationsPolicyVersion: nextPolicyVersion,
      });
      await tx
        .update(schema.contentDatabases)
        .set({ viewConfigJson: serialized, updatedAt: now })
        .where(eq(schema.contentDatabases.id, databaseId));
      return serialized;
    });
    const [saved] = await getDb()
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, databaseId));
    if (!saved || saved.viewConfigJson !== next) {
      throw new Error("Database lock policy could not be verified.");
    }
    const savedConfig = parseDatabaseViewConfig(saved.viewConfigJson);
    return {
      databaseId,
      schemaLocked: savedConfig.schemaLocked === true,
      defaultPersonNotificationsEnabled:
        savedConfig.defaultPersonNotificationsEnabled !== false,
      defaultPersonNotificationsPolicyVersion:
        savedConfig.defaultPersonNotificationsPolicyVersion ?? 1,
    };
  },
});
