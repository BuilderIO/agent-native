import { isAgentCaller } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfilesWithStatus } from "@agent-native/core/user-profile/server";
import { z } from "zod";

import { projectListRowSchema } from "../app/lib/model/contracts.js";
import {
  ANALYTICS_CONTROL_IDS as ids,
  evaluateWorkspaceCapabilities,
} from "../server/lib/analytics-capabilities.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { assertCollectionReadable } from "../server/model/collections-store.js";
import { listProjectRows } from "../server/model/projects-store.js";
import { capabilityDecisionSchema } from "../shared/capabilities.js";
import { PROJECT_LIST_SEARCH_MAX_LENGTH } from "../shared/search-limits.js";

export const AGENT_PROJECT_LIST_LIMIT = 50;

export default defineAction({
  mcpTool: true,
  description: `List the signed-in member's projects in the current workspace, most recently updated first (the first row is the one touched last). Read-only: to show recent or all projects on screen, also call navigate with view "home" or "all". Agents get at most ${AGENT_PROJECT_LIST_LIMIT} rows unless they pass limit; \`total\` and \`truncated\` say whether more exist, so narrow with search or raise limit instead of assuming the page is everything.`,
  schema: z
    .object({
      view: z.enum(["active", "archive", "trash"]).default("active"),
      search: z.string().max(PROJECT_LIST_SEARCH_MAX_LENGTH).default(""),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Most rows to return. Omit for the default bound."),
      collectionId: z
        .string()
        .trim()
        .min(1)
        .max(512)
        .optional()
        .describe("Only the projects filed in this collection."),
    })
    .strict(),
  outputSchema: z.object({
    projects: z.array(projectListRowSchema),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
    capabilities: z.array(capabilityDecisionSchema),
    viewer: z.object({ email: z.string(), orgId: z.string() }),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ view, search, collectionId, limit }, context) => {
    const current = await requireCurrentWorkspace();
    if (collectionId !== undefined) {
      await assertCollectionReadable(
        { ownerEmail: current.ownerEmail, orgId: current.orgId },
        collectionId,
      );
    }
    const found = await listProjectRows({
      ownerEmail: current.ownerEmail,
      orgId: current.orgId,
      trashed: view === "trash",
      archived: view === "archive",
      search,
      ...(collectionId === undefined ? {} : { collectionId }),
    });
    const bound =
      limit ??
      (isAgentCaller(context?.caller) ? AGENT_PROJECT_LIST_LIMIT : null);
    const sliced = bound === null ? found : found.slice(0, bound);
    const emails = sliced.flatMap((row) => [
      row.ownerEmail,
      ...(row.creatorEmail ? [row.creatorEmail] : []),
    ]);
    const { profiles } = await getUserProfilesWithStatus(emails);
    const displayName = (email: string | null) => {
      if (!email) return null;
      const name = profiles.get(email.toLowerCase())?.name.trim();
      return name && !isEmailDerivedName(name, email) ? name : null;
    };
    const projects = sliced.map((row) => ({
      ...row,
      ownerName: displayName(row.ownerEmail),
      creatorName: displayName(row.creatorEmail),
    }));
    const capabilities = await evaluateWorkspaceCapabilities(current, [
      ids.projectAppViews,
      ids.projectAppLastPublished,
      ids.projectAppLastViewed,
      ids.projectYourAccess,
      ids.projectSharedWith,
    ]);
    return {
      projects,
      total: found.length,
      truncated: projects.length < found.length,
      capabilities,
      viewer: { email: current.ownerEmail, orgId: current.orgId },
    };
  },
});
