/**
 * create-design-branch — start/link a Builder-hosted branch for a fusion-backed
 * design (§6.6 of DESIGN-STUDIO-PLAN.md).
 *
 * Behaviour:
 * - **Capability gate (server-side):** re-checks `branch` capability from the
 *   design's source.  When `unavailable` (inline/localhost), returns a CTA
 *   explaining what the user needs to do — never fakes a branch call.
 * - **Builder gate:** if `resolveIsBuilderBranchingEnabled()` returns false,
 *   returns a `connectRequired` CTA pointing at the Builder connect flow.
 * - **Branch creation:** calls `runBuilderAgent()` with a scoped prompt that
 *   asks the agent to create/link a branch for the design.  The Builder cloud
 *   agent runs in a sandbox and returns `{ branchName, projectId, url, status }`.
 * - **Persistence:** stores the returned branch metadata into the design's `data`
 *   JSON blob under a `branches` key, keyed by `branchName`.  This is additive —
 *   existing data is preserved.
 * - **Design version snapshot:** creates a `design_versions` row capturing the
 *   pre-branch HTML state so the branch can be diffed/rolled back via
 *   `get-design-branch-diff`.
 *
 * Per DESIGN-STUDIO-PLAN.md §3.3, the original inline design is never dropped;
 * migration is preview-only until the user approves cutover.
 */

import { defineAction } from "@agent-native/core";
import {
  runBuilderAgent,
  resolveBuilderBranchProjectId,
  resolveIsBuilderBranchingEnabled,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  resolveSourceCapabilities,
  resolveFusionCapabilities,
} from "../shared/capability-resolver.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse the design's data JSON blob. */
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
    // Stale or invalid JSON — return empty.
  }
  return {};
}

/**
 * Build a concise branch-creation prompt for the Builder cloud agent.
 * The prompt identifies the design by title and requests a branch.
 */
function buildBranchPrompt(
  designTitle: string,
  purpose: string | undefined,
  designId: string,
): string {
  const purposeLine = purpose?.trim()
    ? `Purpose / context: ${purpose.trim()}`
    : "Purpose: explore / iterate on this design as a real app branch.";
  return [
    `Create a new branch for the design "${designTitle}" (id: ${designId}).`,
    purposeLine,
    "The branch should reflect the current design state and be ready for",
    "iterative edits via the Builder Visual Editor.",
  ].join("\n");
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Start or link a Builder-hosted branch for a fusion-backed design. " +
    "Requires the design's source to advertise the 'branch' capability (fusion tier) " +
    "AND Builder.io to be connected. " +
    "For inline/localhost designs without Builder, returns a ctaRequired response " +
    "with a 'Make it real' upgrade message — never fakes a branch call. " +
    "On success, persists branch metadata (branchName, url, status, projectId) " +
    "into the design's data blob and creates a design_versions snapshot so the " +
    "pre-branch state can be diffed/rolled back via get-design-branch-diff.",
  schema: z.object({
    designId: z.string().describe("Design project ID to create a branch for"),
    branchName: z
      .string()
      .optional()
      .describe(
        "Desired branch name. Builder may normalise or suffix it to ensure " +
          "uniqueness. Omit to let Builder auto-generate a name.",
      ),
    purpose: z
      .string()
      .optional()
      .describe(
        "Optional short description of what this branch is for (fed to the " +
          "Builder cloud agent as context).",
      ),
  }),
  run: async ({ designId, branchName, purpose }) => {
    const db = getDb();

    // ── Access check (editor level required for branch creation) ────────────
    await assertAccess("design", designId, "editor");
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const resource = access.resource as {
      title?: string;
      data?: unknown;
    };

    // ── Source type + capability check ──────────────────────────────────────
    const designData = parseDesignData(resource.data);
    const sourceType =
      normalizeDesignSourceType(designData["sourceType"]) ?? "inline";

    // For fusion sources, resolve the Builder connection status first so that
    // resolveFusionCapabilities returns the CONNECTED map (with branch/deploy
    // available) when Builder is actually wired up.  For inline/localhost the
    // generic resolver is sufficient — those sources never have branch.
    const builderEnabled =
      sourceType === "fusion"
        ? await resolveIsBuilderBranchingEnabled()
        : false;
    const caps =
      sourceType === "fusion"
        ? resolveFusionCapabilities(builderEnabled)
        : resolveSourceCapabilities(sourceType);

    if (!hasCapability(caps, "branch")) {
      // Inline or localhost designs don't support branching.  Return a CTA.
      // For a disconnected fusion source the connect-builder CTA applies.
      const isFusion = sourceType === "fusion";
      return {
        designId,
        sourceType,
        ctaRequired: true,
        ctaKind: isFusion
          ? ("connect-builder" as const)
          : ("make-it-real" as const),
        ctaMessage: isFusion
          ? "Builder is not yet connected. Connect Builder.io to create branches for this design."
          : "Branching requires a Builder-hosted app. Use 'Make it real' to upgrade this inline design to a real-app source, then create branches.",
        branch: null,
        versionId: null,
      };
    }

    // At this point sourceType === "fusion" and builderEnabled === true,
    // so no separate Builder gate is needed — the capability check above
    // already required a connected Builder to set branch=available.

    // ── Snapshot the current design state before branching ──────────────────
    // Fetch all files so the snapshot captures the full pre-branch state.
    const files = await db
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    const now = new Date().toISOString();
    const versionId = `dv_${nanoid(12)}`;

    const snapshot = JSON.stringify({
      designId,
      snapshotKind: "pre-branch",
      branchPurpose: purpose ?? null,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        content: f.content,
        bytes: f.content?.length ?? 0,
      })),
      capturedAt: now,
    });

    await db.insert(schema.designVersions).values({
      id: versionId,
      designId,
      label: `Pre-branch snapshot — ${now}`,
      snapshot,
      createdAt: now,
    });

    // ── Run the Builder cloud agent to create the branch ────────────────────
    const projectId = await resolveBuilderBranchProjectId();
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("No authenticated user");

    const designTitle =
      typeof resource.title === "string" && resource.title.trim()
        ? resource.title.trim()
        : "Design";

    const builderResult = await runBuilderAgent({
      prompt: buildBranchPrompt(designTitle, purpose, designId),
      projectId,
      branchName: branchName?.trim() || undefined,
      userEmail,
    });

    // ── Persist branch metadata into the design's data blob ─────────────────
    const existingBranches = Array.isArray(designData["branches"])
      ? (designData["branches"] as unknown[])
      : [];

    const branchEntry = {
      branchName: builderResult.branchName,
      projectId: builderResult.projectId,
      url: builderResult.url,
      status: builderResult.status,
      purpose: purpose ?? null,
      preSnapshotVersionId: versionId,
      createdAt: now,
    };

    const updatedData = JSON.stringify({
      ...designData,
      branches: [...existingBranches, branchEntry],
      // Upgrade the source type to fusion once a Builder branch is provisioned,
      // so the capability matrix reflects the new real-app tier.
      sourceType: "fusion",
    });

    await db
      .update(schema.designs)
      .set({ data: updatedData, updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return {
      designId,
      sourceType: "fusion" as const,
      ctaRequired: false,
      ctaKind: null,
      ctaMessage: null,
      branch: branchEntry,
      versionId,
      note:
        "The design source has been upgraded to 'fusion'. The pre-branch state " +
        "is captured in the design version snapshot so you can diff/rollback via " +
        "get-design-branch-diff.",
    };
  },
});
