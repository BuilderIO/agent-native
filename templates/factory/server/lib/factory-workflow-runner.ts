import type { JobFrontmatter } from "@agent-native/core/jobs/frontmatter";

/** The `runner` a job names to be executed by the workflow engine, not an agent. */
export const WORKFLOW_RUNNER = "workflow";

export function isWorkflowJob(meta: Pick<JobFrontmatter, "runner">): boolean {
  return meta.runner === WORKFLOW_RUNNER;
}

/** What the old automation actions tell a caller who points them at a workflow's job. */
export function workflowJobRefusal(action: "edit" | "run"): {
  message: string;
  errorCode: string;
} {
  return action === "edit"
    ? {
        message:
          "This job is a workflow. Edit it with save-factory-workflow; the graph is its source of truth.",
        errorCode: "use_save_factory_workflow",
      }
    : {
        message:
          "This job is a workflow. Run it with run-factory-workflow, which keeps dry runs and the enabled switch in force.",
        errorCode: "use_run_factory_workflow",
      };
}
