import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  assertGrantedDataConnection,
  requireWritableProject,
} from "../server/lib/project-action-access.js";
import { linkProjectConnection } from "../server/model/project-connection-links.js";

export default defineAction({
  description:
    "Import a workspace data connection into a project so the notebook lists it as imported. This links the connection to the project only; it adds no cell. Repeating it is safe. Add a SQL cell on the connection to query it.",
  schema: z
    .object({
      projectId: z
        .string()
        .min(1)
        .describe("Project that will use the connection."),
      connectionId: z
        .string()
        .min(1)
        .describe("Granted workspace connection id to import."),
    })
    .strict(),
  outputSchema: z.object({ projectId: z.string(), connectionId: z.string() }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId, connectionId }) => {
    await assertGrantedDataConnection(connectionId);
    const { scope, project } = await requireWritableProject(projectId);
    await linkProjectConnection({
      orgId: scope.orgId,
      projectId: project.id,
      connectionId,
      createdBy: scope.ownerEmail,
    });
    return { projectId: project.id, connectionId };
  },
});
