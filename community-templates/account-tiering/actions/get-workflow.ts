import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { workflow, type WorkflowSnapshot } from "../app/lib/workflow.js";

const WORKFLOW_STATE_KEY = "account-tiering:workflow-data";
const SELECTION_STATE_KEY = "account-tiering:workflow-selection";
const LEGACY_WORKFLOW_STATE_KEY = "workflow-data";
const LEGACY_SELECTION_STATE_KEY = "workflow-selection";

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
  const legacyStored =
    stored === null ? await readAppState(LEGACY_WORKFLOW_STATE_KEY) : null;
  const value = stored ?? legacyStored;
  if (value === null) {
    await writeAppState(
      WORKFLOW_STATE_KEY,
      workflow as unknown as Record<string, unknown>,
    );
    return workflow;
  }

  const parsed = workflowSchema.safeParse(value);
  if (!parsed.success) {
    const invalidKey =
      stored === null ? LEGACY_WORKFLOW_STATE_KEY : WORKFLOW_STATE_KEY;
    throw new Error(
      `Stored workflow state is invalid. Reset ${invalidKey} before retrying.`,
    );
  }
  if (stored === null) {
    await writeAppState(
      WORKFLOW_STATE_KEY,
      parsed.data as unknown as Record<string, unknown>,
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

    let selection = await readAppState(SELECTION_STATE_KEY);
    if (selection === null) {
      selection = await readAppState(LEGACY_SELECTION_STATE_KEY);
      if (selection !== null) {
        await writeAppState(SELECTION_STATE_KEY, selection);
      }
    }
    const selectedId =
      typeof selection?.selectedId === "string" &&
      currentWorkflow.items.some((item) => item.id === selection.selectedId)
        ? selection.selectedId
        : (currentWorkflow.items[0]?.id ?? "");

    return { workflow: currentWorkflow, selectedId };
  },
});
