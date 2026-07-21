import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createHubSpotCrmAdapter } from "../server/crm/hubspot-adapter.js";
import { getDb, schema } from "../server/db/index.js";
import type { CrmValue } from "../shared/crm-contract.js";
import {
  isSafeCrmMutationFields,
  parseJsonRecord,
  requireCrmScope,
} from "./_crm-action-utils.js";

function providerMutationMessage(status: "failed" | "conflict" | "rejected") {
  if (status === "conflict") return "CRM provider revision conflict.";
  if (status === "rejected") return "CRM provider rejected the mutation.";
  return "CRM provider mutation could not be completed.";
}

function updateAffectedRows(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const value = result as {
    rowsAffected?: unknown;
    rowCount?: unknown;
    changes?: unknown;
    meta?: { changes?: unknown };
  };
  for (const count of [
    value.rowsAffected,
    value.rowCount,
    value.changes,
    value.meta?.changes,
  ]) {
    if (typeof count === "number") return count;
  }
  return 0;
}

export default defineAction({
  description:
    "Apply one approved CRM provider mutation proposal. This deliberately accepts one proposal because the phase-one adapter exposes one logical mutation at a time; provider batch transport can be added without changing proposal semantics.",
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
    summary: (args) => `Applied CRM proposal ${args.proposalId}`,
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
        "Only pending provider update proposals can be applied in this phase.",
      );
    }
    if (proposal.status !== "pending") {
      throw new Error(
        proposal.status === "executing"
          ? "CRM proposal is already being applied."
          : `CRM proposal is ${proposal.status} and cannot be applied.`,
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
        status: "executing",
        approvedBy: scope.ownerEmail,
        approvedAt: now,
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

    let result: Awaited<
      ReturnType<
        Awaited<ReturnType<typeof createHubSpotCrmAdapter>>["applyMutation"]
      >
    >;
    try {
      const adapter = await createHubSpotCrmAdapter({
        connectionId: connection.workspaceConnectionId,
        userEmail: scope.ownerEmail,
        orgId: scope.orgId,
      });
      result = await adapter.applyMutation({
        operation: "update",
        record: {
          ...adapter.connection,
          objectType: record.objectType,
          kind: record.kind,
          remoteId: record.remoteId,
          localId: record.id,
        },
        fields: fieldPatch as Record<string, CrmValue>,
        expectedRemoteRevision: proposal.expectedRemoteRevision ?? undefined,
        idempotencyKey: proposal.idempotencyKey,
      });
    } catch (error) {
      const message = providerMutationMessage("failed");
      await db
        .update(schema.crmMutations)
        .set({
          status: "failed",
          error: message.slice(0, 1_000),
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.crmMutations.id, proposal.id),
            eq(schema.crmMutations.status, "executing"),
            accessFilter(
              schema.crmMutations,
              schema.crmMutationShares,
              undefined,
              "editor",
            ),
          ),
        );
      return {
        proposalId: proposal.id,
        recordId: record.id,
        status: "failed" as const,
        message,
        ownerEmail: record.ownerEmail,
        orgId: record.orgId,
        visibility: record.visibility,
      };
    }

    const status =
      result.status === "applied"
        ? "applied"
        : result.status === "conflict"
          ? "conflict"
          : "rejected";
    const remoteRevision =
      result.status === "rejected" ? undefined : result.remoteRevision;
    const appliedAt = status === "applied" ? new Date().toISOString() : null;
    const message =
      status === "applied" ? undefined : providerMutationMessage(status);
    await db
      .update(schema.crmMutations)
      .set({
        status,
        providerRemoteRevision: remoteRevision ?? null,
        ...(status === "applied" ? { appliedAt } : {}),
        ...(message ? { error: message } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.crmMutations.id, proposal.id),
          eq(schema.crmMutations.status, "executing"),
          accessFilter(
            schema.crmMutations,
            schema.crmMutationShares,
            undefined,
            "editor",
          ),
        ),
      );
    return {
      proposalId: proposal.id,
      recordId: record.id,
      status,
      remoteRevision,
      message,
      ownerEmail: record.ownerEmail,
      orgId: record.orgId,
      visibility: record.visibility,
    };
  },
});
