import { defineAction } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { isSafeCrmEvidenceExcerpt } from "../server/crm/crm-field-firewall.js";
import { getDb, schema } from "../server/db/index.js";
import {
  crmSignalIdempotencyKey,
  signalTupleError,
} from "./_crm-signal-utils.js";

export default defineAction({
  description:
    "Record one delegated-agent detector hit only after grounding it to an access-scoped evidence excerpt and queued smart run.",
  schema: z.object({
    runId: z.string().trim().min(1).max(128),
    trackerId: z.string().trim().min(1).max(128),
    recordId: z.string().trim().min(1).max(128),
    evidenceId: z.string().trim().min(1).max(128),
    quote: z.string().trim().min(1).max(1_200).refine(isSafeCrmEvidenceExcerpt),
    confidence: z.coerce.number().finite().min(0).max(100),
    model: z.string().trim().min(1).max(120),
    modelVersion: z.string().trim().max(120).optional(),
    idempotencyKey: z.string().trim().min(1).max(180),
  }),
  run: async (args, ctx) => {
    await Promise.all([
      assertAccess("crm-record", args.recordId, "editor"),
      assertAccess("crm-signal-run", args.runId, "editor"),
      assertAccess("crm-signal-tracker", args.trackerId, "viewer"),
      assertAccess("crm-call-evidence", args.evidenceId, "viewer"),
    ]);
    const db = getDb();
    const [[run], [tracker], [evidence]] = await Promise.all([
      db
        .select()
        .from(schema.crmSignalRuns)
        .where(
          and(
            eq(schema.crmSignalRuns.id, args.runId),
            accessFilter(schema.crmSignalRuns, schema.crmSignalRunShares),
          ),
        )
        .limit(1),
      db
        .select()
        .from(schema.crmSignalTrackers)
        .where(
          and(
            eq(schema.crmSignalTrackers.id, args.trackerId),
            accessFilter(
              schema.crmSignalTrackers,
              schema.crmSignalTrackerShares,
            ),
          ),
        )
        .limit(1),
      db
        .select()
        .from(schema.crmCallEvidence)
        .where(
          and(
            eq(schema.crmCallEvidence.id, args.evidenceId),
            accessFilter(schema.crmCallEvidence, schema.crmCallEvidenceShares),
          ),
        )
        .limit(1),
    ]);
    if (
      !run ||
      !tracker ||
      !evidence ||
      run.kind !== "smart" ||
      run.recordId !== args.recordId ||
      run.trackerId !== args.trackerId ||
      tracker.kind !== "smart" ||
      evidence.recordId !== args.recordId
    )
      signalTupleError(
        "The signal run, tracker, evidence, and record do not form an accessible tuple.",
      );
    const source = evidence.quote.trim() || evidence.summary.trim();
    if (!source.includes(args.quote))
      throw new Error(
        "The signal quote must be an exact substring of the stored bounded evidence excerpt.",
      );
    const idem = await crmSignalIdempotencyKey(
      ctx,
      args.recordId,
      args.idempotencyKey,
    );
    const [existing] = await db
      .select()
      .from(schema.crmSignals)
      .where(
        and(
          eq(schema.crmSignals.idempotencyKey, idem.key),
          accessFilter(schema.crmSignals, schema.crmSignalShares),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.crmSignals).values({
        id,
        runId: args.runId,
        trackerId: args.trackerId,
        recordId: args.recordId,
        evidenceId: args.evidenceId,
        kind: "moment",
        label: tracker.name,
        quote: args.quote,
        speaker: evidence.speaker,
        startSeconds: evidence.startSeconds,
        endSeconds: evidence.endSeconds,
        summary: "",
        confidence: args.confidence,
        detector: "agent",
        model: args.model,
        modelVersion: args.modelVersion ?? null,
        reviewStatus: "unreviewed",
        idempotencyKey: idem.key,
        ...idem.scope,
        createdAt: now,
        updatedAt: now,
      });
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
    const [saved] = await db
      .select()
      .from(schema.crmSignals)
      .where(eq(schema.crmSignals.id, id))
      .limit(1);
    if (!saved)
      throw new Error("CRM signal could not be verified after saving.");
    return saved;
  },
});
