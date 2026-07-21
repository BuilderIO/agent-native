import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { decideCrmWritePolicy, type CrmValue } from "../shared/crm-contract.js";
import {
  crmInitiatedBy,
  crmWriteRisk,
  isBoundedCrmValue,
  MAX_CRM_FIELDS_PER_MUTATION,
  toJson,
} from "./_crm-action-utils.js";

const fieldPatchSchema = z
  .record(z.string().trim().min(1).max(120), z.unknown())
  .refine(
    (fields) =>
      Object.keys(fields).length >= 1 &&
      Object.keys(fields).length <= MAX_CRM_FIELDS_PER_MUTATION,
    `Provide between 1 and ${MAX_CRM_FIELDS_PER_MUTATION} fields.`,
  )
  .refine(
    (fields) =>
      Object.values(fields).every((value) => isBoundedCrmValue(value)),
    "CRM field values must be bounded JSON values and cannot contain data URLs.",
  );

function fieldColumns(value: CrmValue) {
  if (typeof value === "string") {
    return {
      stringValue: value,
      numberValue: null,
      booleanValue: null,
      jsonValue: null,
    };
  }
  if (typeof value === "number") {
    return {
      stringValue: null,
      numberValue: value,
      booleanValue: null,
      jsonValue: null,
    };
  }
  if (typeof value === "boolean") {
    return {
      stringValue: null,
      numberValue: null,
      booleanValue: value,
      jsonValue: null,
    };
  }
  if (value === null) {
    return {
      stringValue: null,
      numberValue: null,
      booleanValue: null,
      jsonValue: null,
    };
  }
  return {
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    jsonValue: toJson(value, 8_000),
  };
}

function needsLocalApproval(args: {
  target: "local" | "provider";
  fields: Record<string, unknown>;
}) {
  if (args.target !== "local") return false;
  const risk = crmWriteRisk(Object.keys(args.fields));
  return risk !== "routine" || Object.keys(args.fields).length > 1;
}

async function updateLocalFields(input: {
  record: typeof schema.crmRecords.$inferSelect;
  fields: Record<string, CrmValue>;
  policies: Array<typeof schema.crmFieldPolicies.$inferSelect>;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const policyByName = new Map(
    input.policies.map((policy) => [policy.fieldName, policy]),
  );
  await db.transaction(async (tx) => {
    for (const [fieldName, value] of Object.entries(input.fields)) {
      const policy = policyByName.get(fieldName)!;
      const values = {
        ...fieldColumns(value),
        valueType: policy.valueType,
        storagePolicy: "local-authoritative" as const,
        provenanceJson: toJson(
          [
            {
              provider: "native",
              connectionId: input.record.connectionId,
              objectType: input.record.objectType,
              remoteId: input.record.remoteId,
              fieldName,
              observedAt: now,
            },
          ],
          2_000,
        ),
        accessScopeKey: input.record.accessScopeKey,
        accessScopeJson: input.record.accessScopeJson,
        updatedAt: now,
      };
      const existing = await tx
        .select({ id: schema.crmRecordFields.id })
        .from(schema.crmRecordFields)
        .where(
          and(
            eq(schema.crmRecordFields.recordId, input.record.id),
            eq(schema.crmRecordFields.fieldName, fieldName),
            accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await tx
          .update(schema.crmRecordFields)
          .set(values)
          .where(
            and(
              eq(schema.crmRecordFields.id, existing[0].id),
              accessFilter(
                schema.crmRecordFields,
                schema.crmRecordFieldShares,
                undefined,
                "editor",
              ),
            ),
          );
      } else {
        await tx.insert(schema.crmRecordFields).values({
          id: crypto.randomUUID(),
          recordId: input.record.id,
          fieldPolicyId: policy.id,
          fieldName,
          remoteRevision: null,
          ...values,
          ownerEmail: input.record.ownerEmail,
          orgId: input.record.orgId,
          visibility: input.record.visibility,
          createdAt: now,
        });
      }
    }

    if (Object.hasOwn(input.fields, "desiredCadenceDays")) {
      const cadence = input.fields.desiredCadenceDays;
      if (
        cadence !== null &&
        (typeof cadence !== "number" ||
          !Number.isInteger(cadence) ||
          cadence < 1 ||
          cadence > 365)
      ) {
        throw new Error("desiredCadenceDays must be null or an integer from 1 to 365.");
      }
      await tx
        .update(schema.crmRecords)
        .set({ desiredCadenceDays: cadence, updatedAt: now })
        .where(
          and(
            eq(schema.crmRecords.id, input.record.id),
            accessFilter(
              schema.crmRecords,
              schema.crmRecordShares,
              undefined,
              "editor",
            ),
          ),
        );
    }
  });
}

export default defineAction({
  description:
    "Submit a revision-aware CRM record update. Provider updates are always saved as proposals first; local-authoritative fields may be applied after the applicable approval policy is satisfied.",
  schema: z.object({
    recordId: z.string().trim().min(1).max(128),
    target: z.enum(["local", "provider"]).default("provider"),
    fields: fieldPatchSchema,
    expectedRemoteRevision: z.string().trim().min(1).max(256).optional(),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
  }),
  needsApproval: needsLocalApproval,
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
      `Submitted CRM ${args.target} update for record ${args.recordId}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    await assertAccess("crm-record", args.recordId, "editor");
    const db = getDb();
    const [record] = await db
      .select()
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.id, args.recordId),
          accessFilter(
            schema.crmRecords,
            schema.crmRecordShares,
            undefined,
            "editor",
          ),
        ),
      )
      .limit(1);
    if (!record || record.tombstone)
      throw new Error("CRM record is unavailable for updates.");

    const fields = args.fields as Record<string, CrmValue>;
    const fieldNames = Object.keys(fields);
    const policies = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.connectionId, record.connectionId),
          eq(schema.crmFieldPolicies.objectType, record.objectType),
          accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
        ),
      );
    const policyByName = new Map(
      policies.map((policy) => [policy.fieldName, policy]),
    );
    const missing = fieldNames.filter(
      (fieldName) => !policyByName.has(fieldName),
    );
    const blocked = fieldNames.filter((fieldName) => {
      const policy = policyByName.get(fieldName);
      return (
        !policy || !policy.updateable || policy.storagePolicy === "redacted"
      );
    });
    if (missing.length || blocked.length) {
      throw new Error(
        `Only discovered, updateable CRM fields can be changed. Unsupported: ${[...new Set([...missing, ...blocked])].join(", ")}`,
      );
    }

    const wrongAuthority = fieldNames.filter((fieldName) => {
      const storagePolicy = policyByName.get(fieldName)?.storagePolicy;
      return args.target === "local"
        ? storagePolicy !== "local-authoritative"
        : storagePolicy === "derived-local" ||
            storagePolicy === "local-authoritative";
    });
    if (wrongAuthority.length) {
      throw new Error(
        `${args.target === "local" ? "Local" : "Provider"} authority does not own: ${wrongAuthority.join(", ")}`,
      );
    }

    const risk = crmWriteRisk(fieldNames);
    const initiatedBy = crmInitiatedBy(ctx);
    const decision = decideCrmWritePolicy({
      initiatedBy,
      target: args.target,
      reversibility: "compensatable",
      scope: fieldNames.length === 1 ? "single-field" : "single-record",
      risk,
      delegatedAuthority: false,
      storedAutomationPolicy: false,
    });
    if (decision === "deny")
      throw new Error(
        "This CRM update is not authorized by the current write policy.",
      );

    const now = new Date().toISOString();
    const mutationId = crypto.randomUUID();
    const idempotencyKey = args.idempotencyKey ?? crypto.randomUUID();
    const ownership = {
      ownerEmail: record.ownerEmail,
      orgId: record.orgId,
      visibility: record.visibility,
    };
    if (args.target === "local") {
      await updateLocalFields({ record, fields, policies });
      await db.insert(schema.crmMutations).values({
        id: mutationId,
        recordId: record.id,
        connectionId: record.connectionId,
        operation: "update",
        initiatedBy,
        target: "local",
        policyDecision: decision,
        risk,
        status: "applied",
        patchJson: toJson({ fields }, 12_000),
        beforeJson: "{}",
        afterJson: toJson({ fields }, 12_000),
        idempotencyKey,
        expectedRemoteRevision: args.expectedRemoteRevision ?? null,
        appliedAt: now,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
      return {
        mutationId,
        recordId: record.id,
        status: "applied" as const,
        ownerEmail: record.ownerEmail,
        orgId: record.orgId,
        visibility: record.visibility,
      };
    }

    await db.insert(schema.crmMutations).values({
      id: mutationId,
      recordId: record.id,
      connectionId: record.connectionId,
      operation: "update",
      initiatedBy,
      target: "provider",
      policyDecision: decision,
      risk,
      status: "pending",
      patchJson: toJson({ fields }, 12_000),
      beforeJson: toJson({ remoteRevision: record.remoteRevision }, 1_000),
      afterJson: "{}",
      idempotencyKey,
      expectedRemoteRevision: args.expectedRemoteRevision ?? null,
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
    return {
      mutationId,
      recordId: record.id,
      status: "pending" as const,
      decision,
      ownerEmail: record.ownerEmail,
      orgId: record.orgId,
      visibility: record.visibility,
    };
  },
});
