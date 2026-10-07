#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_SIZE = 100;
const SEARCH_RESULT_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_RUN_DURATION_MS = 35 * 24 * 60 * 60 * 1000;
const WORKFLOW_RUN_QUERY_ATTEMPTS = 2;
const EVENTS = ["push", "schedule"] as const;

export type WorkflowRun = {
  id: number;
  name: string | null;
  path: string;
  html_url: string;
  event: string;
  head_branch: string;
  created_at: string;
  updated_at: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
};

export type WorkflowStep = {
  name: string;
  status: string;
  conclusion: string | null;
};

export type WorkflowJob = {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
  steps: WorkflowStep[];
};

export type CiRedRow = {
  runId: number;
  attempt: number;
  createdAt: string;
  concludedAt: string;
  workflow: string;
  workflowPath: string;
  job: string;
  step: string;
  test: string;
  fingerprintGrain: "test" | "job-step" | "workflow";
  fingerprint: string;
  url: string;
};

type ApiReader = (endpoint: string) => string | Promise<string>;
type FailedRunLogReader = (
  runId: number,
) => string | null | Promise<string | null>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalid(context: string, detail: string): never {
  throw new Error(`${context}: ${detail}`);
}

function resultLimit(context: string): never {
  const error = new Error(
    `${context}: query reached GitHub's ${SEARCH_RESULT_LIMIT}-row search limit`,
  );
  Object.assign(error, { code: "GITHUB_RESULT_LIMIT" });
  throw error;
}

function requiredString(
  value: unknown,
  field: string,
  context: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid(context, `missing or invalid ${field}`);
  }
  return value;
}

function requiredInteger(
  value: unknown,
  field: string,
  context: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(context, `missing or invalid ${field}`);
  }
  return value;
}

function conclusionValue(
  value: unknown,
  field: string,
  context: string,
): string | null {
  if (value !== null && typeof value !== "string") {
    return invalid(context, `missing or invalid ${field}`);
  }
  return value;
}

function paginatedItems(
  raw: string,
  itemKey: "workflow_runs" | "jobs",
  context: string,
): unknown[] {
  let pages: unknown;
  try {
    pages = JSON.parse(raw);
  } catch {
    return invalid(context, "gh api returned malformed JSON");
  }

  if (!Array.isArray(pages) || pages.length === 0) {
    return invalid(context, "gh api pagination returned no inspectable pages");
  }

  let expectedTotal: number | undefined;
  const items: unknown[] = [];
  for (const [index, pageValue] of pages.entries()) {
    const page = asRecord(pageValue);
    if (!page) return invalid(context, `page ${index + 1} is not an object`);
    const total = requiredInteger(page.total_count, "total_count", context);
    if (expectedTotal === undefined) {
      expectedTotal = total;
      if (total >= SEARCH_RESULT_LIMIT) resultLimit(context);
    }
    if (total !== expectedTotal) {
      return invalid(context, "total_count changed while pages were fetched");
    }
    const pageItems = page[itemKey];
    if (!Array.isArray(pageItems) || pageItems.length > PAGE_SIZE) {
      return invalid(
        context,
        `page ${index + 1} has an invalid ${itemKey} array`,
      );
    }
    items.push(...pageItems);
  }

  const total = expectedTotal ?? 0;
  if (total >= SEARCH_RESULT_LIMIT) resultLimit(context);
  const expectedPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages.length !== expectedPages || items.length !== total) {
    return invalid(
      context,
      `pagination is incomplete (${items.length} of ${total} rows across ${pages.length} of ${expectedPages} pages)`,
    );
  }
  return items;
}

function isPaginationSnapshotRace(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("total_count changed while pages were fetched") ||
    message.includes("pagination is incomplete (")
  );
}

async function readStablePaginatedItems(
  api: ApiReader,
  endpoint: string,
  itemKey: "workflow_runs" | "jobs",
  context: string,
): Promise<unknown[]> {
  for (let attempt = 1; attempt <= WORKFLOW_RUN_QUERY_ATTEMPTS; attempt += 1) {
    try {
      return paginatedItems(await api(endpoint), itemKey, context);
    } catch (error) {
      if (
        attempt === WORKFLOW_RUN_QUERY_ATTEMPTS ||
        !isPaginationSnapshotRace(error)
      ) {
        throw error;
      }
    }
  }
  throw new Error(`${context}: pagination retry did not complete`);
}

function parseWorkflowRun(value: unknown, context: string): WorkflowRun {
  const record = asRecord(value);
  if (!record) return invalid(context, "workflow run is not an object");
  const id = requiredInteger(record.id, "id", context);
  const path = requiredString(record.path, "path", context);
  const createdAt = requiredString(record.created_at, "created_at", context);
  if (!Number.isFinite(Date.parse(createdAt))) {
    return invalid(context, `workflow run ${id} has invalid created_at`);
  }
  const updatedAt = requiredString(record.updated_at, "updated_at", context);
  if (!Number.isFinite(Date.parse(updatedAt))) {
    return invalid(context, `workflow run ${id} has invalid updated_at`);
  }
  const name = record.name;
  if (name !== null && typeof name !== "string") {
    return invalid(context, `workflow run ${id} has invalid name`);
  }
  const attempt = requiredInteger(record.run_attempt, "run_attempt", context);
  if (attempt < 1)
    return invalid(context, `workflow run ${id} has invalid run_attempt`);
  const status = requiredString(record.status, "status", context);
  const conclusion = conclusionValue(record.conclusion, "conclusion", context);
  if (status === "completed" && conclusion === null) {
    return invalid(
      context,
      `workflow run ${id} completed without a conclusion`,
    );
  }
  return {
    id,
    name,
    path,
    html_url: requiredString(record.html_url, "html_url", context),
    event: requiredString(record.event, "event", context),
    head_branch: requiredString(record.head_branch, "head_branch", context),
    created_at: createdAt,
    updated_at: updatedAt,
    status,
    conclusion,
    run_attempt: attempt,
  };
}

function parseWorkflowJob(value: unknown, context: string): WorkflowJob {
  const record = asRecord(value);
  if (!record) return invalid(context, "workflow job is not an object");
  const id = requiredInteger(record.id, "id", context);
  const rawSteps = record.steps;
  if (!Array.isArray(rawSteps)) {
    return invalid(context, `workflow job ${id} has invalid steps`);
  }
  const steps = rawSteps.map((rawStep, index): WorkflowStep => {
    const step = asRecord(rawStep);
    if (!step)
      return invalid(
        context,
        `workflow job ${id} step ${index + 1} is not an object`,
      );
    const status = requiredString(step.status, "step.status", context);
    const conclusion = conclusionValue(
      step.conclusion,
      "step.conclusion",
      context,
    );
    if (status === "completed" && conclusion === null) {
      return invalid(
        context,
        `workflow job ${id} step ${index + 1} completed without a conclusion`,
      );
    }
    if (conclusion === "failure" && status !== "completed") {
      return invalid(
        context,
        `workflow job ${id} step ${index + 1} failed without completed status`,
      );
    }
    return {
      name: requiredString(step.name, "step.name", context),
      status,
      conclusion,
    };
  });
  const jobConclusion = conclusionValue(
    record.conclusion,
    "conclusion",
    context,
  );
  if (jobConclusion === "failure" && record.status !== "completed") {
    return invalid(
      context,
      `workflow job ${id} failed without completed status`,
    );
  }
  const completedAt = conclusionValue(
    record.completed_at,
    "completed_at",
    context,
  );
  if (record.status === "completed" && !completedAt) {
    return invalid(
      context,
      `workflow job ${id} completed without completed_at`,
    );
  }
  if (completedAt !== null && !Number.isFinite(Date.parse(completedAt))) {
    return invalid(context, `workflow job ${id} has invalid completed_at`);
  }
  return {
    id,
    run_id: requiredInteger(record.run_id, "run_id", context),
    name: requiredString(record.name, "name", context),
    status: requiredString(record.status, "status", context),
    conclusion: jobConclusion,
    completed_at: completedAt,
    steps,
  };
}

function runListEndpoint(
  event: (typeof EVENTS)[number],
  startDate: string,
  endDate: string,
): string {
  const created = `${startDate}..${endDate}`;
  return `repos/{owner}/{repo}/actions/runs?branch=main&event=${event}&created=${created}&per_page=${PAGE_SIZE}`;
}

function jobsEndpoint(runId: number): string {
  return `repos/{owner}/{repo}/actions/runs/${runId}/jobs?filter=latest&per_page=${PAGE_SIZE}`;
}

function latestWindow(now: Date): {
  since: Date;
  earliestCreatedAt: Date;
  startDate: string;
  endDate: string;
} {
  const since = new Date(now.getTime() - WINDOW_MS);
  // GitHub limits a workflow run to 35 days. Search back that far so a run
  // created before this reporting window is still found if it just concluded.
  const earliestCreatedAt = new Date(since.getTime() - MAX_RUN_DURATION_MS);
  const firstDate = new Date(earliestCreatedAt);
  firstDate.setUTCHours(0, 0, 0, 0);
  return {
    since,
    earliestCreatedAt,
    startDate: firstDate.toISOString().slice(0, 10),
    endDate: now.toISOString(),
  };
}

function isRedMainRun(
  run: WorkflowRun,
  earliestCreatedAt: Date,
  now: Date,
): boolean {
  const createdAt = Date.parse(run.created_at);
  return (
    (run.event === "push" || run.event === "schedule") &&
    run.head_branch === "main" &&
    run.status === "completed" &&
    run.conclusion === "failure" &&
    createdAt >= earliestCreatedAt.getTime() &&
    createdAt <= now.getTime()
  );
}

function runConclusionTime(run: WorkflowRun, jobs: WorkflowJob[]): number {
  if (jobs.length === 0) {
    return Date.parse(run.updated_at);
  }
  const completedAt = jobs.map((job) => {
    if (job.run_id !== run.id) {
      throw new Error(
        `workflow run ${run.id}: jobs response included job ${job.id} from run ${job.run_id}`,
      );
    }
    if (job.status !== "completed" || !job.completed_at) {
      throw new Error(
        `workflow run ${run.id}: job ${job.id} did not report a completion timestamp`,
      );
    }
    return Date.parse(job.completed_at);
  });
  return Math.max(...completedAt);
}

function normalized(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim() || "(unnamed)";
}

function fingerprint(
  workflowPath: string,
  job: string,
  step: string,
  test: string,
): string {
  const stableTest = normalized(test).replace(
    /(\.(?:spec|test)\.[cm]?[jt]sx?):\d+:\d+(?=\s+›)/i,
    "$1",
  );
  const key = JSON.stringify([
    normalized(workflowPath),
    normalized(job),
    test ? `test:${stableTest}` : `step:${normalized(step)}`,
  ]);
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

function rowFor(
  run: WorkflowRun,
  concludedAt: string,
  job: string,
  step: string,
  test = "",
): CiRedRow {
  const workflowPath = normalized(run.path);
  const normalizedJob = normalized(job);
  const normalizedStep = normalized(step);
  return {
    runId: run.id,
    attempt: run.run_attempt,
    createdAt: run.created_at,
    concludedAt,
    workflow: normalized(run.name ?? workflowPath),
    workflowPath,
    job: normalizedJob,
    step: normalizedStep,
    test: normalized(test),
    fingerprintGrain: test
      ? "test"
      : job === "(no failed job reported)"
        ? "workflow"
        : "job-step",
    fingerprint: fingerprint(workflowPath, normalizedJob, normalizedStep, test),
    url: normalized(run.html_url),
  };
}

export function buildCiRedRows(
  runs: WorkflowRun[],
  jobsByRunId: ReadonlyMap<number, WorkflowJob[]>,
  since: Date,
  now: Date,
  testFailuresByRunJob: ReadonlyMap<
    number,
    ReadonlyMap<string, string[]>
  > = new Map(),
): CiRedRow[] {
  const rows: CiRedRow[] = [];
  for (const run of runs) {
    if (
      (run.event !== "push" && run.event !== "schedule") ||
      run.head_branch !== "main" ||
      run.status !== "completed" ||
      run.conclusion !== "failure" ||
      Date.parse(run.created_at) > now.getTime()
    )
      continue;
    const jobs = jobsByRunId.get(run.id);
    if (!jobs)
      throw new Error(`workflow run ${run.id}: jobs were not inspected`);
    const concludedAtMs = runConclusionTime(run, jobs);
    if (concludedAtMs < since.getTime() || concludedAtMs > now.getTime())
      continue;
    const concludedAt = new Date(concludedAtMs).toISOString();
    const failedJobs = jobs.filter((job) => job.conclusion === "failure");
    if (failedJobs.length === 0) {
      rows.push(
        rowFor(
          run,
          concludedAt,
          "(no failed job reported)",
          "(workflow-level failure)",
        ),
      );
      continue;
    }
    for (const job of failedJobs) {
      const testFailures =
        testFailuresByRunJob.get(run.id)?.get(job.name) ?? [];
      if (testFailures.length > 0) {
        const failedStep =
          job.steps.find((step) => step.conclusion === "failure")?.name ??
          "(failed test)";
        for (const test of testFailures) {
          rows.push(rowFor(run, concludedAt, job.name, failedStep, test));
        }
        continue;
      }
      const failedSteps = job.steps.filter(
        (step) => step.conclusion === "failure",
      );
      if (failedSteps.length === 0) {
        rows.push(
          rowFor(
            run,
            concludedAt,
            job.name,
            "(job failed without a failed step)",
          ),
        );
      } else {
        for (const step of failedSteps)
          rows.push(rowFor(run, concludedAt, job.name, step.name));
      }
    }
  }
  return rows.sort(
    (left, right) =>
      left.runId - right.runId ||
      left.workflowPath.localeCompare(right.workflowPath) ||
      left.job.localeCompare(right.job) ||
      left.step.localeCompare(right.step) ||
      left.test.localeCompare(right.test),
  );
}

export function parseFailedTestNames(log: string): Map<string, string[]> {
  const annotations = new Map<string, Set<string>>();
  const summaries = new Map<string, { failed: number; flaky: number }>();
  for (const line of log.split("\n")) {
    const [rawJob, , ...messageParts] = line.split("\t");
    if (!rawJob || messageParts.length === 0) continue;
    const job = normalized(rawJob);
    const rawMessage = messageParts
      .join("\t")
      .replace(/^\d{4}-\d{2}-\d{2}T[^\s]+\s*/, "");
    const isErrorAnnotation = /^##\[error\]\s*/.test(rawMessage);
    const message = rawMessage
      .replace(/^\d{4}-\d{2}-\d{2}T[^\s]+\s*/, "")
      .replace(/^##\[(?:error|notice|warning)\]\s*/, "")
      .trim();
    const failedCount = message.match(/(?:^|[,;\s])(\d+)\s+failed\b/i);
    const flakyCount = message.match(/(?:^|[,;\s])(\d+)\s+flaky\b/i);
    if (failedCount || flakyCount) {
      summaries.set(job, {
        failed: Number(failedCount?.[1] ?? 0),
        flaky: Number(flakyCount?.[1] ?? 0),
      });
      continue;
    }
    if (!isErrorAnnotation) continue;
    const match = message.match(/^(?:\d+\)\s+)?\[([^\]]+)\]\s+›\s+(.+?)\s*$/);
    if (!match) continue;
    const test = `${normalized(match[1])} :: ${normalized(match[2])}`;
    const names = annotations.get(job) ?? new Set<string>();
    names.add(test);
    annotations.set(job, names);
  }
  const failures = new Map<string, string[]>();
  for (const [job, summary] of summaries) {
    const names = annotations.get(job);
    if (
      summary.failed > 0 &&
      summary.flaky === 0 &&
      names?.size === summary.failed
    ) {
      failures.set(job, [...names].sort());
    }
  }
  return failures;
}

function mayContainTestFailures(
  run: WorkflowRun,
  jobs: WorkflowJob[],
): boolean {
  const testSignal = /(?:test|e2e|vitest|playwright|shard|spec)/i;
  return (
    testSignal.test(`${run.name ?? ""} ${run.path}`) ||
    jobs.some(
      (job) =>
        testSignal.test(job.name) ||
        job.steps.some((step) => testSignal.test(step.name)),
    )
  );
}

async function readPaginatedRuns(
  api: ApiReader,
  event: (typeof EVENTS)[number],
  startDate: string,
  endDate: string,
): Promise<WorkflowRun[]> {
  const context = `${event} main workflow runs`;
  try {
    const endpoint = runListEndpoint(event, startDate, endDate);
    return (
      await readStablePaginatedItems(api, endpoint, "workflow_runs", context)
    ).map((run) => parseWorkflowRun(run, context));
  } catch (error) {
    const code = asRecord(error)?.code;
    if (code !== "GITHUB_RESULT_LIMIT") throw error;
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    const startDay = new Date(startMs);
    startDay.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(endMs);
    endDay.setUTCHours(0, 0, 0, 0);
    if (startDay.getTime() === endDay.getTime()) {
      return invalid(
        context,
        `single calendar day ${startDay.toISOString().slice(0, 10)} reached GitHub's ${SEARCH_RESULT_LIMIT}-row search limit; completeness cannot be proved`,
      );
    }

    const days =
      Math.floor((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
    const leftDays = Math.floor(days / 2);
    const splitDate = new Date(startDay.getTime() + leftDays * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const leftEnd = new Date(startDay.getTime() + (leftDays - 1) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const [left, right] = await Promise.all([
      readPaginatedRuns(api, event, startDate, leftEnd),
      readPaginatedRuns(api, event, splitDate, endDate),
    ]);
    return [...left, ...right];
  }
}

async function readPaginatedJobs(
  api: ApiReader,
  runId: number,
): Promise<WorkflowJob[]> {
  const context = `workflow run ${runId} jobs`;
  const raw = await api(jobsEndpoint(runId));
  const jobs = paginatedItems(raw, "jobs", context).map((job) =>
    parseWorkflowJob(job, context),
  );
  for (const job of jobs) {
    if (job.run_id !== runId) {
      throw new Error(
        `${context}: jobs response included job ${job.id} from run ${job.run_id}`,
      );
    }
  }
  return jobs;
}

async function mapConcurrent<T, U>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  let didFail = false;
  let failure: unknown;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (!didFail && nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await mapper(values[index]);
        } catch (error) {
          didFail = true;
          failure = error;
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  if (didFail) throw failure;
  return results;
}

async function rowsFromApi(
  api: ApiReader,
  now: Date,
  failedRunLog: FailedRunLogReader,
  warnings: string[],
): Promise<CiRedRow[]> {
  const { since, earliestCreatedAt, startDate, endDate } = latestWindow(now);
  const runPages = await mapConcurrent(EVENTS, EVENTS.length, (event) =>
    readPaginatedRuns(api, event, startDate, endDate),
  );
  const runs = runPages.flat();
  const redRuns = runs.filter(
    (run) =>
      isRedMainRun(run, earliestCreatedAt, now) &&
      Date.parse(run.updated_at) >= since.getTime() &&
      Date.parse(run.updated_at) <= now.getTime(),
  );
  const uniqueRunIds = new Set<number>();
  for (const run of redRuns) {
    if (uniqueRunIds.has(run.id)) {
      throw new Error(
        `workflow run ${run.id}: duplicate run returned by date/event queries`,
      );
    }
    uniqueRunIds.add(run.id);
  }
  const jobs = await mapConcurrent(redRuns, 8, (run) =>
    readPaginatedJobs(api, run.id),
  );
  const jobsByRunId = new Map(
    redRuns.map((run, index) => [run.id, jobs[index]]),
  );
  const logRuns = redRuns.filter((run) =>
    mayContainTestFailures(run, jobsByRunId.get(run.id) ?? []),
  );
  const logs = await mapConcurrent(logRuns, 4, async (run) => {
    try {
      const log = await failedRunLog(run.id);
      if (log === null || log.length === 0) {
        return [run.id, null, "gh returned no failed-run log content"] as const;
      }
      return [run.id, parseFailedTestNames(log), null] as const;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return [run.id, null, detail] as const;
    }
  });
  const testFailuresByRunJob = new Map<number, Map<string, string[]>>();
  for (const [runId, failures, unavailable] of logs) {
    if (failures) testFailuresByRunJob.set(runId, failures);
    if (unavailable) {
      warnings.push(
        `run ${runId}: failed-run log unavailable (${unavailable}); keeping job-step fingerprints`,
      );
    }
  }
  return buildCiRedRows(redRuns, jobsByRunId, since, now, testFailuresByRunJob);
}

function tsvField(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function renderCiRedReport(rows: CiRedRow[]): string {
  const header =
    "workflow\tworkflow_path\tjob\tstep\ttest\tfingerprint_grain\tfingerprint\trun_count\truns_json";
  const grouped = new Map<string, Map<string, CiRedRow>>();
  for (const row of rows) {
    const key = `${row.workflowPath}\u0000${row.fingerprint}`;
    const attempts = grouped.get(key) ?? new Map<string, CiRedRow>();
    attempts.set(`${row.runId}\u0000${row.attempt}`, row);
    grouped.set(key, attempts);
  }
  const groups = [...grouped.values()].map((attempts) => {
    const orderedRuns = [...attempts.values()].sort(
      (left, right) =>
        Date.parse(right.concludedAt) - Date.parse(left.concludedAt) ||
        right.runId - left.runId ||
        right.attempt - left.attempt,
    );
    return { row: orderedRuns[0], runs: orderedRuns };
  });
  const workflowPriority = (row: CiRedRow): number => {
    const workflow = `${row.workflow} ${row.workflowPath}`.toLowerCase();
    if (workflow.includes("design-e2e")) return 0;
    if (/\b(e2e|ci|test|build|lint|typecheck)\b/.test(workflow)) return 1;
    return 2;
  };
  groups.sort(
    (left, right) =>
      workflowPriority(left.row) - workflowPriority(right.row) ||
      right.runs.length - left.runs.length ||
      left.row.workflowPath.localeCompare(right.row.workflowPath) ||
      left.row.fingerprint.localeCompare(right.row.fingerprint),
  );
  const body = groups.map(({ row, runs }) =>
    [
      tsvField(row.workflow),
      tsvField(row.workflowPath),
      tsvField(row.job),
      tsvField(row.step),
      tsvField(row.test),
      row.fingerprintGrain,
      tsvField(row.fingerprint),
      String(runs.length),
      tsvField(
        JSON.stringify(
          runs.map((run) => ({
            runId: run.runId,
            attempt: run.attempt,
            createdAt: run.createdAt,
            concludedAt: run.concludedAt,
            url: run.url,
          })),
        ),
      ),
    ].join("\t"),
  );
  if (groups.length === 0) {
    body.push(
      "# no push-to-main or scheduled failures concluded in the last 5 days",
    );
  }
  return `${[header, ...body].join("\n")}\n`;
}

export function readGhApi(endpoint: string): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    execFile(
      "gh",
      ["api", "--paginate", "--slurp", endpoint],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolveOutput(stdout);
          return;
        }
        const apiError = typeof stderr === "string" ? stderr.trim() : "";
        const message = error instanceof Error ? error.message : String(error);
        rejectOutput(
          new Error(`gh api failed for ${endpoint}: ${apiError || message}`, {
            cause: error,
          }),
        );
      },
    );
  });
}

function readGhFailedRunLog(runId: number): Promise<string | null> {
  return new Promise((resolveLog, rejectLog) => {
    execFile(
      "gh",
      ["run", "view", "--log-failed", String(runId)],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolveLog(stdout);
          return;
        }
        const detail = typeof stderr === "string" ? stderr.trim() : "";
        const message = error instanceof Error ? error.message : String(error);
        rejectLog(new Error(detail || message, { cause: error }));
      },
    );
  });
}

export async function runCiRedReportCli(
  options: {
    api?: ApiReader;
    failedRunLog?: FailedRunLogReader;
    now?: Date;
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
  } = {},
): Promise<number> {
  const api = options.api ?? readGhApi;
  const now = options.now ?? new Date();
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));
  try {
    const warnings: string[] = [];
    const rows = await rowsFromApi(
      api,
      now,
      options.failedRunLog ?? readGhFailedRunLog,
      warnings,
    );
    for (const warning of warnings)
      stderr(`[ci-red-report] warning: ${warning}\n`);
    stdout(renderCiRedReport(rows));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`[ci-red-report] could not inspect CI failures: ${message}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void runCiRedReportCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
