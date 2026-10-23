import { registerJobRunner } from "@agent-native/core/server";

import { WORKFLOW_RUNNER } from "../lib/factory-workflow-runner.js";
import type { WorkflowJobRunnerDeps } from "./job-runner.js";

/**
 * Registers the workflow runner with core under the id jobs name in
 * `runner:`. Registering is all that happens when the server starts: the
 * engine and everything it pulls in load on the first tick, so a cold
 * serverless function pays nothing for a runner it may never be asked to run.
 */
export function registerWorkflowJobRunner(
  deps?: WorkflowJobRunnerDeps,
): () => void {
  return registerJobRunner(WORKFLOW_RUNNER, async (ctx) => {
    const { createWorkflowJobRunner } = await import("./job-runner.js");
    return createWorkflowJobRunner(deps)(ctx);
  });
}
