import { defineAction } from "@agent-native/core";
import { and, desc, eq, gte, lte, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { absoluteUrl, nowIso } from "../server/lib/json.js";
import { assertOrgAdmin } from "../server/lib/org-admin.js";
import { getPresignedObjectUrl, putObject } from "../server/lib/storage.js";

const RUN_STATUSES = [
  "pending",
  "running",
  "processing",
  "completed",
  "failed",
] as const;
const RUN_SOURCES = ["chat", "ui", "a2a"] as const;

/**
 * RFC 4180 minimal CSV escape. Wraps the field in double quotes and doubles
 * any embedded quote, which handles commas, newlines, and quotes safely.
 */
function csv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Org-admin only. Bulk-exports a CSV of audit runs in a date window.
 *
 * The CSV is uploaded via the same storage layer as image objects (S3 in
 * prod, local fallback in dev). When S3 is configured, returns a presigned
 * URL with a short TTL. In dev, returns a same-origin static URL the
 * `/api/assets/:id/content` route doesn't serve (CSV bypasses that), so dev
 * users can copy the file from `data/assets-objects/audits/...` directly.
 */
export default defineAction({
  description:
    "Org-admin only. Export the audit log to CSV with the given filters. Returns a presigned download URL valid for 30 minutes.",
  schema: z.object({
    dateFrom: z.string(),
    dateTo: z.string(),
    ownerEmail: z.string().optional(),
    libraryId: z.string().optional(),
    model: z.string().optional(),
    status: z.enum(RUN_STATUSES).optional(),
    source: z.enum(RUN_SOURCES).optional(),
    callerAppId: z.string().optional(),
    promptSearch: z.string().optional(),
    expiresInSeconds: z.coerce.number().min(60).max(86400).default(1800),
  }),
  run: async (args) => {
    const scope = await assertOrgAdmin();
    const db = getDb();

    const filters = [];
    // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
    if (scope.orgId)
      filters.push(eq(schema.assetGenerationRuns.orgId, scope.orgId));
    if (scope.ownerEmail) {
      filters.push(eq(schema.assetGenerationRuns.ownerEmail, scope.ownerEmail));
    }
    filters.push(gte(schema.assetGenerationRuns.createdAt, args.dateFrom));
    filters.push(lte(schema.assetGenerationRuns.createdAt, args.dateTo));
    if (args.ownerEmail) {
      filters.push(eq(schema.assetGenerationRuns.ownerEmail, args.ownerEmail));
    }
    if (args.libraryId) {
      filters.push(eq(schema.assetGenerationRuns.libraryId, args.libraryId));
    }
    if (args.model) {
      filters.push(eq(schema.assetGenerationRuns.model, args.model));
    }
    if (args.status) {
      filters.push(eq(schema.assetGenerationRuns.status, args.status));
    }
    if (args.source) {
      filters.push(eq(schema.assetGenerationRuns.source, args.source));
    }
    if (args.callerAppId) {
      filters.push(
        eq(schema.assetGenerationRuns.callerAppId, args.callerAppId),
      );
    }
    if (args.promptSearch) {
      filters.push(
        like(schema.assetGenerationRuns.prompt, `%${args.promptSearch}%`),
      );
    }

    const rows = await db
      .select()
      .from(schema.assetGenerationRuns)
      .where(and(...filters))
      .orderBy(desc(schema.assetGenerationRuns.createdAt))
      .limit(50_000);

    // Library titles in one batch.
    const libIds = [...new Set(rows.map((r) => r.libraryId))];
    const libs =
      libIds.length === 0
        ? []
        : await db
            .select({
              id: schema.assetLibraries.id,
              title: schema.assetLibraries.title,
            })
            .from(schema.assetLibraries)
            // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
            .where(
              libIds.length === 1
                ? eq(schema.assetLibraries.id, libIds[0])
                : sql`${schema.assetLibraries.id} IN (${sql.join(
                    libIds.map((id) => sql`${id}`),
                    sql`, `,
                  )})`,
            );
    const libTitleById = new Map(libs.map((l) => [l.id, l.title]));

    // Child counts in one batch.
    const childCounts = new Map<string, { total: number; saved: number }>();
    if (rows.length) {
      const runIds = rows.map((r) => r.id);
      const childRows = await db
        .select({
          runId: schema.assets.generationRunId,
          status: schema.assets.status,
        })
        .from(schema.assets)
        // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
        .where(
          runIds.length === 1
            ? eq(schema.assets.generationRunId, runIds[0])
            : sql`${schema.assets.generationRunId} IN (${sql.join(
                runIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
        );
      for (const row of childRows) {
        if (!row.runId) continue;
        const cur = childCounts.get(row.runId) ?? { total: 0, saved: 0 };
        cur.total += 1;
        if (row.status === "saved") cur.saved += 1;
        childCounts.set(row.runId, cur);
      }
    }

    const header = [
      "runId",
      "createdAt",
      "completedAt",
      "ownerEmail",
      "orgId",
      "libraryId",
      "libraryTitle",
      "source",
      "callerAppId",
      "mediaType",
      "model",
      "aspectRatio",
      "imageSize",
      "durationSeconds",
      "resolution",
      "userPrompt",
      "status",
      "childCount",
      "savedCount",
      "errorMessage",
    ].join(",");

    const lines = rows.map((row) => {
      const counts = childCounts.get(row.id) ?? { total: 0, saved: 0 };
      return [
        csv(row.id),
        csv(row.createdAt),
        csv(row.completedAt ?? ""),
        csv(row.ownerEmail ?? ""),
        csv(row.orgId ?? ""),
        csv(row.libraryId),
        csv(libTitleById.get(row.libraryId) ?? ""),
        csv(row.source),
        csv(row.callerAppId ?? ""),
        csv(row.mediaType),
        csv(row.model),
        csv(row.aspectRatio),
        csv(row.imageSize),
        csv(row.durationSeconds ?? ""),
        csv(row.resolution ?? ""),
        csv(row.prompt),
        csv(row.status),
        csv(counts.total),
        csv(counts.saved),
        csv(row.error ?? ""),
      ].join(",");
    });

    const csvBody = "﻿" + [header, ...lines].join("\n") + "\n";
    const buffer = Buffer.from(csvBody, "utf-8");
    const objectKey = `audits/${nowIso().slice(0, 10)}/audit-${nanoid()}.csv`;
    await putObject({
      key: objectKey,
      body: buffer,
      contentType: "text/csv; charset=utf-8",
    });

    const presigned = await getPresignedObjectUrl(
      objectKey,
      args.expiresInSeconds,
    );

    return {
      rowCount: rows.length,
      objectKey,
      sizeBytes: buffer.byteLength,
      downloadUrl:
        presigned?.url ??
        absoluteUrl(`/api/audits/${encodeURIComponent(objectKey)}`),
      downloadUrlExpiresAt: presigned?.expiresAt ?? null,
      generatedAt: nowIso(),
    };
  },
});
