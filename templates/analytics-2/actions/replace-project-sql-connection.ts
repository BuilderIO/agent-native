import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  assertGrantedDataConnection,
  requireWritableProject,
} from "../server/lib/project-action-access.js";
import { replaceSqlConnection } from "../server/model/cells-store.js";

export default defineAction({
  description:
    "Replace a SQL connection across the exact observed working-project cells in one transaction. Read the project first and supply every matching cell id and revision; changed cells or a changed set reject the entire replacement. Existing outputs for replaced cells are cleared.",
  schema: z
    .object({
      projectId: z
        .string()
        .min(1)
        .describe("Project whose working cells will be updated."),
      fromConnectionId: z
        .string()
        .min(1)
        .describe("Current connection id to replace."),
      toConnectionId: z
        .string()
        .min(1)
        .describe("Granted workspace connection id to use."),
      expectedCells: z
        .array(
          z
            .object({ cellId: z.string().min(1), updatedAt: z.string().min(1) })
            .strict(),
        )
        .min(1)
        .max(200)
        .describe(
          "Every SQL cell using the current connection, with the revision returned by get-project.",
        ),
    })
    .strict(),
  outputSchema: z.object({
    projectId: z.string(),
    updatedCount: z.number().int(),
  }),
  timeoutMs: 60_000,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (
    { projectId, fromConnectionId, toConnectionId, expectedCells },
    _context,
  ) => {
    await assertGrantedDataConnection(toConnectionId);
    const { scope, project } = await requireWritableProject(projectId);
    const updatedCount = await replaceSqlConnection({
      ...scope,
      projectId: project.id,
      versionId: project.workingVersionId,
      fromConnectionId,
      toConnectionId,
      expectedCells,
    });
    return { projectId: project.id, updatedCount };
  },
});
