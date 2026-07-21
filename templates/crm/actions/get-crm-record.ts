import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { createHubSpotCrmAdapter } from "../server/crm/hubspot-adapter.js";
import {
  parseCrmAccessScope,
  readThroughFieldNames,
  scopesAreCompatible,
} from "../server/crm/read-through.js";
import {
  getCrmRecord,
  getCrmRecordReadContext,
  persistReadThroughRelationships,
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
    if (context.provider !== "hubspot" || !context.workspaceConnectionId) {
      throw new Error(
        "CRM provider access cannot be verified for this record.",
      );
    }
    const adapter = await createHubSpotCrmAdapter({
      connectionId: context.workspaceConnectionId,
      ...(ctx?.userEmail ? { userEmail: ctx.userEmail } : {}),
      ...(ctx?.orgId !== undefined ? { orgId: ctx.orgId } : {}),
    });
    const currentScope = adapter.getAccessScope(context.objectType);
    const storedScope = parseCrmAccessScope(context.accessScopeJson);
    if (!scopesAreCompatible(storedScope, currentScope)) {
      throw new Error(
        "CRM provider access changed; the local record is withheld until it is refreshed.",
      );
    }
    const remote = await adapter.getRecord({
      record: {
        connectionId: adapter.connection.connectionId,
        provider: "hubspot",
        objectType: context.objectType,
        kind: context.kind,
        remoteId: context.remoteId,
        localId: context.id,
      },
      fields: readThroughFieldNames(context.fieldPolicies),
    });
    if (!remote || !scopesAreCompatible(storedScope, remote.accessScope)) {
      throw new Error(
        "CRM provider access changed or the record is unavailable; the local record is withheld until it is refreshed.",
      );
    }
    const relationshipPage = await adapter.listRelationships({
      record: remote.ref,
      limit: 100,
    });
    const targetObjectTypes = Array.from(
      new Set(
        relationshipPage.relationships.map(
          (relationship) => relationship.to.objectType,
        ),
      ),
    ).slice(0, 20);
    const currentScopes = new Map(
      targetObjectTypes.map((objectType) => [
        objectType,
        adapter.getAccessScope(objectType),
      ]),
    );
    const relatedRecords = await persistReadThroughRelationships({
      context,
      relationships: relationshipPage.relationships,
      currentScopes,
    });
    const record = await getCrmRecord(recordId, {
      displayName: remote.displayName,
      fields: remote.fields,
      remoteUpdatedAt: remote.remoteUpdatedAt,
      relatedRecords,
      accessScope: currentScope,
    });
    if (record) return record;
    const error = new Error("CRM record not found") as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  },
});
