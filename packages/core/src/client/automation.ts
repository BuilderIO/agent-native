import type { AutomationInvocationResult } from "../automation/index.js";
import { callAction } from "./use-action.js";

export interface InvokeConfiguredAutomationWorkflowInput {
  readonly workflowId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

/**
 * Invoke an app-registered automation action without hand-writing a browser
 * request. Apps may choose a custom action name when registering the runtime.
 */
export async function invokeConfiguredAutomationWorkflow(
  input: InvokeConfiguredAutomationWorkflowInput,
  options: { readonly actionName?: string } = {},
): Promise<AutomationInvocationResult> {
  return callAction<AutomationInvocationResult>(
    options.actionName ?? "invoke-automation-workflow",
    input,
  );
}
