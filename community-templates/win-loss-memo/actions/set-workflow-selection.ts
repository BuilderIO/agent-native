import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { readWorkflowState } from "./get-workflow.js";

export default defineAction({
  description:
    "Select one item in the workflow queue and persist that selection for the current user.",
  mcpTool: true,
  schema: z.object({
    id: z.string().min(1).describe("Workflow item id to select."),
  }),
  run: async ({ id }) => {
    const currentWorkflow = await readWorkflowState();
    if (!currentWorkflow.items.some((item) => item.id === id)) {
      throw new Error(`Unknown workflow item: ${id}`);
    }
    await writeAppState("win-loss-memo:workflow-selection", { selectedId: id });
    return { selectedId: id };
  },
});
