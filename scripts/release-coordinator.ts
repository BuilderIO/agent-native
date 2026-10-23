import { execFileSync } from "node:child_process";

export const RELEASE_COORDINATOR_STEP_NAME =
  "Release packages, then desktop apps and production sites";

type WorkflowRun = {
  id?: unknown;
  event?: unknown;
  head_branch?: unknown;
  run_started_at?: unknown;
  status?: unknown;
};

type WorkflowJob = {
  conclusion?: unknown;
  name?: unknown;
  status?: unknown;
  steps?: unknown;
};

type WorkflowStep = {
  conclusion?: unknown;
  name?: unknown;
  status?: unknown;
};

function isReleasePhaseJob(job: WorkflowJob, phase: "prepare" | "post-merge") {
  const names =
    phase === "prepare"
      ? [
          "Run the prepare release phase",
          "Prepare and merge the stable package release",
        ]
      : [
          "Run the post-merge release phase",
          "Publish and deploy the merged stable release",
        ];
  return (
    typeof job.name === "string" &&
    names.some((name) => job.name === name || job.name.endsWith(` / ${name}`))
  );
}

function phaseJobIsQueuedOrRunning(job: WorkflowJob): boolean {
  return (
    job.conclusion == null &&
    ["queued", "pending", "waiting", "in_progress"].includes(String(job.status))
  );
}

function phaseJobIsInProgress(job: WorkflowJob): boolean {
  return job.conclusion == null && job.status === "in_progress";
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function paginatedRecords(
  pages: unknown,
  collection: string,
  label: string,
): Record<string, unknown>[] {
  if (!Array.isArray(pages)) {
    throw new Error(`GitHub returned invalid ${label} pages.`);
  }

  const items: Record<string, unknown>[] = [];
  for (const page of pages) {
    const records = record(page, `${label} page`)[collection];
    if (!Array.isArray(records)) {
      throw new Error(
        `GitHub returned an invalid ${collection} list for ${label}.`,
      );
    }
    items.push(...records.map((item) => record(item, `${label} item`)));
  }
  return items;
}

export function selectActiveReleaseCoordinator(
  pages: unknown,
  pullRequestUpdatedAt: string,
  expectedRunId?: number,
): number {
  const runs = paginatedRecords(
    pages,
    "workflow_runs",
    "Release everything runs",
  );
  const prUpdatedAt = Date.parse(pullRequestUpdatedAt);
  if (!Number.isFinite(prUpdatedAt)) {
    throw new Error(
      "The release PR has no valid update time for coordinator matching.",
    );
  }
  if (runs.length !== 1) {
    throw new Error(
      `Expected one active Release everything coordinator; GitHub returned ${runs.length}.`,
    );
  }

  const run = runs[0] as WorkflowRun;
  if (
    !Number.isSafeInteger(run.id) ||
    run.status !== "in_progress" ||
    run.head_branch !== "main" ||
    !["schedule", "workflow_dispatch"].includes(String(run.event)) ||
    typeof run.run_started_at !== "string"
  ) {
    throw new Error(
      "GitHub returned an invalid active Release everything coordinator.",
    );
  }

  const startedAt = Date.parse(run.run_started_at);
  if (!Number.isFinite(startedAt) || startedAt > prUpdatedAt + 60_000) {
    throw new Error(
      "The active Release everything coordinator does not match the release PR update.",
    );
  }
  if (expectedRunId !== undefined && run.id !== expectedRunId) {
    throw new Error(
      `Release coordinator changed during the wait: expected run ${expectedRunId}, found ${run.id}.`,
    );
  }

  return run.id as number;
}

export function assertReleaseCoordinatorStepActive(
  pages: unknown,
  runId: number,
): void {
  const jobs = paginatedRecords(pages, "jobs", `jobs for release run ${runId}`);
  const releaseSteps: Array<{ job: WorkflowJob; step: WorkflowStep }> = [];
  for (const jobRecord of jobs) {
    const job = jobRecord as WorkflowJob;
    if (!Array.isArray(job.steps)) {
      throw new Error(
        `GitHub returned invalid workflow steps for release run ${runId}.`,
      );
    }
    for (const stepValue of job.steps) {
      const step = record(
        stepValue,
        `workflow step for release run ${runId}`,
      ) as WorkflowStep;
      if (step.name === RELEASE_COORDINATOR_STEP_NAME) {
        releaseSteps.push({ job, step });
      }
    }
  }

  const activeReleaseSteps = releaseSteps.filter(
    ({ job, step }) =>
      job.status === "in_progress" &&
      step.status === "in_progress" &&
      step.conclusion == null,
  );
  if (activeReleaseSteps.length === 1) return;
  if (activeReleaseSteps.length > 1) {
    throw new Error(
      `Expected one active release step in coordinator run ${runId}; GitHub returned ${activeReleaseSteps.length}.`,
    );
  }

  const prepareJobs = jobs.filter((job) =>
    isReleasePhaseJob(job as WorkflowJob, "prepare"),
  ) as WorkflowJob[];
  const postMergeJobs = jobs.filter((job) =>
    isReleasePhaseJob(job as WorkflowJob, "post-merge"),
  ) as WorkflowJob[];
  if (prepareJobs.some(phaseJobIsInProgress)) return;
  const prepareSucceeded = prepareJobs.some(
    (job) => job.status === "completed" && job.conclusion === "success",
  );
  if (
    prepareSucceeded &&
    (postMergeJobs.length === 0 ||
      postMergeJobs.some(phaseJobIsQueuedOrRunning))
  ) {
    return;
  }

  if (activeReleaseSteps.length === 0 && releaseSteps.length === 1) {
    throw new Error(
      `Release everything coordinator run ${runId} is no longer performing the release step.`,
    );
  }
  if (activeReleaseSteps.length !== 1) {
    throw new Error(
      `Expected one active release step in coordinator run ${runId}; GitHub returned ${activeReleaseSteps.length}.`,
    );
  }
}

function ghJson<T>(args: string[], token?: string): T {
  const stdout = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: token ? { ...process.env, GH_TOKEN: token } : process.env,
  });
  return JSON.parse(stdout) as T;
}

export function verifyActiveReleaseCoordinator(
  repo: string,
  pullRequestUpdatedAt: string,
  expectedRunId?: number,
): number {
  const runs = ghJson<unknown>(
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/actions/workflows/release-everything.yml/runs?branch=main&status=in_progress&per_page=100`,
    ],
    process.env.GH_ACTIONS_TOKEN ?? process.env.GH_TOKEN,
  );
  const runId = selectActiveReleaseCoordinator(
    runs,
    pullRequestUpdatedAt,
    expectedRunId,
  );
  const jobs = ghJson<unknown>(
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
    ],
    process.env.GH_ACTIONS_TOKEN ?? process.env.GH_TOKEN,
  );
  assertReleaseCoordinatorStepActive(jobs, runId);
  return runId;
}
