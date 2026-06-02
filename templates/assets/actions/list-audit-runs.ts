import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, gte, lte, like, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertOrgAdmin } from "../server/lib/org-admin.js";
import { parseJson } from "../server/lib/json.js";
import type { ImageAssetMetadata } from "../shared/api.js";

const RUN_STATUSES = [
  "pending",
  "running",
  "processing",
  "completed",
  "failed",
] as const;
const RUN_SOURCES = ["chat", "ui", "a2a"] as const;

/**
 * Org-admin paginated audit-log feed.
 *
 * Audit reads bypass the normal `accessFilter` for `image_generation_runs`
 * and `image_libraries` — that's the whole point of the audit surface — but
 * **only after `assertOrgAdmin()` succeeds**. Cross-org leak is impossible:
 * the helper resolves the caller's active-org role from `org_members`, then
 * scopes the run query to `org_id = <caller's org>`. Runs from libraries
 * owned by users outside the admin's org are never returned.
 *
 * Single-user / local mode (no org context) falls back to "owner-only audits
 * their own runs" — `assertOrgAdmin()` returns `{ ownerEmail }` and the
 * query restricts to runs owned by that email.
 */
export default defineAction({
  description:
    "Org-admin only. List asset generation runs across the workspace for governance / design-team review. Filters by date range, owner, library, model, status, source, calling app, and prompt search. Returns paginated results with library titles and child counts. Falls back to owner-only audits when there's no org context.",
  schema: z.object({
    dateFrom: z
      .string()
      .optional()
      .describe("ISO8601 lower bound on createdAt (inclusive)."),
    dateTo: z
      .string()
      .optional()
      .describe("ISO8601 upper bound on createdAt (inclusive)."),
    ownerEmail: z
      .string()
      .optional()
      .describe("Filter to runs triggered by this user."),
    libraryId: z.string().optional(),
    model: z.string().optional(),
    status: z.enum(RUN_STATUSES).optional(),
    source: z.enum(RUN_SOURCES).optional(),
    callerAppId: z
      .string()
      .optional()
      .describe(
        "Filter to runs triggered via A2A from this calling app (e.g. 'slides').",
      ),
    promptSearch: z
      .string()
      .optional()
      .describe("Substring match against the user prompt."),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor — pass the prior page's `nextCursor`. ISO timestamp.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const scope = await assertOrgAdmin();
    const db = getDb();

    // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin above.
    // The `scope` object below carries `orgId` (multi-tenant) or `ownerEmail`
    // (single-user) which we apply explicitly below; `accessFilter` is too
    // narrow because it filters by the caller's *own* libraries / shares,
    // and an audit needs to see every run in the admin's org.
    const filters = [];
    if (scope.orgId)
      filters.push(eq(schema.assetGenerationRuns.orgId, scope.orgId));
    if (scope.ownerEmail) {
      filters.push(eq(schema.assetGenerationRuns.ownerEmail, scope.ownerEmail));
    }
    if (args.dateFrom) {
      filters.push(gte(schema.assetGenerationRuns.createdAt, args.dateFrom));
    }
    if (args.dateTo) {
      filters.push(lte(schema.assetGenerationRuns.createdAt, args.dateTo));
    }
    if (args.cursor) {
      // Cursor is the previous page's last `createdAt`. We're sorted DESC, so
      // "next page" means strictly older.
      filters.push(
        sql`${schema.assetGenerationRuns.createdAt} < ${args.cursor}`,
      );
    }
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

    // Pull `limit + 1` so we can detect whether more pages exist.
    const rows = await db
      .select()
      .from(schema.assetGenerationRuns)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.assetGenerationRuns.createdAt))
      .limit(args.limit + 1);

    const hasMore = rows.length > args.limit;
    const page = hasMore ? rows.slice(0, args.limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].createdAt : null;

    // Resolve library titles in one batch.
    const libIds = [...new Set(page.map((r) => r.libraryId))];
    const libs =
      libIds.length === 0
        ? []
        : await db
            .select({
              id: schema.assetLibraries.id,
              title: schema.assetLibraries.title,
              ownerEmail: schema.assetLibraries.ownerEmail,
            })
            .from(schema.assetLibraries)
            // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin
            // above. We need library titles for every run in the page,
            // including ones owned by other users in the same org.
            .where(
              libIds.length === 1
                ? eq(schema.assetLibraries.id, libIds[0])
                : sql`${schema.assetLibraries.id} IN (${sql.join(
                    libIds.map((id) => sql`${id}`),
                    sql`, `,
                  )})`,
            );
    const libsById = new Map(libs.map((l) => [l.id, l]));

    // Resolve child counts (assets generated by each run) in one batch.
    const childCounts = new Map<string, { total: number; saved: number }>();
    if (page.length) {
      const runIds = page.map((r) => r.id);
      const childRows = await db
        .select({
          runId: schema.assets.generationRunId,
          status: schema.assets.status,
        })
        .from(schema.assets)
        // guard:allow-unscoped — org-admin audit, gated by assertOrgAdmin
        // above. Asset status drives the "saved vs discarded" audit signal.
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

    return {
      count: page.length,
      hasMore,
      nextCursor,
      runs: page.map((row) => {
        const lib = libsById.get(row.libraryId);
        const counts = childCounts.get(row.id) ?? { total: 0, saved: 0 };
        const meta = parseJson<ImageAssetMetadata>(row.metadata, {});
        return {
          runId: row.id,
          libraryId: row.libraryId,
          libraryTitle: lib?.title ?? "Unknown library",
          libraryOwnerEmail: lib?.ownerEmail ?? null,
          ownerEmail: row.ownerEmail,
          orgId: row.orgId,
          source: row.source,
          callerAppId: row.callerAppId,
          mediaType: row.mediaType,
          model: row.model,
          aspectRatio: row.aspectRatio,
          imageSize: row.imageSize,
          durationSeconds: row.durationSeconds,
          resolution: row.resolution,
          userPrompt: row.prompt,
          status: row.status,
          errorMessage: row.error,
          childCount: counts.total,
          savedCount: counts.saved,
          createdAt: row.createdAt,
          completedAt: row.completedAt,
          slotId: meta.slotId ?? null,
          sourceAssetId: meta.sourceAssetId ?? null,
        };
      }),
      scope: {
        orgScoped: Boolean(scope.orgId),
        ownerScoped: Boolean(scope.ownerEmail),
      },
    };
  },
});
