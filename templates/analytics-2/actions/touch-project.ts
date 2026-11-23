import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { recordProjectView } from "../server/model/project-views.js";
import { touchProject } from "../server/model/projects-store.js";

/**
 * Records that the caller opened a project. This is what orders the workspace's
 * recents and the list's "Last viewed by me" column, so it runs on open rather
 * than on edit. Viewing needs no write permission.
 */
export default defineAction({
  description: "Record that the caller opened a project, for recents ordering.",
  schema: z.strictObject({
    projectId: z.string().min(1),
    viewId: z.uuid().optional(),
  }),
  outputSchema: z.object({ id: z.string(), openedAt: z.string() }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ projectId, viewId }) => {
    const { scope, project } = await requireReadableProject(projectId);
    if (viewId && project.notebookVersionId === project.workingVersionId) {
      await getDb().transaction(async () => {
        const recorded = await recordProjectView(
          scope,
          project.id,
          scope.ownerEmail,
          undefined,
          viewId,
        );
        if (recorded) await touchProject(scope, project.id);
      });
    } else {
      await touchProject(scope, project.id);
    }
    return { id: project.id, openedAt: new Date().toISOString() };
  },
});
