import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PullRequestContext = {
  title: string;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
};

export type GuardResult = {
  exitCode: 0 | 1 | 2;
  message: string;
};

type DiffReader = (baseSha: string, headSha: string) => string;

const failure = (exitCode: 1 | 2, message: string): GuardResult => ({
  exitCode,
  message: `::error::guard-test-title-production: ${message}`,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function readPullRequestContext(
  eventName: string | undefined,
  event: unknown,
): PullRequestContext | GuardResult {
  if (eventName !== "pull_request") {
    return failure(
      2,
      `expected a pull_request event, received ${eventName ?? "no event name"}`,
    );
  }

  const pullRequest = isRecord(event) ? event.pull_request : undefined;
  const base = isRecord(pullRequest) ? pullRequest.base : undefined;
  const head = isRecord(pullRequest) ? pullRequest.head : undefined;
  const title = isRecord(pullRequest) ? pullRequest.title : undefined;
  const baseRef = isRecord(base) ? base.ref : undefined;
  const baseSha = isRecord(base) ? base.sha : undefined;
  const headRef = isRecord(head) ? head.ref : undefined;
  const headSha = isRecord(head) ? head.sha : undefined;

  if (
    typeof title !== "string" ||
    typeof baseRef !== "string" ||
    baseRef.length === 0 ||
    typeof headRef !== "string" ||
    headRef.length === 0 ||
    typeof baseSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(baseSha) ||
    typeof headSha !== "string" ||
    !/^[0-9a-f]{40}$/i.test(headSha)
  ) {
    return failure(
      2,
      "pull_request event is missing a title, base/head ref, or full commit SHA",
    );
  }

  return { title, baseRef, baseSha, headRef, headSha };
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?(?:\.snap)?$/i;
const TEST_WORKFLOW_PATHS = new Set([
  ".github/workflows/design-e2e.yml",
  ".github/actions/design-e2e/action.yml",
]);
const TEST_CONFIG_PATHS = new Set([
  "templates/design/playwright.config.ts",
  "templates/design/playwright.config.mts",
]);
const TEST_TOOLING_PATHS = new Set([
  "scripts/test-title-production-harness.ts",
]);
const TEST_DOCUMENTATION_PATHS = new Set(["templates/design/e2e/README.md"]);
const PROTECTED_PATHS = new Set([
  ".github/workflows/ci.yml",
  "scripts/ci-change-scope.ts",
  "scripts/ci-change-scope.test.ts",
  "scripts/ci-test-lanes.ts",
  "scripts/run-guards.ts",
]);

const SAFE_FIXTURE_EXTENSIONS =
  /\.(?:json|ya?ml|txt|html?|css|svg|png|jpe?g|webp|gif|snap)$/i;

function isStaticFixturePath(path: string): boolean {
  const segments = path.split("/");
  if (
    !segments.some((segment) =>
      /^(?:__fixtures__|fixtures|test-data|testdata|__snapshots__|snapshots)$/i.test(
        segment,
      ),
    )
  ) {
    return false;
  }
  return SAFE_FIXTURE_EXTENSIONS.test(path);
}

function isTestSourcePath(path: string): boolean {
  return TEST_FILE.test(path) && /\.(?:[cm]?[jt]sx?|snap)$/i.test(path);
}

export function isTestOnlyPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return false;
  }

  if (
    PROTECTED_PATHS.has(normalized) ||
    normalized.startsWith("scripts/guard-") ||
    (normalized.startsWith(".github/workflows/") &&
      !TEST_WORKFLOW_PATHS.has(normalized))
  ) {
    return false;
  }

  if (TEST_WORKFLOW_PATHS.has(normalized)) return true;
  if (TEST_CONFIG_PATHS.has(normalized)) return true;
  if (TEST_TOOLING_PATHS.has(normalized)) return true;
  if (TEST_DOCUMENTATION_PATHS.has(normalized)) return true;
  return isTestSourcePath(normalized) || isStaticFixturePath(normalized);
}

function parseChangedPaths(diffOutput: string): string[] | GuardResult {
  if (diffOutput === "") return [];
  if (!diffOutput.endsWith("\0")) {
    return failure(2, "git diff returned an unreadable path list");
  }

  const paths = diffOutput.slice(0, -1).split("\0");
  if (paths.some((path) => path.length === 0)) {
    return failure(2, "git diff returned an empty path in its path list");
  }
  return paths;
}

export function runTestTitleGuard(
  eventName: string | undefined,
  event: unknown,
  readDiff: DiffReader,
): GuardResult {
  if (eventName !== "pull_request") {
    return {
      exitCode: 0,
      message:
        "guard-test-title-production: SKIPPED; only pull_request events have a PR title to inspect.",
    };
  }

  const context = readPullRequestContext(eventName, event);
  if ("exitCode" in context) return context;

  if (!/^test:/i.test(context.title)) {
    return {
      exitCode: 0,
      message:
        "guard-test-title-production: SKIPPED; PR title does not start with test:.",
    };
  }

  let diffOutput: string;
  try {
    diffOutput = readDiff(context.baseSha, context.headSha);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(2, `could not read the PR diff: ${detail}`);
  }

  const paths = parseChangedPaths(diffOutput);
  if (!Array.isArray(paths)) return paths;

  const productionPaths = paths.filter((path) => !isTestOnlyPath(path));
  if (productionPaths.length > 0) {
    return failure(
      1,
      `PR title starts with test: but production-code paths changed:\n${productionPaths
        .map((path) => `  - ${path}`)
        .join("\n")}`,
    );
  }

  return {
    exitCode: 0,
    message: `guard-test-title-production: passed; checked ${paths.length} changed path(s) for test: PR.`,
  };
}

function readGitDiff(baseSha: string, headSha: string, cwd: string): string {
  const result = spawnSync(
    "git",
    [
      "diff",
      "--no-ext-diff",
      "--no-renames",
      "--name-only",
      "-z",
      `${baseSha}...${headSha}`,
    ],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `git diff exited with status ${result.status}`,
    );
  }
  return result.stdout;
}

function main(): void {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    const result = runTestTitleGuard(
      process.env.GITHUB_EVENT_NAME,
      undefined,
      () => "",
    );
    console.log(result.message);
    process.exitCode = result.exitCode;
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    const result = failure(2, "GITHUB_EVENT_PATH is not set");
    console.error(result.message);
    process.exitCode = result.exitCode;
    return;
  }

  let event: unknown;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const result = failure(
      2,
      `could not read the GitHub event payload: ${detail}`,
    );
    console.error(result.message);
    process.exitCode = result.exitCode;
    return;
  }

  const result = runTestTitleGuard(
    process.env.GITHUB_EVENT_NAME,
    event,
    (baseSha, headSha) => readGitDiff(baseSha, headSha, process.cwd()),
  );
  (result.exitCode === 0 ? console.log : console.error)(result.message);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  main();
}
