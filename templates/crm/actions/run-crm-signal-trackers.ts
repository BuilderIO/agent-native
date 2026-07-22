import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DEFAULT_CRM_DETECTORS } from "../server/lib/intelligence/default-detectors.js";
import { runKeywordDetector } from "../server/lib/intelligence/keyword-detector.js";
import { buildSmartDetectorPrompt } from "../server/lib/intelligence/smart-detector.js";
import { buildCallEvidenceSummaryPrompt } from "../server/lib/intelligence/summary.js";
import {
  crmSignalIdempotencyKey,
  evidenceExcerpts,
  loadCrmSignalEvidence,
} from "./_crm-signal-utils.js";

export default defineAction({
  description:
    "Run deterministic keyword detectors and prepare bounded smart/summary requests for delegation through agent chat. Never calls an LLM or stores transcript bodies.",
  schema: z.object({
    recordId: z.string().trim().min(1).max(128),
    evidenceIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
    trackerIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
    includeSummary: z.boolean().default(true),
    idempotencyKey: z.string().trim().min(1).max(180),
  }),
  run: async (args, ctx) => {
    const evidence = await loadCrmSignalEvidence({
      recordId: args.recordId,
      evidenceIds: args.evidenceIds,
      role: "editor",
    });
    if (!evidence.length)
      throw new Error(
        "Attach bounded Clips call evidence before running signal detectors.",
      );
    const excerpts = evidenceExcerpts(evidence);
    if (!excerpts.length)
      throw new Error(
        "The attached evidence has no bounded excerpt to analyze.",
      );
    await ensureDefaultTrackers(ctx);
    const filters = [
      eq(schema.crmSignalTrackers.enabled, true),
      accessFilter(schema.crmSignalTrackers, schema.crmSignalTrackerShares),
    ];
    if (args.trackerIds?.length)
      filters.push(inArray(schema.crmSignalTrackers.id, args.trackerIds));
    const trackers = await getDb()
      .select()
      .from(schema.crmSignalTrackers)
      .where(and(...filters))
      .limit(20);
    const now = new Date().toISOString();
    const keywordRows: Array<typeof schema.crmSignals.$inferInsert> = [];
    const delegated: Array<{
      runId: string;
      trackerId?: string;
      kind: "smart" | "summary";
      prompt: string;
    }> = [];

    for (const tracker of trackers) {
      const runKey = await crmSignalIdempotencyKey(
        ctx,
        args.recordId,
        `${args.idempotencyKey}:run:${tracker.id}`,
      );
      const [existingRun] = await getDb()
        .select()
        .from(schema.crmSignalRuns)
        .where(
          and(
            eq(schema.crmSignalRuns.idempotencyKey, runKey.key),
            accessFilter(schema.crmSignalRuns, schema.crmSignalRunShares),
          ),
        )
        .limit(1);
      if (existingRun) continue;
      const runId = crypto.randomUUID();
      if (tracker.kind === "keyword") {
        const candidates = runKeywordDetector(
          {
            id: tracker.id,
            name: tracker.name,
            kind: "keyword",
            keywords: safeKeywords(tracker.keywordsJson),
          },
          excerpts,
        );
        for (const candidate of candidates) {
          const signalKey = await crmSignalIdempotencyKey(
            ctx,
            args.recordId,
            `${args.idempotencyKey}:signal:${tracker.id}:${candidate.evidenceRef}:${candidate.quote}`,
          );
          keywordRows.push({
            id: crypto.randomUUID(),
            runId,
            trackerId: tracker.id,
            recordId: args.recordId,
            evidenceId: candidate.evidenceRef,
            kind: "moment",
            label: tracker.name,
            quote: candidate.quote,
            speaker: candidate.speaker ?? null,
            startSeconds: candidate.startSeconds,
            endSeconds: candidate.endSeconds ?? null,
            summary: "",
            confidence: candidate.confidence,
            detector: "keyword",
            model: null,
            modelVersion: null,
            reviewStatus: "unreviewed",
            idempotencyKey: signalKey.key,
            ...signalKey.scope,
            createdAt: now,
            updatedAt: now,
          });
        }
        await getDb().transaction(async (tx) => {
          await tx.insert(schema.crmSignalRuns).values({
            id: runId,
            trackerId: tracker.id,
            recordId: args.recordId,
            kind: "keyword",
            status: "completed",
            evidenceCount: evidence.length,
            idempotencyKey: runKey.key,
            completedAt: now,
            ...runKey.scope,
            createdAt: now,
            updatedAt: now,
          });
          const rows = keywordRows.filter((row) => row.runId === runId);
          if (rows.length) await tx.insert(schema.crmSignals).values(rows);
        });
      } else {
        const prompt = buildSmartDetectorPrompt(
          {
            id: tracker.id,
            name: tracker.name,
            description: tracker.description,
            classifierPrompt: tracker.classifierPrompt,
          },
          excerpts,
        );
        if (!prompt) continue;
        await getDb()
          .insert(schema.crmSignalRuns)
          .values({
            id: runId,
            trackerId: tracker.id,
            recordId: args.recordId,
            kind: "smart",
            status: "queued",
            evidenceCount: evidence.length,
            idempotencyKey: runKey.key,
            ...runKey.scope,
            createdAt: now,
            updatedAt: now,
          });
        delegated.push({ runId, trackerId: tracker.id, kind: "smart", prompt });
      }
    }

    if (args.includeSummary) {
      const runKey = await crmSignalIdempotencyKey(
        ctx,
        args.recordId,
        `${args.idempotencyKey}:run:summary`,
      );
      const [existing] = await getDb()
        .select({ id: schema.crmSignalRuns.id })
        .from(schema.crmSignalRuns)
        .where(
          and(
            eq(schema.crmSignalRuns.idempotencyKey, runKey.key),
            accessFilter(schema.crmSignalRuns, schema.crmSignalRunShares),
          ),
        )
        .limit(1);
      if (!existing) {
        const runId = crypto.randomUUID();
        const prompt = buildCallEvidenceSummaryPrompt(
          `CRM record ${args.recordId}`,
          excerpts,
        );
        if (prompt) {
          await getDb()
            .insert(schema.crmSignalRuns)
            .values({
              id: runId,
              trackerId: null,
              recordId: args.recordId,
              kind: "summary",
              status: "queued",
              evidenceCount: evidence.length,
              idempotencyKey: runKey.key,
              ...runKey.scope,
              createdAt: now,
              updatedAt: now,
            });
          delegated.push({ runId, kind: "summary", prompt });
        }
      }
    }

    for (const request of delegated) {
      await writeAppState(`crm-signal-agent-request-${request.runId}`, {
        runId: request.runId,
        recordId: args.recordId,
        trackerId: request.trackerId,
        kind: request.kind,
        evidenceIds: evidence.map((item) => item.id),
      });
    }
    return {
      keywordSignalsCreated: keywordRows.length,
      delegatedRequests: delegated,
    };
  },
});

function safeKeywords(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === "string")
          .slice(0, 40)
      : [];
  } catch {
    return [];
  }
}

async function ensureDefaultTrackers(
  ctx: Parameters<typeof crmSignalIdempotencyKey>[0],
) {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.crmSignalTrackers.id })
    .from(schema.crmSignalTrackers)
    .where(
      accessFilter(schema.crmSignalTrackers, schema.crmSignalTrackerShares),
    )
    .limit(1);
  if (existing) return;
  const now = new Date().toISOString();
  for (const detector of DEFAULT_CRM_DETECTORS) {
    const identity = await crmSignalIdempotencyKey(
      ctx,
      "defaults",
      detector.id,
    );
    await db
      .insert(schema.crmSignalTrackers)
      .values({
        id: `default-${identity.key.slice(-32)}`,
        name: detector.name,
        description: detector.description,
        kind: detector.kind,
        keywordsJson: JSON.stringify(detector.keywords ?? []),
        classifierPrompt: detector.classifierPrompt ?? "",
        enabled: true,
        isDefault: true,
        ...identity.scope,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}
