/**
 * get-design-branch-diff — read action returning a code + visual diff for a
 * design branch (§6.6 of DESIGN-STUDIO-PLAN.md).
 *
 * Two diff axes:
 *
 * 1. **Visual diff** — compares two `design_versions` snapshots (before and
 *    after branching).  Always available when a `preSnapshotVersionId` is
 *    stored on the branch entry.  Reuses the same lightweight snapshot-diff
 *    approach from `get-design-review.ts` (file presence + content hash).
 *
 * 2. **Code/branch diff** — available only when the source is `fusion` and
 *    `diffPatch` capability is advertised.  For now this surfaces the branch
 *    metadata (name, url, status) and a clear `notAvailable` note when the
 *    bridge write path isn't yet hardened.  Per the plan, real file-level code
 *    diffs land with bridge write hardening (phase 5); the action is structured
 *    to receive that data transparently once the bridge proves it.
 *
 * When neither diff axis is available (e.g. inline design without branches),
 * returns `ctaRequired: true` with a "Make it real" CTA.
 */

import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { resolveSourceCapabilities } from "../shared/capability-resolver.js";
import type {
  VisualDiffEntry,
  VisualDiffChangeKind,
} from "../shared/design-review.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredBranchEntry {
  branchName?: string;
  projectId?: string;
  url?: string;
  status?: string;
  purpose?: string | null;
  preSnapshotVersionId?: string | null;
  createdAt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Parse a design_versions snapshot JSON into a flat map of
 * `{ filename: { bytes, contentHash } }` for structural comparison.
 * Mirrors the approach in `get-design-review.ts`.
 */
function parseSnapshotFiles(
  snapshotRaw: string,
): Record<string, { bytes: number; content: string | undefined }> {
  try {
    const obj = JSON.parse(snapshotRaw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const record = obj as Record<string, unknown>;
    const files = record["files"];
    if (!Array.isArray(files)) return {};

    const out: Record<string, { bytes: number; content: string | undefined }> =
      {};
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

/** Produce a visual diff entry list from two snapshot file maps. */
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

// ─── Action ───────────────────────────────────────────────────────────────────

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

    // ── Access check ────────────────────────────────────────────────────────
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const resource = access.resource as { data?: unknown };

    // ── Source type + capability check ──────────────────────────────────────
    const designData = parseDesignData(resource.data);
    const sourceType = designSourceTypeFromData(designData);
    const caps = resolveSourceCapabilities(sourceType);

    // For inline/localhost without branch capability, return a CTA.
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
            ? "Builder is not yet connected. Connect Builder.io to view branch diffs."
            : "Branch diffs require a Builder-hosted app. Use 'Make it real' to upgrade " +
              "this inline design to a real-app source.",
        branch: null,
        visualDiff: [] as VisualDiffEntry[],
        codeDiff: null,
        baseVersionId: null,
        compareVersionId: null,
      };
    }

    // ── Resolve branch entry ─────────────────────────────────────────────────
    const branches = parseBranches(designData);

    let branch: StoredBranchEntry | null = null;
    if (branchName) {
      branch =
        branches.find(
          (b) => b.branchName?.toLowerCase() === branchName.toLowerCase(),
        ) ?? null;
    } else {
      // Default to the most recently created branch.
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

    // ── Resolve version ids for the visual diff ──────────────────────────────
    // Priority: explicit params > branch's pre-snapshot > most-recent version
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

    // ── Visual diff ──────────────────────────────────────────────────────────
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
        .where(eq(schema.designVersions.designId, designId));

      const byId = Object.fromEntries(
        versionRows.map((r) => [r.id, r.snapshot]),
      );

      const baseSnap = byId[effectiveBaseId];
      const compareSnap = byId[effectiveCompareId];

      if (baseSnap && compareSnap) {
        const baseFiles = parseSnapshotFiles(baseSnap);
        const compareFiles = parseSnapshotFiles(compareSnap);
        visualDiff = diffSnapshotFiles(baseFiles, compareFiles);
        resolvedBaseVersionId = effectiveBaseId;
        resolvedCompareVersionId = effectiveCompareId;
      }
    }

    // ── Code/branch diff ─────────────────────────────────────────────────────
    // File-level code diffs land with bridge write hardening (phase 5).
    // Surface what is available now: branch metadata + a clear not-available note.
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
