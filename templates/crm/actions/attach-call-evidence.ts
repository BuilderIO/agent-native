import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { isSafeCrmEvidenceExcerpt } from "../server/crm/crm-field-firewall.js";
import { getDb, schema } from "../server/db/index.js";
import { requireCrmScope } from "./_crm-action-utils.js";

const httpUrl = z
  .string()
  .url()
  .max(2_048)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "sourceUrl must be an http(s) URL",
  );

export default defineAction({
  description:
    "Attach bounded call evidence to a CRM record. Store only an artifact reference, URL, optional short quote, speaker, timestamp, and summary; never submit a transcript or media payload.",
  schema: z
    .object({
      recordId: z.string().trim().min(1).max(128),
      interactionId: z.string().trim().min(1).max(128).optional(),
      artifactId: z.string().trim().min(1).max(256),
      sourceUrl: httpUrl,
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
    }),
  audit: {
    target: (args, result) => {
      const evidence = result as {
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-record",
        id: args.recordId,
        ownerEmail: evidence.ownerEmail,
        orgId: evidence.orgId,
        visibility: evidence.visibility,
      };
    },
    summary: (args) => `Attached call evidence to CRM record ${args.recordId}`,
    recordInputs: false,
  },
  run: async (args, ctx) => {
    await assertAccess("crm-record", args.recordId, "editor");
    if (args.interactionId)
      await assertAccess("crm-interaction", args.interactionId, "viewer");
    const db = getDb();
    const scope = requireCrmScope(ctx);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.insert(schema.crmCallEvidence).values({
      id,
      interactionId: args.interactionId ?? null,
      recordId: args.recordId,
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
    });
    const [evidence] = await db
      .select()
      .from(schema.crmCallEvidence)
      .where(
        and(
          eq(schema.crmCallEvidence.id, id),
          eq(schema.crmCallEvidence.ownerEmail, scope.ownerEmail),
        ),
      )
      .limit(1);
    if (!evidence)
      throw new Error("Call evidence could not be verified after saving.");
    return evidence;
  },
});
