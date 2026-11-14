import { ActionContractError } from "@agent-native/core";
import { defineAction, fail } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import { assertAccess, currentAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isFreezeRuleKeyType } from "../shared/column-rules.js";
import {
  isPrimaryBlocksField,
  parsePropertyOptions,
  serializePropertyOptions,
} from "../shared/properties.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { isAgentCall } from "./_document-agent-lock.js";
import { getDatabaseById } from "./_property-utils.js";

function invalid(message: string) {
  return new ActionContractError(message, {
    errorCode: "INVALID_COLUMN_RULE",
    statusCode: 400,
  });
}

export default defineAction({
  description:
    "Freeze one tab of a Content collection while a row's status or select column has one of the chosen values, or clear that rule. A frozen tab refuses every save, from people and agents alike. Only a person with full access to the collection can change it, from the tab's menu.",
  schema: z.object({
    databaseId: z.string().describe("Collection ID"),
    propertyId: z
      .string()
      .describe("The tab's Blocks field ID; the page body can't be frozen"),
    rule: z
      .object({
        propertyId: z
          .string()
          .describe("The status or select column the freeze keys on"),
        optionIds: z
          .array(z.string().min(1))
          .min(1)
          .describe("The column's option IDs that freeze the tab"),
      })
      .nullable()
      .describe("The rule, or null to clear it"),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    databaseId: z.string(),
    propertyId: z.string(),
    rule: z
      .object({ propertyId: z.string(), optionIds: z.array(z.string()) })
      .nullable(),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  // A rule holds agents to it, so an agent can't add or lift one.
  authorize: (_args, ctx) => ctx?.caller === "frontend" && !isAgentCall(ctx),
  run: async ({ databaseId, propertyId, rule }) => {
    const database = await getDatabaseById(databaseId);
    if (!database) {
      fail("Collection not found.", {
        errorCode: "database_not_found",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "admin");
    const optionIds = rule ? [...new Set(rule.optionIds)] : [];

    await getDb().transaction(async (tx) => {
      await lockContentDatabaseMutation(
        tx as unknown as ReturnType<typeof getDb>,
        database.id,
      );
      // The lock can be a long wait, so access is checked again.
      await assertAccess("document", database.documentId, "admin", {
        ...currentAccess(),
        transaction: getDbExec(),
      });
      const definitions = await tx
        .select()
        .from(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.databaseId, database.id));
      const field = definitions.find(
        (definition) => definition.id === propertyId,
      );
      if (!field || field.type !== "blocks") {
        throw invalid("Only a tab can be frozen.");
      }
      const fieldOptions = parsePropertyOptions(field.optionsJson);
      if (isPrimaryBlocksField(fieldOptions)) {
        throw invalid(
          "The page body can't be frozen yet. Put the text to freeze in its own tab.",
        );
      }
      if (rule) {
        const key = definitions.find(
          (definition) => definition.id === rule.propertyId,
        );
        if (!key || key.systemRole || !isFreezeRuleKeyType(key.type)) {
          throw invalid("A tab can be frozen by a status or select column.");
        }
        const known = new Set(
          (parsePropertyOptions(key.optionsJson).options ?? []).map(
            (option) => option.id,
          ),
        );
        if (optionIds.some((id) => !known.has(id))) {
          throw invalid(`${key.name} has no such option.`);
        }
      }
      await tx
        .update(schema.documentPropertyDefinitions)
        .set({
          optionsJson: serializePropertyOptions({
            ...fieldOptions,
            blocks: {
              primary: false,
              ...(rule
                ? { freezeWhen: { propertyId: rule.propertyId, optionIds } }
                : {}),
            },
          }),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.documentPropertyDefinitions.id, propertyId),
            eq(schema.documentPropertyDefinitions.databaseId, database.id),
          ),
        );
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ok: true as const,
      databaseId: database.id,
      propertyId,
      rule: rule ? { propertyId: rule.propertyId, optionIds } : null,
    };
  },
});
