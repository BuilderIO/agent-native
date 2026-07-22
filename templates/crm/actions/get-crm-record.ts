import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  createConnectedCrmAdapter,
  isConnectedCrmProvider,
} from "../server/crm/adapter.js";
import { createNativeCrmAdapter } from "../server/crm/native-adapter.js";
import { loadVerifiedReadThroughRecord } from "../server/crm/read-through.js";
import {
  getCrmRecord,
  getCrmRecordReadContext,
  getReadThroughRelationshipSummaries,
} from "../server/db/crm-store.js";

export default defineAction({
  description:
    "Return one access-scoped CRM record with bounded mirrored fields, recent interaction metadata, call-evidence references, and tasks. It never returns raw provider payloads, media, or transcripts.",
  schema: z.object({
    recordId: z.string().min(1).describe("Local CRM record ID."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ recordId }, ctx?: ActionRunContext) => {
    const context = await getCrmRecordReadContext(recordId);
    if (!context) {
      const error = new Error("CRM record not found") as Error & {
        statusCode?: number;
      };
      error.statusCode = 404;
      throw error;
    }
    const adapter =
      context.provider === "native"
        ? await createNativeCrmAdapter({ connectionId: context.connectionId })
        : isConnectedCrmProvider(context.provider) &&
            context.workspaceConnectionId
          ? await createConnectedCrmAdapter({
              provider: context.provider,
              connectionId: context.workspaceConnectionId,
              ...(ctx?.userEmail ? { userEmail: ctx.userEmail } : {}),
              ...(ctx?.orgId !== undefined ? { orgId: ctx.orgId } : {}),
            })
          : null;
    if (!adapter) {
      throw new Error("CRM access cannot be verified for this record.");
    }
    const readThrough = await loadVerifiedReadThroughRecord({
      adapter,
      context,
    });
    const relatedRecords = await getReadThroughRelationshipSummaries({
      context,
      relationships: readThrough.relationships,
      currentScopes: readThrough.currentScopes,
    });
    const record = await getCrmRecord(recordId, {
      displayName: readThrough.remote.displayName,
      fields: readThrough.remote.fields,
      remoteRevision: readThrough.remote.remoteRevision,
      remoteUpdatedAt: readThrough.remote.remoteUpdatedAt,
      relatedRecords,
      accessScope: readThrough.currentScope,
    });
    if (record) return record;
    const error = new Error("CRM record not found") as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  },
});
