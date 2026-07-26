import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";
import {
  CrmListError,
  crmApiSlug,
  uniqueCrmListSlug,
} from "./_crm-list-utils.js";

/**
 * A new list is useless without somewhere to move entries to, so it is seeded
 * with a `status` attribute. It lives on the list, not on the record: two
 * entries for the same account can sit in different stages.
 */
const DEFAULT_STAGE_OPTIONS = [
  { value: "new", title: "New" },
  { value: "in-progress", title: "In Progress" },
  { value: "won", title: "Won", celebrate: true },
  { value: "lost", title: "Lost" },
] as const;

async function resolveConnectionId(
  db: ReturnType<typeof getDb>,
  connectionId: string | undefined,
): Promise<string> {
  const rows = await db
    .select({ id: schema.crmConnections.id })
    .from(schema.crmConnections)
    .where(
      and(
        ...(connectionId ? [eq(schema.crmConnections.id, connectionId)] : []),
        accessFilter(
          schema.crmConnections,
          schema.crmConnectionShares,
          undefined,
          "editor",
        ),
      ),
    )
    .limit(connectionId ? 1 : 2);
  if (!rows.length) {
    throw new CrmListError(
      "crm-connection-unavailable",
      connectionId
        ? "The selected CRM connection is unavailable or you do not have editor access."
        : "Configure a CRM before creating a list.",
    );
  }
  if (!connectionId && rows.length > 1) {
    throw new CrmListError(
      "crm-connection-ambiguous",
      "More than one CRM connection is available. Provide connectionId to choose one.",
    );
  }
  return rows[0]!.id;
}

export default defineAction({
  description:
    "Create a CRM list — a workflow overlay over one object type, with its own entry attributes. Lists and their entries are local-authoritative on every backend, including HubSpot and Salesforce, so a pipeline never needs a provider write. Seeds a Stage attribute unless seedStageAttribute is false.",
  schema: z.object({
    connectionId: z.string().trim().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(120),
    parentObjectType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        "Object type whose records may be added, e.g. accounts, people, opportunities.",
      ),
    description: z.string().trim().max(500).optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    seedStageAttribute: z.boolean().default(true),
  }),
  audit: {
    target: (_args, result) => {
      const list = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-list",
        id: list.id,
        ownerEmail: list.ownerEmail,
        orgId: list.orgId,
        visibility: list.visibility,
      };
    },
    summary: (args) => `Created CRM list ${args.name}`,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    const db = getDb();
    const connectionId = await resolveConnectionId(db, args.connectionId);
    const apiSlug = await uniqueCrmListSlug(
      db,
      connectionId,
      crmApiSlug(args.name),
    );
    const listId = crypto.randomUUID();
    const now = new Date().toISOString();

    const stageAttributeId = args.seedStageAttribute
      ? crypto.randomUUID()
      : null;

    await db.transaction(async (tx) => {
      await tx.insert(schema.crmLists).values({
        id: listId,
        connectionId,
        name: args.name,
        apiSlug,
        parentObjectType: args.parentObjectType,
        description: args.description ?? "",
        defaultViewId: null,
        archived: false,
        position: args.position ?? 0,
        source: "local",
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });

      if (!stageAttributeId) return;

      await tx.insert(schema.crmFieldPolicies).values({
        id: stageAttributeId,
        connectionId,
        // `object_type` mirrors `target_id` for list attributes so the legacy
        // (connection_id, object_type, field_name) unique index keeps working.
        objectType: listId,
        fieldName: "stage",
        label: "Stage",
        valueType: "enum",
        storagePolicy: "local-authoritative",
        sensitive: false,
        readable: true,
        createable: true,
        updateable: true,
        required: false,
        attributeType: "status",
        target: "list",
        targetId: listId,
        apiSlug: "stage",
        multi: false,
        authority: "local-authoritative",
        historyTracked: true,
        uniqueValue: false,
        archived: false,
        position: 0,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(schema.crmAttributeOptions).values(
        DEFAULT_STAGE_OPTIONS.map((option, index) => ({
          id: crypto.randomUUID(),
          attributeId: stageAttributeId,
          value: option.value,
          title: option.title,
          position: index,
          archived: false,
          celebrate: "celebrate" in option ? option.celebrate : false,
          ...ownership,
          createdAt: now,
          updatedAt: now,
        })),
      );
    });

    const [list] = await db
      .select()
      .from(schema.crmLists)
      .where(
        and(
          eq(schema.crmLists.id, listId),
          accessFilter(schema.crmLists, schema.crmListShares),
        ),
      )
      .limit(1);
    if (!list) {
      throw new Error("CRM list could not be verified after creation.");
    }
    return { ...list, stageAttributeId };
  },
});
