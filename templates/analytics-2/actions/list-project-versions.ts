import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { projectVersionListSchema } from "../app/lib/model/project-version-contracts.js";
import { requireReadableProject } from "../server/lib/project-action-access.js";
import { listProjectVersions } from "../server/model/projects-store.js";

export default defineAction({
  description: "List the saved versions of a project, newest first.",
  schema: z.object({ projectId: z.string().min(1) }).strict(),
  outputSchema: projectVersionListSchema,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ projectId }) => {
    const { scope, project } = await requireReadableProject(projectId);
    return { versions: await listProjectVersions(scope, project.id) };
  },
});
