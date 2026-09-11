import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { isConnectedCrmProvider } from "../server/crm/adapter.js";
import {
  resolveProviderRecordLink,
  type ProviderRecordLink,
} from "../server/crm/provider-record-link.js";
import { getDb, schema } from "../server/db/index.js";
import {
  isSafeCrmMutationFields,
  parseJsonRecord,
  requireCrmScope,
} from "./_crm-action-utils.js";

const PROVIDER_LABELS = {
  hubspot: "HubSpot",
  salesforce: "Salesforce",
} as const;

/**
 * A prepared field change. `beforeKnown` separates "the mirror holds no value
 * for this field" from "the mirrored value is empty" — collapsing them would
 * show a confident `— → Renewal` diff for a field we simply do not mirror.
 */
interface PreparedField {
  name: string;
  beforeKnown: boolean;
  before: string | number | boolean | null;
  after: unknown;
}

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

function currentMirroredValue(row: {
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
}): string | number | boolean | null {
  if (row.stringValue !== null) return row.stringValue;
  if (row.numberValue !== null) return row.numberValue;
  if (row.booleanValue !== null) return row.booleanValue;
  return row.jsonValue;
}

export default defineAction({
  description:
    "Prepare one pending HubSpot or Salesforce record change for completion upstream. Returns the exact before/after diff and a deep link to the record, and records the handoff in the proposal ledger. It never writes to the provider and never reports an upstream change as applied.",
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
    summary: (args) =>
      `Prepared CRM proposal ${args.proposalId} for upstream completion`,
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
        "Only pending provider update proposals can be prepared in this phase.",
      );
    }
    if (proposal.status !== "pending") {
      throw new Error(
        `CRM proposal is ${proposal.status} and cannot be prepared again.`,
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
    if (!isConnectedCrmProvider(connection.provider)) {
      throw new Error(
        "Only HubSpot and Salesforce provider proposals are enabled in this release.",
      );
    }
    if (!connection.workspaceConnectionId) {
      throw new Error(
        "CRM connection is missing its workspace connection reference.",
      );
    }
    // Without a revision anchor the mirrored "before" column cannot be trusted
    // to describe the record the user is about to edit by hand.
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
    const fieldNames = Object.keys(fieldPatch);

    const currentRows = fieldNames.length
      ? await db
          .select({
            fieldName: schema.crmRecordFields.fieldName,
            stringValue: schema.crmRecordFields.stringValue,
            numberValue: schema.crmRecordFields.numberValue,
            booleanValue: schema.crmRecordFields.booleanValue,
            jsonValue: schema.crmRecordFields.jsonValue,
          })
          .from(schema.crmRecordFields)
          .where(
            and(
              eq(schema.crmRecordFields.recordId, record.id),
              isNull(schema.crmRecordFields.entryId),
              isNull(schema.crmRecordFields.activeUntil),
              inArray(schema.crmRecordFields.fieldName, fieldNames),
              accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
            ),
          )
      : [];
    const currentByFieldName = new Map(
      currentRows.map((row) => [row.fieldName, row]),
    );
    const preparedFields: PreparedField[] = fieldNames.map((name) => {
      const current = currentByFieldName.get(name);
      return {
        name,
        beforeKnown: Boolean(current),
        before: current ? currentMirroredValue(current) : null,
        after: fieldPatch[name],
      };
    });

    const link: ProviderRecordLink = await resolveProviderRecordLink({
      provider: connection.provider,
      objectType: record.objectType,
      remoteId: record.remoteId,
      accountId: connection.accountId,
      workspaceConnectionId: connection.workspaceConnectionId,
    });

    const scope = requireCrmScope(ctx);
    const now = new Date().toISOString();
    // `approved` with `appliedAt` still null is the ledger's "prepared and
    // handed off, never written upstream" state. `error` stays null so a
    // working handoff is never mistaken for a failure.
    const claim = await db
      .update(schema.crmMutations)
      .set({
        status: "approved",
        approvedBy: scope.ownerEmail,
        approvedAt: now,
        error: null,
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
        "CRM proposal was already claimed by another preparation attempt.",
      );
    }

    const providerLabel = PROVIDER_LABELS[connection.provider];
    return {
      proposalId: proposal.id,
      recordId: record.id,
      recordName: record.displayName,
      status: "approved" as const,
      /** This release never completes a provider write. Always false. */
      upstreamApplied: false,
      provider: connection.provider,
      providerLabel,
      preparedAt: now,
      fields: preparedFields,
      recordUrl: link.available ? link.url : null,
      recordUrlUnavailableReason: link.available ? null : link.reason,
      guidance: link.available
        ? `Reviewed and ready. Open the record in ${providerLabel} and make this change there — CRM has not written it upstream.`
        : `Reviewed and ready. CRM could not build a ${providerLabel} record link (${link.reason}); find the record in ${providerLabel} and make this change there. CRM has not written it upstream.`,
      ownerEmail: record.ownerEmail,
      orgId: record.orgId,
      visibility: record.visibility,
    };
  },
});
