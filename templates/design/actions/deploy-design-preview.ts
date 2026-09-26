
import { defineAction } from "@agent-native/core/action";
import {
  runBuilderAgent,
  resolveBuilderBranchProjectId,
  resolveIsBuilderBranchingEnabled,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  resolveSourceCapabilities,
  resolveFusionCapabilities,
} from "../shared/capability-resolver.js";
import { hasCapability } from "../shared/design-source-capabilities.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";


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
    await assertAccess("design", designId, "editor");
    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    const resource = access.resource as {
      title?: string;
      data?: unknown;
    };

    const designData = parseDesignData(resource.data);
    const sourceType = designSourceTypeFromData(designData);

    const builderEnabled =
      sourceType === "fusion"
        ? await resolveIsBuilderBranchingEnabled()
        : false;
    const caps =
      sourceType === "fusion"
        ? resolveFusionCapabilities(builderEnabled)
        : resolveSourceCapabilities(sourceType);

    if (!hasCapability(caps, "deployPreview")) {
      const isFusion = sourceType === "fusion";
      return {
        designId,
        sourceType,
        ctaRequired: true,
        ctaKind: isFusion
          ? ("connect-builder" as const)
          : ("make-it-real" as const),
        ctaMessage: isFusion
          ? "Builder is not yet connected. Connect Builder.io (free tier available) to trigger preview deploys."
          : "Preview deploys require a Builder-hosted app. Use 'Make it real' to upgrade " +
            "this inline design to a real-app source, then deploy previews.",
        previewUrl: null,
        deployStatus: null,
        branch: null,
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
