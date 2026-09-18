import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { workflow, type WorkflowSnapshot } from "../app/lib/workflow.js";

const WORKFLOW_STATE_KEY = "workflow-data";
const SELECTION_STATE_KEY = "workflow-selection";

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

export default defineAction({
  description:
    "Read the current workflow queue and selected item. The queue is stored in application state so the workspace and agent share the same data.",
  mcpTool: true,
  schema: z.object({}),
  http: { method: "GET" },
  run: async (): Promise<WorkflowSnapshot> => {
    const stored = workflowSchema.safeParse(
      await readAppState(WORKFLOW_STATE_KEY),
    );
    const currentWorkflow = stored.success ? stored.data : workflow;
    if (!stored.success) {
      await writeAppState(
        WORKFLOW_STATE_KEY,
        currentWorkflow as unknown as Record<string, unknown>,
      );
    }

    const selection = await readAppState(SELECTION_STATE_KEY);
    const selectedId =
      typeof selection?.selectedId === "string" &&
      currentWorkflow.items.some((item) => item.id === selection.selectedId)
        ? selection.selectedId
        : (currentWorkflow.items[0]?.id ?? "");

    return { workflow: currentWorkflow, selectedId };
  },
});
