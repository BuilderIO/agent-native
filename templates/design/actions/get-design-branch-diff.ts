
import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { readDesignVersionSnapshot } from "../server/lib/design-versions.js";
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import type {
  VisualDiffEntry,
  VisualDiffChangeKind,
} from "../shared/design-review.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";


interface StoredBranchEntry {
  branchName?: string;
  projectId?: string;
  url?: string;
  status?: string;
  purpose?: string | null;
  preSnapshotVersionId?: string | null;
  createdAt?: string;
}


function parseDesignData(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Stale JSON — return empty.
  }
  return {};
}

function parseBranches(
  designData: Record<string, unknown>,
): StoredBranchEntry[] {
  const raw = designData["branches"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is StoredBranchEntry =>
      b !== null && typeof b === "object" && !Array.isArray(b),
  );
}

function snapshotFiles(
  files: ReadonlyArray<{ filename: string; content: string }>,
): Record<string, { bytes: number; content: string }> {
  return Object.fromEntries(
    files.map((file) => [
      file.filename,
      { content: file.content, bytes: file.content.length },
    ]),
  );
}

function diffSnapshotFiles(
  baseFiles: Record<string, { bytes: number; content: string | undefined }>,
  compareFiles: Record<string, { bytes: number; content: string | undefined }>,
): VisualDiffEntry[] {
  const entries: VisualDiffEntry[] = [];
  const baseKeys = new Set(Object.keys(baseFiles));
  const compareKeys = new Set(Object.keys(compareFiles));

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
      const baseContent = baseFiles[key]?.content;
      const compareContent = compareFiles[key]?.content;
      const baseBytes = baseFiles[key]?.bytes ?? 0;
      const compareBytes = compareFiles[key]?.bytes ?? 0;
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


export default defineAction({
  description:
    "Read action: return a code + visual diff for a design branch. " +
    "Visual diff compares design_versions snapshots (before and after branching). " +
    "Code/branch diff surfaces branch metadata (name, url, status) from Builder; " +
    "file-level code diffs become available once bridge write hardening is complete " +
    "(currently planned, not available). " +
    "For inline/localhost designs without branches, returns ctaRequired=true with a " +
    "Make-it-real upgrade CTA. " +
    "Pass branchName to target a specific branch; omit for the most recent one.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID to retrieve the branch diff for"),
    branchName: z
      .string()
      .optional()
      .describe(
        "Target branch name. Defaults to the most recently created branch when omitted.",
      ),
    baseVersionId: z
      .string()
      .optional()
      .describe(
        "design_versions.id for the base (pre-branch) snapshot to diff against. " +
          "Defaults to the branch's stored preSnapshotVersionId when omitted.",
      ),
    compareVersionId: z
      .string()
      .optional()
      .describe(
        "design_versions.id for the compare (post-branch) snapshot. " +
          "Defaults to the most recent design_version when omitted.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId, branchName, baseVersionId, compareVersionId }) => {
    const db = getDb();

    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const resource = access.resource as { data?: unknown };

    const designData = parseDesignData(resource.data);
    const sourceType = designSourceTypeFromData(designData);
    const caps = resolveSourceCapabilities(sourceType);

    if (!hasCapability(caps, "branch") && !hasCapability(caps, "diffPatch")) {
      return {
        designId,
        sourceType,
        ctaRequired: true,
        ctaKind:
          sourceType === "fusion"
            ? ("connect-builder" as const)
            : ("make-it-real" as const),
        ctaMessage:
          sourceType === "fusion"
            ? "Builder is not yet connected. Connect Builder.io (free tier available) to view branch diffs."
            : "Branch diffs require a Builder-hosted app. Use 'Make it real' to upgrade " +
              "this inline design to a real-app source.",
        branch: null,
        visualDiff: [] as VisualDiffEntry[],
        codeDiff: null,
        baseVersionId: null,
        compareVersionId: null,
      };
    }

    const branches = parseBranches(designData);

    let branch: StoredBranchEntry | null = null;
    if (branchName) {
      branch =
        branches.find(
          (b) => b.branchName?.toLowerCase() === branchName.toLowerCase(),
        ) ?? null;
    } else {
      branch = branches.length > 0 ? branches[branches.length - 1]! : null;
    }

    if (!branch) {
      return {
        designId,
        sourceType,
        ctaRequired: false,
        ctaKind: null,
        ctaMessage: null,
        branch: null,
        note: "No branch found for this design. Use create-design-branch to create one.",
        visualDiff: [] as VisualDiffEntry[],
        codeDiff: null,
        baseVersionId: null,
        compareVersionId: null,
      };
    }

    let effectiveBaseId =
      baseVersionId ?? branch.preSnapshotVersionId ?? undefined;
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

    let visualDiff: VisualDiffEntry[] = [];
    let resolvedBaseVersionId: string | null = null;
    let resolvedCompareVersionId: string | null = null;

    if (
      effectiveBaseId &&
      effectiveCompareId &&
      effectiveBaseId !== effectiveCompareId
    ) {
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
              effectiveBaseId,
              effectiveCompareId,
            ]),
          ),
        );

      const byId = Object.fromEntries(
        versionRows.map((r) => [r.id, r.snapshot]),
      );

      const baseSnap = byId[effectiveBaseId];
      const compareSnap = byId[effectiveCompareId];

      if (baseSnap && compareSnap) {
        const [baseVersion, compareVersion] = await Promise.all([
          readDesignVersionSnapshot(baseSnap, designId),
          readDesignVersionSnapshot(compareSnap, designId),
        ]);
        const baseFiles = snapshotFiles(baseVersion.files);
        const compareFiles = snapshotFiles(compareVersion.files);
        visualDiff = diffSnapshotFiles(baseFiles, compareFiles);
        resolvedBaseVersionId = effectiveBaseId;
        resolvedCompareVersionId = effectiveCompareId;
      }
    }

    const codeDiffAvailable = hasCapability(caps, "diffPatch");
    const codeDiff = {
      available: codeDiffAvailable,
      branchName: branch.branchName ?? null,
      projectId: branch.projectId ?? null,
      url: branch.url ?? null,
      status: branch.status ?? null,
      note: codeDiffAvailable
        ? "Branch is connected. File-level diffs are available via the Builder Visual Editor."
        : "File-level code diffs are planned pending bridge write hardening. " +
          "The Builder Visual Editor at the branch URL shows the full code diff.",
    };

    return {
      designId,
      sourceType,
      ctaRequired: false,
      ctaKind: null,
      ctaMessage: null,
      branch: {
        branchName: branch.branchName ?? null,
        projectId: branch.projectId ?? null,
        url: branch.url ?? null,
        status: branch.status ?? null,
        purpose: branch.purpose ?? null,
        createdAt: branch.createdAt ?? null,
        preSnapshotVersionId: branch.preSnapshotVersionId ?? null,
      },
      visualDiff,
      visualDiffSummary: {
        added: visualDiff.filter((d) => d.kind === "added").length,
        removed: visualDiff.filter((d) => d.kind === "removed").length,
        modified: visualDiff.filter((d) => d.kind === "modified").length,
        total: visualDiff.length,
      },
      codeDiff,
      baseVersionId: resolvedBaseVersionId,
      compareVersionId: resolvedCompareVersionId,
    };
  },
});
