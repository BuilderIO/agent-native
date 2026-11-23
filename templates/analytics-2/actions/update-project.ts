import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_TITLE_MAX_LENGTH,
} from "../app/lib/model/contracts.js";
import {
  agentNavigationSchema,
  agentOpenIntentSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import {
  notebookChangeResource,
  projectDocumentResultSchema,
  refreshedProjectDocument,
  requireWritableProject,
} from "../server/lib/project-action-access.js";
import {
  currentWorkspaceCapabilities,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { readLegacyNotebook } from "../server/model/notebook-operations/legacy.js";
import { updateProject } from "../server/model/projects-store.js";
import { listStatuses } from "../server/model/statuses-store.js";

export default defineAction({
  mcpTool: true,
  description: "Rename a project the signed-in account owns in this workspace.",
  schema: z
    .object({
      projectId: z.string().min(1),
      // Project names accept up to 500 characters; longer input is
      // rejected before the write instead of being truncated.
      title: z
        .string()
        .max(PROJECT_TITLE_MAX_LENGTH)
        .refine((value) => !value.includes("\0"), {
          message: "Null bytes are not allowed.",
        })
        .optional(),
      /** The project description, shown under the title. */
      description: z
        .string()
        .max(PROJECT_DESCRIPTION_MAX_LENGTH)
        .refine((value) => !value.includes("\0"), {
          message: "Null bytes are not allowed.",
        })
        .optional(),
      statusId: z.string().min(1).nullable().optional(),
      intent: agentOpenIntentSchema,
    })
    .strict()
    .refine(
      ({ title, description, statusId }) =>
        title !== undefined ||
        description !== undefined ||
        statusId !== undefined,
      { message: "Give a title, description or statusId to change." },
    ),
  changeResource: notebookChangeResource,
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: projectDocumentResultSchema.extend({
    previous: z
      .object({
        title: z.string(),
        description: z.string(),
        statusId: z.string().nullable(),
      })
      .describe("The values this call replaced; pass them back to undo."),
    navigation: agentNavigationSchema.optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId, title, description, statusId, intent }, context) => {
    const { scope, project } = await requireWritableProject(projectId);
    const draft = await readLegacyNotebook(scope, projectId);
    if (statusId !== undefined && statusId !== null) {
      const statuses = await listStatuses(scope);
      const chosen = statuses.find((status) => status.id === statusId);
      if (chosen === undefined) {
        fail("That status is not in this workspace.", {
          statusCode: 400,
          errorCode: "project_status_not_found",
        });
      }
      if (chosen.endorsed && draft.project.statusId !== statusId) {
        const capabilities = await currentWorkspaceCapabilities(
          await requireCurrentWorkspace(),
        );
        if (!capabilities.isManagerOrAbove) {
          fail("Only workspace managers can apply an endorsed status.", {
            statusCode: 403,
            errorCode: "project_status_endorsed_manager_required",
          });
        }
      }
    }
    await updateProject(
      {
        ...scope,
        projectId: project.id,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(statusId === undefined ? {} : { statusId }),
      },
      draft,
    );
    const document = await refreshedProjectDocument(scope, project.id);
    return {
      project: document,
      previous: {
        title: project.title,
        description: project.description,
        statusId: project.statusId,
      },
      ...(await showAgentProject(context, project.id, intent)),
    };
  },
});
