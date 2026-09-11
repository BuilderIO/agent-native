import { defineAction } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { isSafeCrmEvidenceExcerpt } from "../server/crm/crm-field-firewall.js";
import { getDb, schema } from "../server/db/index.js";
import {
  crmSignalIdempotencyKey,
  signalTupleError,
} from "./_crm-signal-utils.js";

const insightSchema = z.object({
  evidenceId: z.string().trim().min(1).max(128),
  kind: z.enum(["call-summary", "next-step"]),
  label: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1_200).refine(isSafeCrmEvidenceExcerpt),
  quote: z
    .string()
    .trim()
    .max(1_200)
    .refine(isSafeCrmEvidenceExcerpt)
    .optional(),
  quoteSeconds: z.coerce.number().finite().min(0).max(86_400),
});

export default defineAction({
  description:
    "Atomically record a bounded, evidence-cited call recap or next-step set produced through agent chat. No transcript body or raw model response is accepted.",
  schema: z.object({
    runId: z.string().trim().min(1).max(128),
    recordId: z.string().trim().min(1).max(128),
    insights: z.array(insightSchema).min(1).max(20),
    model: z.string().trim().min(1).max(120),
    modelVersion: z.string().trim().max(120).optional(),
    idempotencyKey: z.string().trim().min(1).max(180),
  }),
  run: async (args, ctx) => {
    await Promise.all([
      assertAccess("crm-record", args.recordId, "editor"),
      assertAccess("crm-signal-run", args.runId, "editor"),
      ...args.insights.map((item) =>
        assertAccess("crm-call-evidence", item.evidenceId, "viewer"),
      ),
    ]);
    const db = getDb();
    const [run] = await db
      .select()
      .from(schema.crmSignalRuns)
      .where(
        and(
          eq(schema.crmSignalRuns.id, args.runId),
          accessFilter(schema.crmSignalRuns, schema.crmSignalRunShares),
        ),
      )
      .limit(1);
    const evidenceIds = [
      ...new Set(args.insights.map((item) => item.evidenceId)),
    ];
    const evidence = await db
      .select()
      .from(schema.crmCallEvidence)
      .where(
        and(
          inArray(schema.crmCallEvidence.id, evidenceIds),
          accessFilter(schema.crmCallEvidence, schema.crmCallEvidenceShares),
        ),
      )
      .limit(20);
    if (
      !run ||
      run.kind !== "summary" ||
      run.recordId !== args.recordId ||
      evidence.length !== evidenceIds.length ||
      evidence.some((item) => item.recordId !== args.recordId)
    )
      signalTupleError(
        "The summary run, evidence, and record do not form an accessible tuple.",
      );
    const byId = new Map(evidence.map((item) => [item.id, item]));
    const now = new Date().toISOString();
    const rows: Array<typeof schema.crmSignals.$inferInsert> = [];
    for (const [index, item] of args.insights.entries()) {
      const source = byId.get(item.evidenceId)!;
      const excerpt = source.quote.trim() || source.summary.trim();
      if (item.quote && !excerpt.includes(item.quote))
        throw new Error(
          "Every insight quote must be an exact substring of its stored bounded evidence excerpt.",
        );
      const start = source.startSeconds ?? 0;
      if (
        item.quoteSeconds < start ||
        (source.endSeconds !== null && item.quoteSeconds > source.endSeconds)
      )
        throw new Error(
          "Every insight timestamp must fall inside its evidence excerpt.",
        );
      const idem = await crmSignalIdempotencyKey(
        ctx,
        args.recordId,
        `${args.idempotencyKey}:${index}`,
      );
      rows.push({
        id: crypto.randomUUID(),
        runId: args.runId,
        trackerId: null,
        recordId: args.recordId,
        evidenceId: item.evidenceId,
        kind: item.kind,
        label: item.label,
        quote: item.quote ?? "",
        speaker: source.speaker,
        startSeconds: item.quoteSeconds,
        endSeconds: source.endSeconds,
        summary: item.summary,
        confidence: 100,
        detector: "agent",
        model: args.model,
        modelVersion: args.modelVersion ?? null,
        reviewStatus: "unreviewed",
        idempotencyKey: idem.key,
        ...idem.scope,
        createdAt: now,
        updatedAt: now,
      });
    }
    const existing = await db
      .select({ key: schema.crmSignals.idempotencyKey })
      .from(schema.crmSignals)
      .where(
        and(
          inArray(
            schema.crmSignals.idempotencyKey,
            rows.map((row) => row.idempotencyKey),
          ),
          accessFilter(schema.crmSignals, schema.crmSignalShares),
        ),
      );
    const existingKeys = new Set(existing.map((item) => item.key));
    const pending = rows.filter((row) => !existingKeys.has(row.idempotencyKey));
    await db.transaction(async (tx) => {
      if (pending.length) await tx.insert(schema.crmSignals).values(pending);
      await tx
        .update(schema.crmSignalRuns)
        .set({
          status: "completed",
          model: args.model,
          modelVersion: args.modelVersion ?? null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.crmSignalRuns.id, args.runId));
    });
    return {
      created: pending.length,
      replayed: rows.length - pending.length,
      signalIds: pending.map((row) => row.id),
    };
  },
});
