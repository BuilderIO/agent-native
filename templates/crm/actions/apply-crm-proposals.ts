import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isSafeCrmMutationFields,
  parseJsonRecord,
  requireCrmScope,
} from "./_crm-action-utils.js";

const CONDITIONAL_MUTATION_MESSAGE =
  "HubSpot did not apply this update because this connection cannot apply the expected revision atomically. Refresh the record and make this change in HubSpot.";

function updateAffectedRows(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as {
    rowsAffected?: unknown;
    rowCount?: unknown;
    count?: unknown;
    changes?: unknown;
    meta?: { changes?: unknown };
  };
  for (const count of [
    value.rowsAffected,
    value.rowCount,
    value.count,
    value.changes,
    value.meta?.changes,
  ]) {
    if (typeof count === "number") return count;
  }
  return 0;
}

export default defineAction({
  description:
    "Review one pending HubSpot provider proposal. Phase 1 records approval and fails closed because HubSpot cannot apply the expected revision atomically; make the change upstream after review.",
  schema: z.object({
    proposalId: z.string().trim().min(1).max(128),
  }),
  needsApproval: true,
  audit: {
    target: (_args, result) => {
      const response = result as {
        recordId: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-record",
        id: response.recordId,
        ownerEmail: response.ownerEmail,
        orgId: response.orgId,
        visibility: response.visibility,
      };
    },
    summary: (args) => `Reviewed CRM proposal ${args.proposalId}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    await assertAccess("crm-mutation", args.proposalId, "editor");
    const db = getDb();
    const [proposal] = await db
      .select()
      .from(schema.crmMutations)
      .where(
        and(
          eq(schema.crmMutations.id, args.proposalId),
          accessFilter(
            schema.crmMutations,
            schema.crmMutationShares,
            undefined,
            "editor",
          ),
        ),
      )
      .limit(1);
    if (!proposal) throw new Error("CRM proposal was not found.");
    if (proposal.target !== "provider" || proposal.operation !== "update") {
      throw new Error(
        "Only pending provider update proposals can be reviewed in this phase.",
      );
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `CRM proposal is ${proposal.status} and cannot be reviewed.`,
      );
    }
    if (!proposal.recordId || !proposal.connectionId) {
      throw new Error(
        "CRM proposal is missing its record or connection reference.",
      );
    }
    await assertAccess("crm-record", proposal.recordId, "editor");
    await assertAccess("crm-connection", proposal.connectionId, "editor");
    const [[record], [connection]] = await Promise.all([
      db
        .select()
        .from(schema.crmRecords)
        .where(
          and(
            eq(schema.crmRecords.id, proposal.recordId),
            accessFilter(
              schema.crmRecords,
              schema.crmRecordShares,
              undefined,
              "editor",
            ),
          ),
        )
        .limit(1),
      db
        .select()
        .from(schema.crmConnections)
        .where(
          and(
            eq(schema.crmConnections.id, proposal.connectionId),
            accessFilter(
              schema.crmConnections,
              schema.crmConnectionShares,
              undefined,
              "editor",
            ),
          ),
        )
        .limit(1),
    ]);
    if (!record || record.tombstone || !connection) {
      throw new Error(
        "CRM proposal no longer has an available record and connection.",
      );
    }
    if (connection.provider !== "hubspot") {
      throw new Error(
        "Only HubSpot provider proposals are enabled in this phase.",
      );
    }
    if (!connection.workspaceConnectionId) {
      throw new Error(
        "CRM connection is missing its workspace connection reference.",
      );
    }
    if (!proposal.expectedRemoteRevision) {
      throw new Error(
        "CRM proposal has no remote revision and must be recreated from a refreshed record.",
      );
    }
    const patch = parseJsonRecord(proposal.patchJson);
    const fields = patch.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error("CRM proposal has an invalid field patch.");
    }
    const fieldPatch = fields as Record<string, unknown>;
    if (!isSafeCrmMutationFields(fieldPatch)) {
      throw new Error("CRM proposal contains an unsafe field patch.");
    }

    const scope = requireCrmScope(ctx);
    const now = new Date().toISOString();
    const claim = await db
      .update(schema.crmMutations)
      .set({
        status: "rejected",
        approvedBy: scope.ownerEmail,
        approvedAt: now,
        error: CONDITIONAL_MUTATION_MESSAGE,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.crmMutations.id, proposal.id),
          eq(schema.crmMutations.status, "pending"),
          accessFilter(
            schema.crmMutations,
            schema.crmMutationShares,
            undefined,
            "editor",
          ),
        ),
      );
    if (updateAffectedRows(claim) !== 1) {
      throw new Error(
        "CRM proposal was already claimed by another application attempt.",
      );
    }
    return {
      proposalId: proposal.id,
      recordId: record.id,
      status: "rejected" as const,
      message: CONDITIONAL_MUTATION_MESSAGE,
      ownerEmail: record.ownerEmail,
      orgId: record.orgId,
      visibility: record.visibility,
    };
  },
});
