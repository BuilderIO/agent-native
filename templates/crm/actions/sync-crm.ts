import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  createConnectedCrmAdapter,
  isConnectedCrmProvider,
} from "../server/crm/adapter.js";
import {
  MAX_SYNC_PAGE_SIZE,
  MAX_SYNC_PAGES,
  syncCrmMirror,
} from "../server/crm/crm-mirror.js";
import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";

const idList = z
  .array(z.string().trim().min(1).max(160))
  .min(1)
  .max(50)
  .optional();
const syncScopeSchema = z
  .object({
    pipelineIds: idList,
    ownerIds: idList,
    recordIds: idList,
    associatedRecordIds: idList,
    updatedAfter: z.string().datetime({ offset: true }).optional(),
    includeDeleted: z.boolean().default(false),
  })
  .superRefine((scope, issue) => {
    if (
      !scope.pipelineIds &&
      !scope.ownerIds &&
      !scope.recordIds &&
      !scope.associatedRecordIds &&
      !scope.updatedAfter
    ) {
      issue.addIssue({
        code: "custom",
        message:
          "A sync requires a bounded cohort selector: pipelineIds, ownerIds, recordIds, associatedRecordIds, or updatedAfter.",
      });
    }
  });

export default defineAction({
  description:
    "Thinly mirror one bounded HubSpot or Salesforce CRM object cohort. It discovers field policy first, mirrors only explicit safe fields, and returns a continuation cursor instead of claiming an exhaustive sync.",
  schema: z.object({
    connectionId: z.string().trim().min(1).max(128),
    objectType: z.string().trim().min(1).max(120),
    scope: syncScopeSchema,
    fieldAllowList: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(80)
      .optional(),
    allowCustomObject: z.boolean().default(false),
    cursor: z.string().trim().min(1).max(2_000).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_SYNC_PAGE_SIZE)
      .default(MAX_SYNC_PAGE_SIZE),
    maxPages: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_SYNC_PAGES)
      .default(MAX_SYNC_PAGES),
  }),
  audit: {
    target: (args, result) => {
      const response = result as {
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-connection",
        id: args.connectionId,
        ownerEmail: response.ownerEmail,
        orgId: response.orgId,
        visibility: response.visibility,
      };
    },
    summary: (args) => `Synced bounded CRM ${args.objectType} cohort`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    await assertAccess("crm-connection", args.connectionId, "editor");
    const db = getDb();
    const [connection] = await db
      .select()
      .from(schema.crmConnections)
      .where(
        and(
          eq(schema.crmConnections.id, args.connectionId),
          accessFilter(
            schema.crmConnections,
            schema.crmConnectionShares,
            undefined,
            "editor",
          ),
        ),
      )
      .limit(1);
    if (!connection || connection.status === "disconnected")
      throw new Error("CRM connection is unavailable.");
    if (
      !isConnectedCrmProvider(connection.provider) ||
      !connection.workspaceConnectionId
    )
      throw new Error(
        "CRM sync requires a connected HubSpot or Salesforce workspace connection.",
      );
    const ownership = requireCrmScope(ctx);
    const adapter = await createConnectedCrmAdapter({
      provider: connection.provider,
      connectionId: connection.workspaceConnectionId,
      userEmail: ownership.ownerEmail,
      orgId: ownership.orgId,
    });
    const result = await syncCrmMirror({
      connectionId: connection.id,
      objectType: args.objectType,
      scope: { objectType: args.objectType, ...args.scope },
      fieldAllowList: args.fieldAllowList,
      allowCustomObject: args.allowCustomObject,
      cursor: args.cursor,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
      ownership,
      adapter,
    });
    return {
      ...result,
      ownerEmail: ownership.ownerEmail,
      orgId: ownership.orgId,
      visibility: ownership.visibility,
    };
  },
});
