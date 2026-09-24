import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { isSafeCrmEvidenceExcerpt } from "../server/crm/crm-field-firewall.js";
import { getDb, schema } from "../server/db/index.js";
import { isDurableClipsEvidenceUrl } from "../shared/crm-automation-recipes.js";
import { requireCrmScope } from "./_crm-action-utils.js";

const httpsUrl = z
  .string()
  .url()
  .max(2_048)
  .refine(
    (value) => /^https:\/\//i.test(value),
    "sourceUrl must be an https URL",
  );

export default defineAction({
  description:
    "Attach bounded call evidence to a CRM record. Store only an artifact reference, URL, optional short quote, speaker, timestamp, and summary; never submit a transcript or media payload.",
  schema: z
    .object({
      recordId: z.string().trim().min(1).max(128).optional(),
      recordIds: z
        .array(z.string().trim().min(1).max(128))
        .min(1)
        .max(20)
        .optional(),
      interactionId: z.string().trim().min(1).max(128).optional(),
      artifactId: z.string().trim().min(1).max(256),
      sourceUrl: httpsUrl,
      sourceApp: z.string().trim().min(1).max(80).default("clips"),
      artifactType: z.string().trim().min(1).max(80).default("call-evidence"),
      quote: z
        .string()
        .trim()
        .max(1_200)
        .refine(
          isSafeCrmEvidenceExcerpt,
          "quote must be a bounded human-readable excerpt, not transcript, media, binary, base64, or data-url content",
        )
        .optional(),
      speaker: z.string().trim().max(240).optional(),
      startSeconds: z.number().finite().min(0).max(86_400).optional(),
      endSeconds: z.number().finite().min(0).max(86_400).optional(),
      summary: z
        .string()
        .trim()
        .max(2_000)
        .refine(
          isSafeCrmEvidenceExcerpt,
          "summary must be a bounded human-readable excerpt, not transcript, media, binary, base64, or data-url content",
        )
        .optional(),
      capturedAt: z.string().datetime({ offset: true }).optional(),
    })
    .superRefine((value, issue) => {
      if (
        (!value.recordId && !value.recordIds) ||
        (value.recordId && value.recordIds)
      ) {
        issue.addIssue({
          code: "custom",
          message: "Provide exactly one of recordId or recordIds",
          path: ["recordId"],
        });
      }
      if (
        value.endSeconds !== undefined &&
        value.startSeconds !== undefined &&
        value.endSeconds < value.startSeconds
      ) {
        issue.addIssue({
          code: "custom",
          message: "endSeconds must be after startSeconds",
          path: ["endSeconds"],
        });
      }
      if (
        value.sourceApp.trim().toLowerCase() === "clips" &&
        !isDurableClipsEvidenceUrl(value.sourceUrl)
      ) {
        issue.addIssue({
          code: "custom",
          message:
            "Clips evidence must use a durable /share/<id> or /r/<id> page URL without an access token, media endpoint, or transcript fragment",
          path: ["sourceUrl"],
        });
      }
    }),
  audit: {
    target: (args, result) => {
      const value = result as {
        evidence?: Array<{
          ownerEmail: string;
          orgId: string | null;
          visibility: "private" | "org";
        }>;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      const evidence = value.evidence?.[0] ?? value;
      return {
        type: "crm-record",
        id: args.recordId ?? args.recordIds?.[0] ?? "unknown",
        ownerEmail: evidence.ownerEmail,
        orgId: evidence.orgId,
        visibility: evidence.visibility,
      };
    },
    summary: (args) =>
      `Attached call evidence to ${args.recordIds?.length ?? 1} CRM record${args.recordIds?.length === 1 ? "" : "s"}`,
    recordInputs: false,
  },
  run: async (args, ctx) => {
    const recordIds = args.recordId
      ? [args.recordId]
      : [...new Set(args.recordIds ?? [])];
    await Promise.all(
      recordIds.map((recordId) =>
        assertAccess("crm-record", recordId, "editor"),
      ),
    );
    if (args.interactionId)
      await assertAccess("crm-interaction", args.interactionId, "viewer");
    const db = getDb();
    const scope = requireCrmScope(ctx);
    const now = new Date().toISOString();
    const rows = recordIds.map((recordId) => ({
      id: crypto.randomUUID(),
      interactionId: args.interactionId ?? null,
      recordId,
      sourceApp: args.sourceApp,
      artifactType: args.artifactType,
      artifactId: args.artifactId,
      sourceUrl: args.sourceUrl,
      quote: args.quote ?? "",
      speaker: args.speaker ?? null,
      startSeconds: args.startSeconds ?? null,
      endSeconds: args.endSeconds ?? null,
      summary: args.summary ?? "",
      capturedAt: args.capturedAt ?? now,
      ...scope,
      createdAt: now,
      updatedAt: now,
    }));
    await db.transaction(async (tx) => {
      await tx.insert(schema.crmCallEvidence).values(rows);
    });
    const evidence = await db
      .select()
      .from(schema.crmCallEvidence)
      .where(
        and(
          inArray(
            schema.crmCallEvidence.id,
            rows.map((row) => row.id),
          ),
          eq(schema.crmCallEvidence.ownerEmail, scope.ownerEmail),
        ),
      )
      .limit(recordIds.length);
    if (evidence.length !== recordIds.length)
      throw new Error("Call evidence could not be verified after saving.");
    return args.recordId ? evidence[0] : { evidence };
  },
});
