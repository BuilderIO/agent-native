import type { AutomationInvocationResult } from "../automation/index.js";
import { callAction } from "./use-action.js";

export interface InvokeConfiguredAutomationWorkflowInput {
  readonly workflowId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

export async function invokeConfiguredAutomationWorkflow(
  input: InvokeConfiguredAutomationWorkflowInput,
  options: { readonly actionName?: string } = {},
): Promise<AutomationInvocationResult> {
  return callAction<AutomationInvocationResult>(
    options.actionName ?? "invoke-automation-workflow",
    input,
  );
}
