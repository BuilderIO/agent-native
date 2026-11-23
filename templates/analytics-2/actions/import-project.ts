import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import type { CellDraft } from "../app/lib/model/contracts.js";
import {
  agentNavigationSchema,
  agentOpenIntentSchema,
  showAgentProject,
} from "../server/agent-navigation.js";
import { requireCapability } from "../server/lib/analytics-capabilities.js";
import {
  notebookChangeResource,
  projectDocumentResultSchema,
} from "../server/lib/project-action-access.js";
import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";
import { createProject } from "../server/model/projects-store.js";
import { ANALYTICS_CONTROL_IDS } from "../shared/analytics-control-ids.js";
import { workspaceIdSchema } from "../shared/notebook-snapshot-contract.js";

/** The base shape every imported cell carries before its kind-specific fields. */
const baseCellDraft = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
} as const;

const importedCellSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("code"),
      source: z.string().max(200_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("markdown"),
      markdown: z.string().max(200_000),
    })
    .strict(),
]);

export default defineAction({
  description:
    "Create a project and fill it with cells imported from a Jupyter notebook.",
  schema: z
    .object({
      title: z
        .string()
        .min(1)
        .max(500)
        .regex(/^[^\u0000]*$/)
        .describe("Project name; defaults to the notebook title."),
      cells: z.array(importedCellSchema).max(200),
      intent: agentOpenIntentSchema,
    })
    .strict(),
  changeResource: (_input, output) =>
    notebookChangeResource({ projectId: output.project.id }),
  outputSchema: projectDocumentResultSchema.extend({
    navigation: agentNavigationSchema.optional(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async ({ title, cells, intent }, context) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    await requireCapability(ANALYTICS_CONTROL_IDS.createProject, {
      kind: "workspace",
      workspaceId: workspaceIdSchema.parse(current.orgId),
    });
    const drafts = cells.map(
      (cell): CellDraft =>
        cell.kind === "code"
          ? {
              ...baseCellDraft,
              kind: "code",
              language: "python",
              source: cell.source,
              resultVariable: null,
              outputResult: true,
            }
          : { ...baseCellDraft, kind: "markdown", markdown: cell.markdown },
    );
    const project = await createProject({ ...scope, title, cells: drafts });
    return {
      project,
      ...(await showAgentProject(context, project.id, intent)),
    };
  },
});
