import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  configureNativeCrmConnection,
  createNativeCrmAdapter,
} from "../server/crm/native-adapter.js";
import { getDb, schema } from "../server/db/index.js";
import type { CrmValue } from "../shared/crm-contract.js";
import {
  crmInitiatedBy,
  isSafeCrmMutationFields,
  MAX_CRM_FIELDS_PER_MUTATION,
  requireCrmScope,
  scopedCrmIdempotencyKey,
} from "./_crm-action-utils.js";

const kindToObjectType = {
  account: "accounts",
  person: "people",
  opportunity: "opportunities",
} as const;

export const nativeRecordFieldsSchema = z
  .record(z.string().trim().min(1).max(120), z.unknown())
  .refine(
    (fields) => Object.keys(fields).length <= MAX_CRM_FIELDS_PER_MUTATION,
    `Provide at most ${MAX_CRM_FIELDS_PER_MUTATION} fields.`,
  )
  .refine(
    isSafeCrmMutationFields,
    "CRM fields and values cannot contain media, transcripts, data URLs, base64, or oversized JSON.",
  );

export default defineAction({
  description:
    "Create an account, person, or opportunity in Native SQL CRM. The record is local-authoritative, access-scoped, idempotent, audited, and has no upstream provider write.",
  schema: z.object({
    connectionId: z.string().trim().min(1).max(128).optional(),
    kind: z.enum(["account", "person", "opportunity"]),
    displayName: z.string().trim().min(1).max(500),
    fields: nativeRecordFieldsSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(256).optional(),
  }),
  audit: {
    target: (_args, result) => {
      const record = result as {
        recordId: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-record",
        id: record.recordId,
        ownerEmail: record.ownerEmail,
        orgId: record.orgId,
        visibility: record.visibility,
      };
    },
    summary: (args) =>
      `Created Native SQL CRM ${args.kind} ${args.displayName}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    const db = getDb();
    const connectionRows = await db
      .select({ id: schema.crmConnections.id })
      .from(schema.crmConnections)
      .where(
        and(
          eq(schema.crmConnections.provider, "native"),
          ...(args.connectionId
            ? [eq(schema.crmConnections.id, args.connectionId)]
            : []),
          accessFilter(
            schema.crmConnections,
            schema.crmConnectionShares,
            undefined,
            "editor",
          ),
        ),
      )
      .limit(args.connectionId ? 1 : 2);
    if (!connectionRows.length && args.connectionId) {
      throw new Error(
        "The selected Native SQL CRM is unavailable or you do not have editor access.",
      );
    }
    if (!args.connectionId && connectionRows.length > 1) {
      throw new Error(
        "More than one Native SQL CRM is available. Provide connectionId to choose one.",
      );
    }
    const connectionId =
      connectionRows[0]?.id ??
      (
        await configureNativeCrmConnection({
          ownership,
        })
      ).id;
    const objectType = kindToObjectType[args.kind];
    const remoteId = crypto.randomUUID();
    const fields = {
      ...(args.fields as Record<string, CrmValue> | undefined),
      displayName: args.displayName,
      ...(args.kind === "person" ? {} : { name: args.displayName }),
    };
    const idempotencyKey = await scopedCrmIdempotencyKey({
      ...ownership,
      recordId: `${connectionId}:${objectType}`,
      key: args.idempotencyKey ?? crypto.randomUUID(),
    });
    const adapter = await createNativeCrmAdapter({
      connectionId,
      initiatedBy: crmInitiatedBy(ctx),
    });
    const result = await adapter.applyMutation({
      operation: "create",
      record: {
        connectionId,
        provider: "native",
        objectType,
        kind: args.kind,
        remoteId,
      },
      fields,
      idempotencyKey,
    });
    if (result.status !== "applied" || !result.record?.ref.localId) {
      throw new Error(
        result.message ?? "Native SQL CRM record was not created.",
      );
    }
    return {
      recordId: result.record.ref.localId,
      connectionId,
      provider: "native" as const,
      kind: args.kind,
      displayName: result.record.displayName,
      revision: result.remoteRevision,
      ...ownership,
    };
  },
});
