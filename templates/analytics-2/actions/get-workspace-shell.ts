import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  currentApplicationId,
  currentWorkspaceCapabilities,
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import {
  readWorkspaceContextSetup,
  workspaceContextSetupSchema,
} from "../server/model/context-setup.js";
import {
  readWorkspaceActivity,
  workspaceActivitySchema,
} from "../server/model/workspace-activity.js";
import {
  readWorkspaceNavigation,
  workspaceNavigationSchema,
} from "../server/model/workspace-navigation.js";

const featuresSchema = z.object({
  contextStudio: z.boolean(),
  isManagerOrAbove: z.boolean(),
  threads: z.boolean(),
  isAdmin: z.boolean(),
  canExplore: z.boolean(),
  tasks: z.boolean(),
  library: z.boolean(),
  folders: z.boolean(),
  developerTools: z.boolean(),
  canCreateProject: z.boolean(),
  canCreateThread: z.boolean(),
});

export default defineAction({
  description:
    "Read the current workspace identity, permissions, recent work and favorites.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  persistInBrowser: false,
  readOnly: true,
  outputSchema: z.object({
    workspace: z.object({ id: z.string(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    features: featuresSchema,
    ...workspaceActivitySchema.shape,
    ...workspaceNavigationSchema.pick({ workspaces: true }).shape,
    collections: z.array(z.object({ id: z.string(), name: z.string() })),
    contextSetup: workspaceContextSetupSchema,
  }),
  run: async (_input, context) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    const [capabilities, activity, navigation, contextSetup] =
      await Promise.all([
        currentWorkspaceCapabilities(current),
        readWorkspaceActivity(scope, currentApplicationId(context)),
        readWorkspaceNavigation(scope),
        readWorkspaceContextSetup(current.orgId),
      ]);
    return {
      workspace: { id: current.orgId, name: current.membership.name },
      user: {
        id: current.request.authUserId || current.ownerEmail,
        name: current.request.userName || current.ownerEmail,
        email: current.ownerEmail,
      },
      features: {
        contextStudio: capabilities.allows("context-studio"),
        isManagerOrAbove: capabilities.isManagerOrAbove,
        isAdmin: isWorkspaceAdministrator(current),
        canExplore: capabilities.allows("context-studio"),
        threads: true,
        tasks: true,
        library: navigation.library,
        folders: false,
        developerTools: false,
        canCreateProject: capabilities.allows("create-project"),
        canCreateThread: capabilities.allows("create-thread"),
      },
      ...activity,
      workspaces: navigation.workspaces,
      contextSetup,
    };
  },
});
