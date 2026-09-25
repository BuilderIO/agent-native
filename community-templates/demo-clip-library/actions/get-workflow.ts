import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { workflow, type WorkflowSnapshot } from "../app/lib/workflow.js";

const WORKFLOW_STATE_KEY = "demo-clip-library:workflow-data";
const SELECTION_STATE_KEY = "demo-clip-library:workflow-selection";

const workflowSchema = z.object({
  title: z.string(),
  summary: z.string(),
  primaryAction: z.string(),
  queueLabel: z.string(),
  metric: z.object({ value: z.string(), label: z.string() }),
  detailTitle: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      meta: z.string(),
      status: z.string(),
      score: z.string(),
      detail: z.string(),
      tags: z.array(z.string()),
    }),
  ),
});

export async function readWorkflowState(): Promise<
  WorkflowSnapshot["workflow"]
> {
  const stored = await readAppState(WORKFLOW_STATE_KEY);
  if (stored === null) {
    await writeAppState(
      WORKFLOW_STATE_KEY,
      workflow as unknown as Record<string, unknown>,
    );
    return workflow;
  }

  const parsed = workflowSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(
      `Stored workflow state is invalid. Reset ${WORKFLOW_STATE_KEY} before retrying.`,
    );
  }
  return parsed.data;
}

export default defineAction({
  description:
    "Read the current workflow queue and selected item. The queue is stored in application state so the workspace and agent share the same data.",
  mcpTool: true,
  schema: z.object({}),
  http: { method: "GET" },
  run: async (): Promise<WorkflowSnapshot> => {
    const currentWorkflow = await readWorkflowState();

    const selection = await readAppState(SELECTION_STATE_KEY);
    const selectedId =
      typeof selection?.selectedId === "string" &&
      currentWorkflow.items.some((item) => item.id === selection.selectedId)
        ? selection.selectedId
        : (currentWorkflow.items[0]?.id ?? "");

    return { workflow: currentWorkflow, selectedId };
  },
});
