import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { readDesignVersionSnapshot } from "../server/lib/design-versions.js";
import type {
  A11yFinding,
  DesignReviewSnapshot,
  DesignReviewStatus,
  VisualDiffChangeKind,
  VisualDiffEntry,
} from "../shared/design-review.js";

function snapshotNodes(
  files: ReadonlyArray<{ filename: string; content: string }>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    files.map((file) => [
      file.filename,
      { content: file.content, bytes: file.content.length },
    ]),
  );
}

function diffSnapshotNodes(
  baseNodes: Record<string, Record<string, unknown>>,
  compareNodes: Record<string, Record<string, unknown>>,
): VisualDiffEntry[] {
  const entries: VisualDiffEntry[] = [];
  const baseKeys = new Set(Object.keys(baseNodes));
  const compareKeys = new Set(Object.keys(compareNodes));

  for (const key of compareKeys) {
    if (!baseKeys.has(key)) {
      entries.push({
        id: `added:${key}`,
        kind: "added" as VisualDiffChangeKind,
        description: `File added: ${key}`,
      });
    }
  }

  for (const key of baseKeys) {
    if (!compareKeys.has(key)) {
      entries.push({
        id: `removed:${key}`,
        kind: "removed" as VisualDiffChangeKind,
        description: `File removed: ${key}`,
      });
    }
  }

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
          description: `File modified: ${key} (${JSON.stringify(baseBytes)}B → ${JSON.stringify(compareBytes)}B)`,
        });
      }
    }
  }

  return entries;
}

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
    await assertAccess("design", designId, "editor");
    const db = getDb();

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

    let visualDiff: VisualDiffEntry[] = [];
    let resolvedBaseVersionId: string | null = null;
    let resolvedCompareVersionId: string | null = null;

    const wantDiff = !!(baseVersionId || compareVersionId);

    if (wantDiff) {
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
          .where(
            and(
              eq(schema.designVersions.designId, designId),
              inArray(schema.designVersions.id, [
                baseVersionId,
                effectiveCompareId,
              ]),
            ),
          );

        const byId = Object.fromEntries(
          versionRows.map((r) => [r.id, r.snapshot]),
        );

        const baseSnapshot = byId[baseVersionId];
        const compareSnapshot = byId[effectiveCompareId];

        if (baseSnapshot && compareSnapshot) {
          const [baseVersion, compareVersion] = await Promise.all([
            readDesignVersionSnapshot(baseSnapshot, designId),
            readDesignVersionSnapshot(compareSnapshot, designId),
          ]);
          const baseNodes = snapshotNodes(baseVersion.files);
          const compareNodes = snapshotNodes(compareVersion.files);
          visualDiff = diffSnapshotNodes(baseNodes, compareNodes);
          resolvedBaseVersionId = baseVersionId;
          resolvedCompareVersionId = effectiveCompareId;
        }
      }
    }

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
