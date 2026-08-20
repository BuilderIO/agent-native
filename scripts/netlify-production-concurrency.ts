// promote /restore locks the site, and prebuilt unlock/upload is not atomic;
// all three production lanes must therefore share one per-site queue.
export const PRODUCTION_SITE_GROUP =
  "agent-native-production-site-${{ matrix.site }}";

type Workflow = Record<string, unknown>;

const asRecord = (value: unknown): Workflow | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Workflow)
    : null;

export function validateProductionSiteConcurrency(workflows: {
  production: Workflow;
  manage: Workflow;
  promote: Workflow;
}): string[] {
  const issues: string[] = [];
  const jobs = (workflow: Workflow) => asRecord(workflow.jobs);
  const jobConcurrency = (workflow: Workflow, jobName: string) =>
    asRecord(asRecord(jobs(workflow)?.[jobName])?.concurrency);

  for (const [path, workflow, jobName] of [
    [
      ".github/workflows/deploy-production-sites-prebuilt.yml",
      workflows.production,
      "deploy",
    ],
    [
      ".github/workflows/manage-production-sites.yml",
      workflows.manage,
      "manage",
    ],
    [
      ".github/workflows/promote-netlify-deploy.yml",
      workflows.promote,
      "promote",
    ],
  ] as const) {
    const group = jobConcurrency(workflow, jobName)?.group;
    if (group !== PRODUCTION_SITE_GROUP) {
      issues.push(
        `${path} ${jobName} job concurrency.group must equal ${PRODUCTION_SITE_GROUP}`,
      );
    }
  }

  return issues;
}
