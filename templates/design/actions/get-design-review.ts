/**
 * get-design-review — read-only action returning the latest cached review for
 * a design, optionally including a visual diff between two `design_versions`.
 *
 * The review combines:
 *  - A11yFindings from the most recent `design_review_snapshot` row (or empty
 *    if no audit has been run yet).
 *  - A structural visual diff between `baseVersionId` and `compareVersionId`
 *    when both are provided: each design_versions snapshot is parsed as JSON
 *    and compared for layer/style deltas using the existing `design_versions`
 *    table — no new tables needed.
 *
 * See DESIGN-STUDIO-PLAN.md §6.5 + §7 (Review surface).
 */

import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import type {
  A11yFinding,
  DesignReviewSnapshot,
  DesignReviewStatus,
  VisualDiffChangeKind,
  VisualDiffEntry,
} from "../shared/design-review.js";

// ---------------------------------------------------------------------------
// Visual diff helpers (operate on stored JSON snapshots)
// ---------------------------------------------------------------------------

/**
 * Parse a design_versions snapshot JSON into a flat map of
 * `{ nodeId: { ... style properties ... } }` for diff comparison.
 *
 * The snapshot format is whatever `generate-design` / `create-design-version`
 * stores — typically an object with a `files` array.  We extract a lightweight
 * set of each file's token/style references for structural comparison.
 */
function parseSnapshotNodes(
  snapshotRaw: string,
): Record<string, Record<string, unknown>> {
  try {
    const obj = JSON.parse(snapshotRaw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const record = obj as Record<string, unknown>;

    // Flatten files → content strings into a map keyed by filename.
    const files = record["files"];
    if (!Array.isArray(files)) return {};

    const out: Record<string, Record<string, unknown>> = {};
    for (const file of files) {
      if (!file || typeof file !== "object") continue;
      const f = file as Record<string, unknown>;
      const name = typeof f["filename"] === "string" ? f["filename"] : "?";
      const content =
        typeof f["content"] === "string" ? f["content"] : undefined;
      out[name] = {
        content,
        bytes: typeof content === "string" ? content.length : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Produce a visual diff entry list by comparing two snapshot node maps. */
function diffSnapshotNodes(
  baseNodes: Record<string, Record<string, unknown>>,
  compareNodes: Record<string, Record<string, unknown>>,
): VisualDiffEntry[] {
  const entries: VisualDiffEntry[] = [];
  const baseKeys = new Set(Object.keys(baseNodes));
  const compareKeys = new Set(Object.keys(compareNodes));

  // Added files
  for (const key of compareKeys) {
    if (!baseKeys.has(key)) {
      entries.push({
        id: `added:${key}`,
        kind: "added" as VisualDiffChangeKind,
        description: `File added: ${key}`,
      });
    }
  }

  // Removed files
  for (const key of baseKeys) {
    if (!compareKeys.has(key)) {
      entries.push({
        id: `removed:${key}`,
        kind: "removed" as VisualDiffChangeKind,
        description: `File removed: ${key}`,
      });
    }
  }

  // Modified files (byte-length change as the cheapest proxy for content diff)
  for (const key of compareKeys) {
    if (baseKeys.has(key)) {
      const baseBytes = baseNodes[key]?.["bytes"] ?? 0;
      const compareBytes = compareNodes[key]?.["bytes"] ?? 0;
      const baseContent = baseNodes[key]?.["content"];
      const compareContent = compareNodes[key]?.["content"];
      if (baseContent !== compareContent) {
        entries.push({
          id: `modified:${key}`,
          kind: "modified" as VisualDiffChangeKind,
          description: `File modified: ${key} (${baseBytes}B → ${compareBytes}B)`,
        });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Return the latest accessibility review findings for a design, " +
    "plus an optional structural visual diff between two design_versions. " +
    "Pass baseVersionId and compareVersionId to include the diff; omit them " +
    "for a findings-only response. Read-only — run-design-audit must be " +
    "called first to populate the findings; this action reads the cached result.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID to retrieve the review for"),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Opaque source ref (design_files.id or route id) to scope the review to a specific screen. " +
          "When omitted, returns the most recent design-level snapshot.",
      ),
    baseVersionId: z
      .string()
      .optional()
      .describe(
        "design_versions.id for the older (base) version to diff against.",
      ),
    compareVersionId: z
      .string()
      .optional()
      .describe(
        "design_versions.id for the newer (compare) version. " +
          "If omitted when baseVersionId is set, defaults to the most recent version.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, sourceRef, baseVersionId, compareVersionId }) => {
    const db = getDb();

    // Verify access to the design.
    const [design] = await db
      .select({ id: schema.designs.id })
      .from(schema.designs)
      .where(
        and(
          accessFilter(schema.designs, schema.designShares),
          eq(schema.designs.id, designId),
        ),
      )
      .limit(1);

    if (!design) {
      const err = new Error("Design not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }

    // -----------------------------------------------------------------------
    // Load the latest review snapshot for this design (+ optional sourceRef).
    // -----------------------------------------------------------------------
    const snapshotConditions = [
      eq(schema.designReviewSnapshot.designId, designId),
    ];
    if (sourceRef) {
      snapshotConditions.push(
        eq(schema.designReviewSnapshot.sourceRef, sourceRef),
      );
    }

    const [snapshotRow] = await db
      .select()
      .from(schema.designReviewSnapshot)
      .where(and(...snapshotConditions))
      .orderBy(desc(schema.designReviewSnapshot.createdAt))
      .limit(1);

    let a11yFindings: A11yFinding[] = [];
    let snapshotId: string | null = null;
    let auditedAt: string | null = null;
    let snapshotStatus: DesignReviewStatus = "pending";

    if (snapshotRow) {
      snapshotId = snapshotRow.id;
      auditedAt = snapshotRow.createdAt ?? null;
      snapshotStatus = (snapshotRow.status ?? "pending") as DesignReviewStatus;
      try {
        const parsed = snapshotRow.a11yFindings
          ? (JSON.parse(snapshotRow.a11yFindings) as unknown)
          : [];
        if (Array.isArray(parsed)) {
          a11yFindings = parsed as A11yFinding[];
        }
      } catch {
        a11yFindings = [];
      }
    }

    // -----------------------------------------------------------------------
    // Visual diff between two design_versions (optional).
    // -----------------------------------------------------------------------
    let visualDiff: VisualDiffEntry[] = [];
    let resolvedBaseVersionId: string | null = null;
    let resolvedCompareVersionId: string | null = null;

    const wantDiff = !!(baseVersionId || compareVersionId);

    if (wantDiff) {
      // Resolve compare version (most recent if not specified).
      let effectiveCompareId = compareVersionId;
      if (!effectiveCompareId) {
        const [latestVersion] = await db
          .select({ id: schema.designVersions.id })
          .from(schema.designVersions)
          .where(eq(schema.designVersions.designId, designId))
          .orderBy(desc(schema.designVersions.createdAt))
          .limit(1);
        effectiveCompareId = latestVersion?.id;
      }

      if (baseVersionId && effectiveCompareId) {
        const versionRows = await db
          .select({
            id: schema.designVersions.id,
            snapshot: schema.designVersions.snapshot,
          })
          .from(schema.designVersions)
          .where(and(eq(schema.designVersions.designId, designId)));

        const byId = Object.fromEntries(
          versionRows.map((r) => [r.id, r.snapshot]),
        );

        const baseSnapshot = byId[baseVersionId];
        const compareSnapshot = byId[effectiveCompareId];

        if (baseSnapshot && compareSnapshot) {
          const baseNodes = parseSnapshotNodes(baseSnapshot);
          const compareNodes = parseSnapshotNodes(compareSnapshot);
          visualDiff = diffSnapshotNodes(baseNodes, compareNodes);
          resolvedBaseVersionId = baseVersionId;
          resolvedCompareVersionId = effectiveCompareId;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Build the response shape matching DesignReviewSnapshot.
    // -----------------------------------------------------------------------
    const review: DesignReviewSnapshot = {
      id: snapshotId ?? "",
      designId,
      sourceRef: sourceRef ?? null,
      baseVersionId: resolvedBaseVersionId,
      compareVersionId: resolvedCompareVersionId,
      a11yFindings,
      visualDiff,
      status: snapshotStatus,
      createdAt: auditedAt ?? new Date().toISOString(),
      updatedAt: auditedAt ?? new Date().toISOString(),
    };

    return {
      designId,
      snapshotId,
      auditedAt,
      status: snapshotStatus,
      a11yFindings,
      a11ySummary: {
        errors: a11yFindings.filter((f) => f.severity === "error").length,
        warnings: a11yFindings.filter((f) => f.severity === "warning").length,
        info: a11yFindings.filter((f) => f.severity === "info").length,
        total: a11yFindings.length,
      },
      visualDiff,
      diffSummary: {
        added: visualDiff.filter((d) => d.kind === "added").length,
        removed: visualDiff.filter((d) => d.kind === "removed").length,
        modified: visualDiff.filter((d) => d.kind === "modified").length,
        moved: visualDiff.filter((d) => d.kind === "moved").length,
        total: visualDiff.length,
      },
      baseVersionId: resolvedBaseVersionId,
      compareVersionId: resolvedCompareVersionId,
      review,
    };
  },
});
