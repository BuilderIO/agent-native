import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import { isSafeCrmEvidenceExcerpt } from "../server/crm/crm-field-firewall.js";
import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  description:
    "Log a call, meeting, email, note, or message on a CRM record's timeline. Stores a bounded summary only (never a transcript or media). Also advances the record's lastMeaningfulInteractionAt when the entry is meaningful and newer.",
  schema: z.object({
    recordId: z.string().trim().min(1).max(128),
    kind: z.enum(["call", "meeting", "email", "note", "message", "other"]),
    direction: z
      .enum(["inbound", "outbound", "internal", "unknown"])
      .default("unknown"),
    title: z.string().trim().min(1).max(300).optional(),
    summary: z
      .string()
      .trim()
      .max(2_000)
      .refine(
        isSafeCrmEvidenceExcerpt,
        "summary must be a bounded human-readable excerpt, not transcript, media, binary, base64, or data-url content",
      )
      .default(""),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    meaningful: z.boolean().default(true),
    sourceApp: z.string().trim().min(1).max(80).optional(),
    sourceUrl: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => /^https:\/\//i.test(value), "sourceUrl must be https")
      .optional(),
  }),
  outputSchema: z.object({
    interactionId: z.string(),
    recordId: z.string(),
    occurredAt: z.string(),
    ownerEmail: z.string(),
    orgId: z.string().nullable(),
    visibility: z.enum(["private", "org"]),
  }),
  audit: {
    target: (args, result) => {
      const value = result as {
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-record",
        id: args.recordId,
        ownerEmail: value.ownerEmail,
        orgId: value.orgId,
        visibility: value.visibility,
      };
    },
    summary: (args) => `Logged a CRM ${args.kind} interaction`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    await assertAccess("crm-record", args.recordId, "editor");
    const scope = requireCrmScope(ctx);
    const db = getDb();
    const records = await db
      .select({ connectionId: schema.crmRecords.connectionId })
      .from(schema.crmRecords)
      .where(eq(schema.crmRecords.id, args.recordId))
      .limit(1);
    const connectionId = records.reduce<string | null>(
      (_, row) => row.connectionId,
      null,
    );
    if (connectionId === null)
      return fail("CRM record not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });

    const now = new Date().toISOString();
    const occurredAt = args.occurredAt ?? now;
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.crmInteractions).values({
        id,
        recordId: args.recordId,
        connectionId,
        kind: args.kind,
        direction: args.direction,
        title:
          args.title ??
          `${args.kind.charAt(0).toUpperCase()}${args.kind.slice(1)} (${args.direction})`,
        summary: args.summary,
        occurredAt,
        meaningful: args.meaningful,
        sourceApp: args.sourceApp ?? null,
        sourceUrl: args.sourceUrl ?? null,
        ...scope,
        createdAt: now,
        updatedAt: now,
      });
      if (args.meaningful) {
        await tx
          .update(schema.crmRecords)
          .set({ lastMeaningfulInteractionAt: occurredAt, updatedAt: now })
          .where(
            and(
              eq(schema.crmRecords.id, args.recordId),
              or(
                isNull(schema.crmRecords.lastMeaningfulInteractionAt),
                lt(schema.crmRecords.lastMeaningfulInteractionAt, occurredAt),
              ),
            ),
          );
      }
    });
    const saved = await db
      .select({ id: schema.crmInteractions.id })
      .from(schema.crmInteractions)
      .where(eq(schema.crmInteractions.id, id))
      .limit(1);
    if (saved.length === 0)
      // guard:allow-bare-error — invariant: the insert committed above, so a missing row is a storage bug
      throw new Error("Interaction could not be verified after saving.");
    return {
      interactionId: id,
      recordId: args.recordId,
      occurredAt,
      ...scope,
    };
  },
});
