/**
 * deploy-design-preview — trigger a preview deploy when the source supports it
 * (§6.6 of DESIGN-STUDIO-PLAN.md).
 *
 * Behaviour:
 * - **Capability gate (server-side):** re-checks `deployPreview` capability.
 *   When `unavailable` (inline/localhost), returns a `ctaRequired` response with a
 *   "Make it real" CTA — never fakes a deploy call.
 * - **Builder gate:** if `resolveIsBuilderBranchingEnabled()` returns false,
 *   returns a `connectRequired` CTA.
 * - **Branch requirement:** a branch must already exist on the design (created
 *   via `create-design-branch`).  If no branch is found, returns a clear
 *   `branchRequired` message rather than silently failing.
 * - **Deploy trigger:** calls `runBuilderAgent()` with a scoped "deploy preview"
 *   prompt asking the Builder cloud agent to build and publish a preview URL for
 *   the named branch.  Builder returns `{ branchName, url, status }`.
 * - **Persistence:** updates the matching branch entry in the design's `data`
 *   JSON blob with `previewUrl` and `deployStatus`.
 *
 * The preview URL is the Builder-hosted ephemeral preview (not a permanent
 * production deploy — use the Builder Visual Editor's Publish flow for that).
 *
 * Per DESIGN-STUDIO-PLAN.md §5, `deploy` (production) is the separate step;
 * `deployPreview` is the lighter "preview build" step exposed here.
 */

import { defineAction } from "@agent-native/core";
import {
  runBuilderAgent,
  resolveBuilderBranchProjectId,
  resolveIsBuilderBranchingEnabled,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  resolveSourceCapabilities,
  resolveFusionCapabilities,
} from "../shared/capability-resolver.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";

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

interface StoredBranchEntry {
  branchName?: string;
  projectId?: string;
  url?: string;
  status?: string;
  purpose?: string | null;
  preSnapshotVersionId?: string | null;
  previewUrl?: string | null;
  deployStatus?: string | null;
  createdAt?: string;
  [key: string]: unknown;
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

/** Build a concise deploy-preview prompt for the Builder cloud agent. */
function buildDeployPrompt(
  designTitle: string,
  branchName: string,
  projectId: string,
): string {
  return [
    `Deploy a preview build for branch "${branchName}" of project "${projectId}".`,
    `Design: "${designTitle}".`,
    "Build the branch and publish a preview URL so the design can be reviewed",
    "in a real browser before merging to production.",
  ].join("\n");
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Trigger a preview deploy for a fusion-backed design branch. " +
    "Requires the design's source to advertise the 'deployPreview' capability " +
    "(fusion tier) AND Builder.io to be connected. " +
    "For inline/localhost designs, returns ctaRequired=true with a Make-it-real " +
    "CTA — never fakes a deploy call. " +
    "A branch must already exist (created via create-design-branch). " +
    "On success, persists previewUrl and deployStatus into the design's branch " +
    "metadata and returns the preview URL. " +
    "Note: this triggers a *preview* deploy, not a production publish. " +
    "Use the Builder Visual Editor's Publish flow for production deploys.",
  schema: z.object({
    designId: z.string().describe("Design project ID to deploy a preview for"),
    branchName: z
      .string()
      .optional()
      .describe(
        "Branch name to deploy. Defaults to the most recently created branch " +
          "when omitted.",
      ),
  }),
  run: async ({ designId, branchName }) => {
    // ── Access check (editor level required for deploys) ────────────────────
    await assertAccess("design", designId, "editor");
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const resource = access.resource as {
      title?: string;
      data?: unknown;
    };

    // ── Source type + capability check ──────────────────────────────────────
    const designData = parseDesignData(resource.data);
    const sourceType = designSourceTypeFromData(designData);

    // For fusion sources, resolve the Builder connection status first so that
    // resolveFusionCapabilities returns the CONNECTED map (with deployPreview
    // available) when Builder is actually wired up.  For inline/localhost the
    // generic resolver is sufficient — those sources never have deployPreview.
    const builderEnabled =
      sourceType === "fusion"
        ? await resolveIsBuilderBranchingEnabled()
        : false;
    const caps =
      sourceType === "fusion"
        ? resolveFusionCapabilities(builderEnabled)
        : resolveSourceCapabilities(sourceType);

    if (!hasCapability(caps, "deployPreview")) {
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
          ? "Builder is not yet connected. Connect Builder.io to trigger preview deploys."
          : "Preview deploys require a Builder-hosted app. Use 'Make it real' to upgrade " +
            "this inline design to a real-app source, then deploy previews.",
        previewUrl: null,
        deployStatus: null,
        branch: null,
      };
    }

    // At this point sourceType === "fusion" and builderEnabled === true,
    // so no separate Builder gate is needed — the capability check above
    // already required a connected Builder to set deployPreview=available.

    // ── Resolve branch entry ─────────────────────────────────────────────────
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

    if (!branch || !branch.branchName) {
      return {
        designId,
        sourceType,
        ctaRequired: false,
        ctaKind: null,
        ctaMessage: null,
        note:
          "No branch found for this design. Use create-design-branch to create " +
          "a branch first, then trigger a preview deploy.",
        previewUrl: null,
        deployStatus: null,
        branch: null,
      };
    }

    // ── Trigger the preview deploy via the Builder cloud agent ───────────────
    const projectId = await resolveBuilderBranchProjectId();
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("No authenticated user");

    const designTitle =
      typeof resource.title === "string" && resource.title.trim()
        ? resource.title.trim()
        : "Design";

    const builderResult = await runBuilderAgent({
      prompt: buildDeployPrompt(designTitle, branch.branchName, projectId),
      projectId,
      branchName: branch.branchName,
      userEmail,
    });

    // ── Persist preview URL + deploy status into the branch entry ────────────
    const now = new Date().toISOString();
    const targetBranchName = branch.branchName;
    await mutateDesignData({
      designId,
      mutate: (current) => {
        const latestBranches = Array.isArray(current.branches)
          ? current.branches
          : [];
        let found = false;
        const updatedBranches = latestBranches.map((candidate) => {
          if (
            candidate === null ||
            typeof candidate !== "object" ||
            Array.isArray(candidate)
          ) {
            return candidate;
          }
          const stored = candidate as StoredBranchEntry;
          if (
            stored.branchName?.toLowerCase() !== targetBranchName.toLowerCase()
          ) {
            return candidate;
          }
          found = true;
          return {
            ...stored,
            previewUrl: builderResult.url,
            deployStatus: builderResult.status,
            lastDeployedAt: now,
          };
        });
        if (!found) {
          throw new Error(
            `Branch "${targetBranchName}" was removed while its preview was building. The preview was not attached to stale design data.`,
          );
        }
        return { ...current, branches: updatedBranches };
      },
      isApplied: (current) =>
        Array.isArray(current.branches) &&
        current.branches.some((candidate) => {
          if (
            candidate === null ||
            typeof candidate !== "object" ||
            Array.isArray(candidate)
          ) {
            return false;
          }
          const stored = candidate as StoredBranchEntry;
          return (
            stored.branchName?.toLowerCase() ===
              targetBranchName.toLowerCase() &&
            stored.previewUrl === builderResult.url &&
            stored.deployStatus === builderResult.status &&
            stored.lastDeployedAt === now
          );
        }),
    });

    return {
      designId,
      sourceType,
      ctaRequired: false,
      ctaKind: null,
      ctaMessage: null,
      previewUrl: builderResult.url,
      deployStatus: builderResult.status,
      branch: {
        branchName: branch.branchName,
        projectId: builderResult.projectId,
        url: branch.url ?? null,
        previewUrl: builderResult.url,
        deployStatus: builderResult.status,
        lastDeployedAt: now,
      },
      note:
        "Preview deploy triggered. The Builder cloud agent is building the branch. " +
        "Visit the previewUrl once status is 'ready' to review the deployed design. " +
        "For production deploys, use the Builder Visual Editor's Publish flow.",
    };
  },
});
