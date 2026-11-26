import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { verifyActiveReleaseCoordinator } from "./release-coordinator.ts";

export type RequiredCheckStatus = {
  name: string;
  bucket: string;
};

type RequiredCheckState =
  | { status: "pending"; missing: string[]; pending: string[] }
  | { status: "passed" }
  | { status: "failed"; reason: string };

type WaitForRequiredChecksOptions = {
  readRequiredContexts: () => Promise<string[]>;
  readStatuses: () => Promise<RequiredCheckStatus[]>;
  readExactHead?: () => Promise<RequiredCheckState>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
  readRetryDelaysMs?: number[];
  verifyCoordinator?: (expectedRunId?: number) => Promise<number | undefined>;
  coordinatorCheckIntervalMs?: number;
};

const DEFAULT_READ_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
export const DEFAULT_REQUIRED_CHECK_TIMEOUT_MS = 240 * 60_000;
export const COORDINATED_RELEASE_CHECK_TIMEOUT_MS = 210 * 60_000;

export function requiredCheckTimeoutForEvent(eventName: string | undefined) {
  return eventName === "pull_request"
    ? COORDINATED_RELEASE_CHECK_TIMEOUT_MS
    : DEFAULT_REQUIRED_CHECK_TIMEOUT_MS;
}

export function requiredContextsFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) {
    throw new Error("GitHub returned invalid branch rules for main.");
  }

  const ruleEntries = rules.every(Array.isArray) ? rules.flat() : rules;
  const contexts = new Set<string>();
  for (const candidate of ruleEntries) {
    if (candidate === null || typeof candidate !== "object") {
      throw new Error("GitHub returned an invalid branch rule for main.");
    }
    const rule = candidate as {
      type?: unknown;
      parameters?: { required_status_checks?: unknown };
    };
    if (rule?.type !== "required_status_checks") continue;
    const requiredChecks = rule.parameters?.required_status_checks;
    if (!Array.isArray(requiredChecks)) {
      throw new Error(
        "GitHub returned an invalid required-check rule for main.",
      );
    }
    for (const candidateCheck of requiredChecks) {
      if (candidateCheck === null || typeof candidateCheck !== "object") {
        throw new Error("GitHub returned an invalid required check for main.");
      }
      const check = candidateCheck as {
        context?: unknown;
        integration_id?: unknown;
      };
      if (typeof check?.context !== "string" || check.context.trim() === "") {
        throw new Error(
          "GitHub returned a required check without a context name.",
        );
      }
      if (check.integration_id !== undefined && check.integration_id !== null) {
        if (
          !Number.isSafeInteger(check.integration_id) ||
          (check.integration_id as number) <= 0
        ) {
          throw new Error(
            `GitHub returned an invalid integration binding for required status check ${check.context}.`,
          );
        }
        throw new Error(
          `Required status check ${check.context} is bound to GitHub App ${check.integration_id}, but this gate cannot verify check provenance; refusing release PR merge.`,
        );
      }
      contexts.add(check.context);
    }
  }

  if (contexts.size === 0) {
    throw new Error(
      "No required status checks are configured for main; refusing release PR merge.",
    );
  }
  return [...contexts].sort();
}

function isGitHubCommandFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    ("status" in error || "stderr" in error || "code" in error)
  );
}

function readFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    if (stderr) return stderr;
  }
  return error.message;
}

async function retryGitHubRead<T>(
  label: string,
  read: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  retryDelaysMs: number[],
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!isGitHubCommandFailure(error)) throw error;
      const delayMs = retryDelaysMs[attempt];
      if (delayMs === undefined) {
        throw new Error(
          `${label} failed after ${attempt + 1} attempts: ${readFailureMessage(error)}`,
          { cause: error },
        );
      }
      await sleep(delayMs);
    }
  }
}

export function evaluateRequiredChecks(
  requiredContexts: string[],
  statuses: RequiredCheckStatus[],
): RequiredCheckState {
  const required = new Set(requiredContexts);
  if (required.size === 0) {
    return {
      status: "failed",
      reason: "No required status checks are configured for main.",
    };
  }

  const byName = new Map<string, string>();
  for (const check of statuses) {
    if (!required.has(check.name)) continue;
    if (byName.has(check.name)) {
      return {
        status: "failed",
        reason: `GitHub returned more than one result for required check ${check.name}.`,
      };
    }
    byName.set(check.name, check.bucket);
  }

  const failed = [...required].filter((name) => {
    const bucket = byName.get(name);
    return (
      bucket !== undefined &&
      bucket !== "pass" &&
      bucket !== "skipping" &&
      bucket !== "pending"
    );
  });
  if (failed.length > 0) {
    return {
      status: "failed",
      reason: `Required release PR checks are not green: ${failed.join(", ")}.`,
    };
  }

  const missing = [...required].filter((name) => !byName.has(name));
  const pending = [...required].filter(
    (name) => byName.get(name) === "pending",
  );
  if (missing.length > 0 || pending.length > 0) {
    return { status: "pending", missing, pending };
  }
  return { status: "passed" };
}

export async function waitForRequiredChecks({
  readRequiredContexts,
  readStatuses,
  readExactHead,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = DEFAULT_REQUIRED_CHECK_TIMEOUT_MS,
  intervalMs = 15_000,
  readRetryDelaysMs = DEFAULT_READ_RETRY_DELAYS_MS,
  verifyCoordinator,
  coordinatorCheckIntervalMs = 60_000,
}: WaitForRequiredChecksOptions): Promise<number | undefined> {
  const deadline = now() + timeoutMs;
  let coordinatorRunId: number | undefined;
  let nextCoordinatorCheckAt = Number.NEGATIVE_INFINITY;
  const checkCoordinator = async (force = false) => {
    if (!verifyCoordinator || (!force && now() < nextCoordinatorCheckAt))
      return;
    const verifiedRunId = await retryGitHubRead(
      "Verifying the active Release everything coordinator",
      () => verifyCoordinator(coordinatorRunId),
      sleep,
      readRetryDelaysMs,
    );
    if (coordinatorRunId !== undefined && verifiedRunId !== coordinatorRunId) {
      throw new Error(
        "The active Release everything coordinator changed during the wait.",
      );
    }
    coordinatorRunId ??= verifiedRunId;
    nextCoordinatorCheckAt = now() + coordinatorCheckIntervalMs;
  };

  await checkCoordinator(true);
  const requiredContexts = await retryGitHubRead(
    "Reading required status checks for main",
    readRequiredContexts,
    sleep,
    readRetryDelaysMs,
  );
  if (requiredContexts.length === 0) {
    throw new Error(
      "No required status checks are configured for main; refusing release PR merge.",
    );
  }

  let lastState: RequiredCheckState = {
    status: "pending",
    missing: requiredContexts,
    pending: [],
  };

  while (true) {
    await checkCoordinator();
    const statuses = await retryGitHubRead(
      "Reading required release PR check results",
      readStatuses,
      sleep,
      readRetryDelaysMs,
    );
    lastState = evaluateRequiredChecks(requiredContexts, statuses);
    if (lastState.status === "passed" && readExactHead) {
      lastState = await retryGitHubRead(
        "Reading exact release head checks",
        readExactHead,
        sleep,
        readRetryDelaysMs,
      );
    }
    if (lastState.status === "passed") return coordinatorRunId;
    if (lastState.status === "failed") throw new Error(lastState.reason);

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  const waiting = [
    ...lastState.missing.map((name) => `${name} (not reported)`),
    ...lastState.pending,
  ];
  throw new Error(
    `Timed out waiting for required release PR checks: ${waiting.join(", ")}.`,
  );
}

function ghJson<T>(args: string[], token?: string): T {
  const stdout = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: token ? { ...process.env, GH_TOKEN: token } : undefined,
  });
  return JSON.parse(stdout) as T;
}

function readRequiredContexts(repo: string): string[] {
  const rules = ghJson<unknown>([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/rules/branches/main`,
  ]);
  return requiredContextsFromRules(rules);
}

function readStatuses(prNumber: string, repo: string): RequiredCheckStatus[] {
  try {
    const statuses = ghJson<unknown>([
      "pr",
      "checks",
      prNumber,
      "--repo",
      repo,
      "--required",
      "--json",
      "name,bucket",
    ]);
    if (
      !Array.isArray(statuses) ||
      !statuses.every(
        (status) =>
          status !== null &&
          typeof status === "object" &&
          "name" in status &&
          typeof status.name === "string" &&
          "bucket" in status &&
          typeof status.bucket === "string",
      )
    ) {
      throw new Error(
        "GitHub returned invalid required release PR check results.",
      );
    }
    return statuses as RequiredCheckStatus[];
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    if (/no (?:required )?checks reported(?: on the .+ branch)?/i.test(stderr))
      return [];
    throw error;
  }
}

function allHeadRows(pages: unknown, field: "check_runs" | "workflow_runs") {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`GitHub returned no exact release head ${field} pages.`);
  }
  const rows: {
    id: number;
    name: string;
    head_sha: string;
    status: string;
    conclusion: string | null;
  }[] = [];
  const total = pages[0]?.total_count;
  for (const page of pages) {
    if (
      !Number.isSafeInteger(total) ||
      page?.total_count !== total ||
      !Array.isArray(page[field])
    ) {
      throw new Error(
        `GitHub returned unstable exact release head ${field} pages.`,
      );
    }
    rows.push(...page[field]);
  }
  if (
    rows.length !== total ||
    new Set(rows.map((row) => row?.id)).size !== total
  ) {
    throw new Error(`GitHub returned incomplete exact release head ${field}.`);
  }
  return rows;
}

export function evaluateExactReleaseHead(
  head: string,
  checks: unknown,
  runs: unknown,
  combinedStatus: { sha: string; state: string; total_count: number },
): RequiredCheckState {
  const rows = [
    ...allHeadRows(checks, "check_runs"),
    ...allHeadRows(runs, "workflow_runs"),
  ];
  const pending: string[] = [];
  const failed: string[] = [];
  if (
    combinedStatus?.sha !== head ||
    !Number.isSafeInteger(combinedStatus.total_count) ||
    combinedStatus.total_count < 0 ||
    !["pending", "success", "failure"].includes(combinedStatus.state)
  ) {
    throw new Error("GitHub returned an invalid combined release head status.");
  }
  if (combinedStatus.total_count && combinedStatus.state === "failure")
    failed.push("commit status");
  if (combinedStatus.total_count && combinedStatus.state === "pending")
    pending.push("commit status");
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row?.id) ||
      !row.name ||
      row.head_sha !== head ||
      typeof row.status !== "string"
    ) {
      throw new Error(
        "GitHub returned a check or run for the wrong release head.",
      );
    }
    if (row.status !== "completed") pending.push(row.name);
    else if (row.conclusion !== "success" && row.conclusion !== "skipped")
      failed.push(row.name);
  }
  if (failed.length) {
    return {
      status: "failed",
      reason: `Exact release head checks are red: ${failed.join(", ")}.`,
    };
  }
  if (pending.length || !rows.length) {
    return {
      status: "pending",
      pending,
      missing: rows.length ? [] : ["exact head results"],
    };
  }
  return { status: "passed" };
}

function readExactReleaseHead(repo: string, head: string): RequiredCheckState {
  if (!/^[a-f0-9]{40}$/.test(head))
    throw new Error("Expected a full release head SHA.");
  const token = process.env.GH_ACTIONS_TOKEN;
  const all = (path: string) =>
    ghJson<unknown>(["api", "--paginate", "--slurp", path], token);
  return evaluateExactReleaseHead(
    head,
    all(`repos/${repo}/commits/${head}/check-runs?filter=all&per_page=100`),
    all(`repos/${repo}/actions/runs?head_sha=${head}&per_page=100`),
    ghJson(["api", `repos/${repo}/commits/${head}/status?per_page=1`], token),
  );
}

async function main(): Promise<void> {
  const [mode, prNumber, repo] = process.argv.slice(2);
  if (!(["wait", "verify"] as string[]).includes(mode) || !prNumber || !repo) {
    throw new Error(
      "Usage: release-required-checks.ts <wait|verify> <pr-number> <owner/repo>",
    );
  }

  const readCurrentContexts = async () => readRequiredContexts(repo);
  const readCurrentStatuses = async () => readStatuses(prNumber, repo);
  const head = process.env.HEAD_SHA;
  const readExactHead = head
    ? async () => readExactReleaseHead(repo, head)
    : undefined;
  const eventName = process.env.RELEASE_EVENT_NAME;
  if (
    eventName !== undefined &&
    eventName !== "pull_request" &&
    eventName !== "workflow_dispatch"
  ) {
    throw new Error(`Unsupported release auto-merge event: ${eventName}.`);
  }

  const dispatchCoordinator = process.env.DISPATCHED_COORDINATOR_RUN_ID;
  const dispatchedCoordinatorId = dispatchCoordinator
    ? Number(dispatchCoordinator)
    : undefined;
  if (
    dispatchCoordinator &&
    (eventName !== "workflow_dispatch" ||
      !Number.isSafeInteger(dispatchedCoordinatorId) ||
      Number(dispatchedCoordinatorId) <= 0)
  ) {
    throw new Error("The dispatched Release everything run ID is invalid.");
  }

  let coordinatorUpdatedAt: string | undefined;
  if (eventName === "pull_request" || dispatchedCoordinatorId !== undefined) {
    coordinatorUpdatedAt = process.env.PR_UPDATED_AT;
    if (!coordinatorUpdatedAt) {
      throw new Error(
        "The release PR update time is required to verify its coordinator.",
      );
    }
  }
  const expectedCoordinatorRunId = process.env.EXPECTED_COORDINATOR_RUN_ID
    ? Number(process.env.EXPECTED_COORDINATOR_RUN_ID)
    : undefined;
  if (
    process.env.EXPECTED_COORDINATOR_RUN_ID &&
    !Number.isSafeInteger(expectedCoordinatorRunId)
  ) {
    throw new Error("The expected Release everything run ID is invalid.");
  }
  if (
    dispatchedCoordinatorId !== undefined &&
    expectedCoordinatorRunId !== undefined &&
    dispatchedCoordinatorId !== expectedCoordinatorRunId
  ) {
    throw new Error(
      "The release checker selected a different Release everything run.",
    );
  }
  const verifyCoordinator = coordinatorUpdatedAt
    ? (expectedRunId?: number) =>
        Promise.resolve(
          verifyActiveReleaseCoordinator(
            repo,
            coordinatorUpdatedAt as string,
            expectedRunId ?? dispatchedCoordinatorId,
          ),
        )
    : undefined;

  if (mode === "wait") {
    const coordinatorRunId = await waitForRequiredChecks({
      readRequiredContexts: readCurrentContexts,
      readStatuses: readCurrentStatuses,
      readExactHead,
      verifyCoordinator,
      timeoutMs: requiredCheckTimeoutForEvent(
        dispatchedCoordinatorId ? "pull_request" : eventName,
      ),
    });
    if (coordinatorRunId !== undefined)
      process.stdout.write(`${coordinatorRunId}\n`);
    return;
  }

  if (verifyCoordinator) {
    if (expectedCoordinatorRunId === undefined) {
      throw new Error(
        "The expected Release everything run ID is required before verification.",
      );
    }
    await retryGitHubRead(
      "Verifying the active Release everything coordinator",
      () => verifyCoordinator(expectedCoordinatorRunId),
      (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      DEFAULT_READ_RETRY_DELAYS_MS,
    );
  }

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
  const retryDelaysMs = DEFAULT_READ_RETRY_DELAYS_MS;
  let state = evaluateRequiredChecks(
    await retryGitHubRead(
      "Reading required status checks for main",
      readCurrentContexts,
      sleep,
      retryDelaysMs,
    ),
    await retryGitHubRead(
      "Reading required release PR check results",
      readCurrentStatuses,
      sleep,
      retryDelaysMs,
    ),
  );
  if (state.status === "passed" && readExactHead) {
    state = await retryGitHubRead(
      "Reading exact release head checks",
      readExactHead,
      sleep,
      retryDelaysMs,
    );
  }
  if (state.status !== "passed") {
    throw new Error(
      state.status === "failed"
        ? state.reason
        : `Required release PR checks are missing or pending: ${[
            ...state.missing,
            ...state.pending,
          ].join(", ")}.`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `::error::${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
