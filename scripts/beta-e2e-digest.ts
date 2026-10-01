#!/usr/bin/env node
/**
 * Failure digest for the scheduled beta E2E run.
 *
 * Turns a run's Playwright results.json files, its jobs and artifact lists, and
 * the previous run's state into three things an engineer or an agent can act on
 * without opening a log: a GitHub issue body, a short Slack message, and a
 * hidden state marker that the next run diffs against. It also decides whether
 * anyone needs to be told (green to red, new failures, recovery, or a daily
 * reminder), so an unchanged red run stays quiet.
 *
 * Rules this file holds itself to:
 *   - A job that failed or was cancelled without producing results is reported
 *     as an explicit fact, never as an empty set of failures.
 *   - A test that failed last time is FIXED only when it executed and passed in
 *     this run. One that did not run (its slot stopped at maxFailures or the
 *     global timeout, was skipped, produced no results, or no longer exists) is
 *     NOT RUN: carried forward as unverified, never reported as fixed, and
 *     never counted as a new failure when it fails again.
 *   - Flaky tests (passed on retry) and advisory-lane findings are listed but
 *     neither fail the run nor page anyone.
 *
 * Runs under `tsx` and under `node --experimental-strip-types` (the workflow's
 * report job has no install step), so: node built-ins only, no enums, no
 * parameter properties, type-only imports spelled `import type`.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_TITLE = "[beta-e2e] Scheduled beta health check failing";
export const ISSUE_LABELS = ["beta-e2e", "qa"];
export const ISSUE_BODY_BUDGET = 60_000;
const STATE_MARKER_PREFIX = "<!-- beta-e2e-state:v1 ";
const STATE_MARKER_SUFFIX = " -->";
// ponytail: the marker tracks the first 120 failures so it stays a few KB inside
// GitHub's 64k body cap. Past that (a catastrophic run) the tail is untracked
// and reads as NEW each run; raise it or move the state to an artifact if that
// ever happens in practice.
const STATE_MAX_ENTRIES = 120;
const ERROR_LINE_MAX = 200;
const REMINDER_HOURS = 24;

export type FailureClass = "env" | "product" | "infra-timeout" | "unclassified";

export interface RunJob {
  id: number;
  name: string;
  html_url: string;
  conclusion: string | null;
  status?: string;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
}

export interface RunArtifact {
  id: number;
  name: string;
  expired?: boolean;
}

export interface TestFailure {
  key: string;
  slot: string;
  app: string;
  project: string;
  file: string;
  line: number;
  title: string;
  grep: string;
  error: string;
  detail: string;
  attachments: string[];
  class: FailureClass;
}

export interface FlakyTest {
  slot: string;
  app: string;
  project: string;
  file: string;
  line: number;
  title: string;
}

export interface SetupError {
  key: string;
  slot: string;
  error: string;
  detail: string;
  class: FailureClass;
}

export interface SlotResults {
  slot: string;
  artifactName: string;
  stats: {
    expected: number;
    skipped: number;
    unexpected: number;
    flaky: number;
    /** Skipped although the suite expected them to run (a stopped or timed-out slot). */
    notRun: number;
  };
  failures: TestFailure[];
  flaky: FlakyTest[];
  setupErrors: SetupError[];
  /** Keys of tests that executed and passed (flaky ones passed on retry). */
  passed: string[];
  /** Keys of tests the suite skipped on purpose (test.skip, test.fixme). */
  skipped: string[];
}

export interface UnreadableResults {
  slot: string;
  artifactName: string;
  error: string;
}

/** What a tracked failure is, which decides what counts as evidence it is fixed. */
export type StateKind = "test" | "setup" | "job" | "run";

export interface StateEntry {
  /** Short hash of the failure's identity. */
  k: string;
  /** Slot the failure belongs to. */
  s: string;
  /** Run id the failure was first seen in during this red streak. */
  r: number;
  /** Short label for FIXED lines. */
  l: string;
  c: FailureClass;
  /** Absent in markers written before kinds were tracked; read as "test". */
  t?: StateKind;
}

export interface DigestState {
  v: 1;
  status: "red" | "green";
  run: number;
  at: string;
  consecutiveRed: number;
  firstRed: number | null;
  lastGreen: number | null;
  lastNotifiedAt: string | null;
  failing: StateEntry[];
  overflow: number;
}

export interface DigestInput {
  runId: number;
  runNumber?: number;
  runAttempt?: number;
  repo: string;
  serverUrl: string;
  sha?: string;
  event?: string;
  /** Result of the reusable-workflow call: success, failure, cancelled, ... */
  runResult: string;
  jobs: RunJob[];
  artifacts: RunArtifact[];
  slots: SlotResults[];
  unreadable: UnreadableResults[];
  /** Tail of each failed job's log, by job id. Absent means not fetched. */
  logs: Record<number, string>;
  previous: DigestState | null;
  now: string;
  issueUrl?: string;
  issueNumber?: number;
  slackNote?: string;
  /** Problems collecting this run's data, shown in the issue so they are not silent. */
  notes?: string[];
  maxFailures?: number;
}

export interface JobFact {
  slot: string | null;
  job: RunJob;
  shortName: string;
  conclusion: string;
  step: string;
  duration: string;
  lastLogLine: string | null;
  logTail: string[];
  artifact: RunArtifact | null;
  class: FailureClass;
  message: string;
  summary: string;
}

export interface DigestEntry {
  key: string;
  /** `carried` is a NOT RUN failure: tracked, shown, never gating. */
  kind: "test" | "setup" | "job" | "run" | "carried";
  slot: string;
  class: FailureClass;
  label: string;
  state: "new" | "still";
  since: number;
  test?: TestFailure;
  setup?: SetupError;
  fact?: JobFact;
  carriedReason?: string;
  /** For `carried`: what the failure was before it stopped running. */
  carriedKind?: StateKind;
}

export interface Digest {
  status: "red" | "green";
  input: DigestInput;
  /** Gating failures only: tests, setup errors, jobs without results. */
  entries: DigestEntry[];
  /** Failures from the previous red run that did not execute this time. */
  notRun: DigestEntry[];
  fixed: StateEntry[];
  flaky: FlakyTest[];
  advisory: Array<TestFailure | SetupError | JobFact>;
  failedJobs: Array<{ job: RunJob; fact: JobFact | null; failing: number }>;
  totals: {
    expected: number;
    skipped: number;
    unexpected: number;
    flaky: number;
    notRun: number;
    slotsWithResults: number;
  };
  counts: {
    newFailures: number;
    stillFailing: number;
    fixed: number;
    notRun: number;
    flaky: number;
    byClass: Record<FailureClass, number>;
  };
  stoppedEarly: string[];
  stateChanged: boolean;
  notify: { shouldNotify: boolean; reason: NotifyReason | null };
  state: DigestState;
}

export type NotifyReason =
  | "first-report"
  | "went-red"
  | "new-failures"
  | "recovered"
  | "reminder";

// ---------------------------------------------------------------------------
// Text helpers

const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function firstErrorLine(message: string, max = ERROR_LINE_MAX): string {
  const line = stripAnsi(message)
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return line ? truncate(line, max) : "(no error message recorded)";
}

function errorDetail(message: string): string {
  const lines = stripAnsi(message)
    .split(/\r?\n/)
    .map((line) => truncate(line.trimEnd(), 240))
    .filter((line, index, all) => line.length > 0 || index < all.length - 1);
  return truncate(lines.slice(0, 14).join("\n"), 1_600);
}

const ENV_PATTERNS = [
  /No beta session credential was supplied/i,
  /session (?:token|cookie) was rejected/i,
  /did not honor the supplied session credential/i,
  /Beta session bootstrap failed/i,
  /resolved to .+, not the expected/i,
  /BETA_E2E_EMAIL (?:is not set|must be)/i,
  /No stored session for/i,
  /no OpenAI credential was supplied/i,
  /OpenAI rejected the selected credential/i,
  /OpenAI credential validation was inconclusive/i,
  /Could not validate the selected OpenAI credential/i,
  /dedicated OpenAI key was not confirmed/i,
  /BETA_E2E_[A-Z_]+ is set but is not valid JSON/i,
];

const INFRA_PATTERNS = [
  /Timed out waiting \S+ for the/i,
  /setup exceeded its \d+s deadline/i,
  /did not finish within \d+s/i,
  /never responded after/i,
  /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/,
  /net::ERR_/,
  /socket hang up/i,
  /apiRequestContext\.\w+: Timeout/i,
  /page\.goto: Timeout/i,
  /\bHTTP 50[234]\b/,
  /operation was canceled/i,
  /exceeded the maximum execution time/i,
];

export function classifyMessage(message: string): FailureClass {
  const text = stripAnsi(message);
  if (ENV_PATTERNS.some((pattern) => pattern.test(text))) return "env";
  if (INFRA_PATTERNS.some((pattern) => pattern.test(text))) {
    return "infra-timeout";
  }
  return "product";
}

function hashKey(parts: string[]): string {
  return createHash("sha1")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 10);
}

/** Cell-safe inline code: pipes escaped, backticks and newlines flattened. */
function codeCell(text: string): string {
  const clean = text
    .replace(/\r?\n/g, " ")
    .replace(/`/g, "'")
    .replace(/\|/g, "\\|");
  return `\`${clean}\``;
}

function plainCell(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fence(text: string): string {
  return `\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\``;
}

function slackEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDuration(
  startedAt?: string | null,
  completedAt?: string | null,
) {
  if (!startedAt || !completedAt) return "unknown";
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
    : `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Results parsing

interface RawResult {
  status?: string;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  attachments?: Array<{ name?: string; path?: string }>;
}

interface RawTest {
  projectName?: string;
  /** expected | unexpected | flaky | skipped. */
  status?: string;
  /**
   * What the suite expected: `skipped` for test.skip / test.fixme, `passed`
   * otherwise. A `skipped` status with an expected `passed` is a test that
   * never ran (maxFailures or globalTimeout stopped the slot).
   */
  expectedStatus?: string;
  results?: RawResult[];
}

interface RawSpec {
  title?: string;
  file?: string;
  line?: number;
  tests?: RawTest[];
}

interface RawSuite {
  title?: string;
  file?: string;
  specs?: RawSpec[];
  suites?: RawSuite[];
}

interface RawReport {
  suites?: RawSuite[];
  errors?: Array<{ message?: string }>;
  stats?: {
    expected?: number;
    skipped?: number;
    unexpected?: number;
    flaky?: number;
  };
}

/** `beta-e2e-<slot>-<run id>` to `<slot>`. */
export function slotFromArtifactName(name: string, runId: number): string {
  const withoutPrefix = name.replace(/^beta-e2e-/, "");
  const suffix = `-${runId}`;
  return withoutPrefix.endsWith(suffix)
    ? withoutPrefix.slice(0, -suffix.length)
    : withoutPrefix;
}

/** Job display name (as the jobs API reports it) to the slot it runs. */
export function slotForJobName(name: string): string | null {
  const short = shortJobName(name);
  const publicMatch = short.match(/^(.+) public sweep$/);
  if (publicMatch) return `public-${publicMatch[1]}`;
  if (/^Fleet-wide checks$/.test(short)) return "fleet";
  if (/^Advisory findings/.test(short)) return "advisory";
  const authed = short.match(/^Authenticated (.+)$/);
  if (authed) return `authed-${authed[1]}`;
  return null;
}

export function shortJobName(name: string): string {
  const parts = name.split(" / ");
  return parts[parts.length - 1] ?? name;
}

function appFor(
  slot: string,
  titlePath: string[],
  file: string,
  specTitle = "",
): string {
  const fromPublic = slot.match(/^public-(.+)$/);
  if (fromPublic) return fromPublic[1] ?? slot;
  const fromChat = slot.match(/^authed-chat-(.+)$/);
  if (fromChat) return fromChat[1] ?? slot;
  if (slot === "authed-design") return "design";
  if (slot === "fleet" || slot === "advisory") return "all";
  const token = (titlePath[0] ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (/^[a-z][a-z0-9-]*$/.test(token)) return token;
  // A test with no describe names its app right after its `[journey] [area]`
  // tags ("[journey] [forms] forms: create, ..."). The reproduce command passes
  // this as `apps=`, which fails the run when it is not a real app id.
  const fromTitle = specTitle
    .replace(/^(?:\[[^\]]+\]\s*)+/, "")
    .split(/[\s:]/)[0]
    ?.toLowerCase();
  if (fromTitle && /^[a-z][a-z0-9-]*$/.test(fromTitle)) return fromTitle;
  const fromFile = file.match(/(?:^|\/)([a-z0-9]+)-[^/]*\.spec\.ts$/);
  return fromFile?.[1] ?? "unknown";
}

function specPath(file: string): string {
  return file.startsWith("e2e/") ? file : `e2e/beta/specs/${file}`;
}

function attachmentPaths(result: RawResult | undefined): string[] {
  const paths: string[] = [];
  for (const attachment of result?.attachments ?? []) {
    if (!attachment.path) continue;
    const marker = "/e2e/beta/";
    const index = attachment.path.indexOf(marker);
    paths.push(
      index >= 0
        ? attachment.path.slice(index + marker.length)
        : path.basename(attachment.path),
    );
  }
  return paths;
}

function lastMessage(results: RawResult[]): string {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    const message = result?.error?.message ?? result?.errors?.[0]?.message;
    if (message) return message;
  }
  return "";
}

function lastAttachments(results: RawResult[]): string[] {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const paths = attachmentPaths(results[index]);
    if (paths.length > 0) return paths;
  }
  return [];
}

export function parseResults(
  raw: unknown,
  slot: string,
  artifactName: string,
): SlotResults {
  const report = raw as RawReport;
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray(report.suites) ||
    typeof report.stats !== "object" ||
    report.stats === null
  ) {
    throw new Error("not a Playwright JSON report (no suites or stats)");
  }

  const failures: TestFailure[] = [];
  const flaky: FlakyTest[] = [];
  const passed: string[] = [];
  const skipped: string[] = [];
  let notRun = 0;

  const walk = (suite: RawSuite, titles: string[]): void => {
    const isRoot = suite.title === suite.file;
    const here = isRoot || !suite.title ? titles : [...titles, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const project = test.projectName ?? "unknown";
        const file = specPath(spec.file ?? suite.file ?? "unknown");
        const line = spec.line ?? 0;
        const title = [...here, spec.title ?? ""].filter(Boolean).join(" > ");
        const app = appFor(slot, here, file, spec.title);
        const key = hashKey(["test", slot, project, file, title]);
        if (test.status === "flaky") {
          flaky.push({ slot, app, project, file, line, title });
        }
        if (test.status === "expected" || test.status === "flaky") {
          passed.push(key);
        } else if (test.status === "skipped") {
          // A test the suite skips on purpose reports an expected status of
          // "skipped"; one that never ran because the slot stopped does not.
          if (test.expectedStatus === "skipped") skipped.push(key);
          else notRun += 1;
        }
        if (test.status !== "unexpected") continue;
        const results = test.results ?? [];
        const message = lastMessage(results);
        failures.push({
          key,
          slot,
          app,
          project,
          file,
          line,
          title,
          grep: [...here, spec.title ?? ""].filter(Boolean).join(" "),
          error: firstErrorLine(message),
          detail: errorDetail(message),
          attachments: lastAttachments(results),
          class: classifyMessage(message),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report.suites) walk(suite, []);

  const setupErrors: SetupError[] = (report.errors ?? []).map((error) => {
    const message = error.message ?? "";
    return {
      key: hashKey(["setup", slot]),
      slot,
      error: firstErrorLine(message),
      detail: errorDetail(message),
      class: classifyMessage(message),
    };
  });
  // Several top-level errors in one slot are one logical setup failure.
  const setup = setupErrors.slice(0, 1).map((first) => ({
    ...first,
    detail: setupErrors.map((error) => error.detail).join("\n\n"),
  }));

  const stats = report.stats;
  return {
    slot,
    artifactName,
    stats: {
      expected: stats.expected ?? 0,
      skipped: stats.skipped ?? 0,
      unexpected: stats.unexpected ?? 0,
      flaky: stats.flaky ?? 0,
      notRun,
    },
    failures,
    flaky,
    setupErrors: setup,
    passed,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Log extraction

const LOG_TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/;

function cleanLogLines(log: string): string[] {
  return stripAnsi(log)
    .split(/\r?\n/)
    .map((line) => line.replace(LOG_TIMESTAMP, "").trimEnd())
    .filter((line) => line.length > 0);
}

export function lastBetaE2eLine(log: string): string | null {
  const lines = cleanLogLines(log).filter((line) =>
    line.includes("[beta-e2e]"),
  );
  const last = lines[lines.length - 1];
  return last ? truncate(last.trim(), 240) : null;
}

/**
 * The lines leading up to the last `##[error]` annotation, which GitHub writes
 * straight after the failing step's output ("The operation was canceled.",
 * "Process completed with exit code 1."). The raw tail of a job log is post-job
 * cleanup noise.
 */
function logTail(log: string, count = 6): string[] {
  const lines = cleanLogLines(log);
  let end = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.startsWith("##[error]")) {
      end = index + 1;
      break;
    }
  }
  return lines
    .slice(Math.max(0, end - count), end)
    .map((line) => truncate(line, 240));
}

// ---------------------------------------------------------------------------
// Digest

function failingStep(job: RunJob): string {
  const steps = job.steps ?? [];
  const failed = steps.find((step) => step.conclusion === "failure");
  const cancelled = steps.find((step) => step.conclusion === "cancelled");
  return (failed ?? cancelled)?.name ?? "unknown (no step recorded as failed)";
}

function classifyJob(
  job: RunJob,
  slot: string | null,
  step: string,
  text: string,
): FailureClass {
  if (ENV_PATTERNS.some((pattern) => pattern.test(text))) return "env";
  if (INFRA_PATTERNS.some((pattern) => pattern.test(text)))
    return "infra-timeout";
  if (job.conclusion === "cancelled" || job.conclusion === "timed_out") {
    return "infra-timeout";
  }
  // Playwright writes a report even when global setup throws, so a test slot
  // with no report never got as far as judging the product.
  if (slot !== null) return "infra-timeout";
  if (/install|set up|checkout|cache|download|playwright/i.test(step)) {
    return "infra-timeout";
  }
  return "product";
}

function runUrl(input: Pick<DigestInput, "serverUrl" | "repo">, id: number) {
  return `${input.serverUrl}/${input.repo}/actions/runs/${id}`;
}

export function artifactNameForSlot(slot: string, runId: number): string {
  return `beta-e2e-${slot}-${runId}`;
}

export function decideNotify(
  previous: DigestState | null,
  status: "red" | "green",
  newFailureCount: number,
  now: string,
  reminderHours = REMINDER_HOURS,
): { shouldNotify: boolean; reason: NotifyReason | null } {
  if (!previous) {
    return status === "red"
      ? { shouldNotify: true, reason: "first-report" }
      : { shouldNotify: false, reason: null };
  }
  if (previous.status === "green" && status === "red") {
    return { shouldNotify: true, reason: "went-red" };
  }
  if (previous.status === "red" && status === "green") {
    return { shouldNotify: true, reason: "recovered" };
  }
  if (status === "green") return { shouldNotify: false, reason: null };
  if (newFailureCount > 0) {
    return { shouldNotify: true, reason: "new-failures" };
  }
  const last = previous.lastNotifiedAt
    ? Date.parse(previous.lastNotifiedAt)
    : NaN;
  const elapsedMs = Date.parse(now) - last;
  if (!Number.isFinite(elapsedMs) || elapsedMs >= reminderHours * 3_600_000) {
    return { shouldNotify: true, reason: "reminder" };
  }
  return { shouldNotify: false, reason: null };
}

export function buildDigest(input: DigestInput): Digest {
  const slotResults = new Map(input.slots.map((slot) => [slot.slot, slot]));
  const unreadable = new Map(
    input.unreadable.map((entry) => [entry.slot, entry]),
  );
  const artifactBySlot = (slot: string): RunArtifact | null =>
    input.artifacts.find(
      (artifact) => artifact.name === artifactNameForSlot(slot, input.runId),
    ) ?? null;

  const previousByKey = new Map(
    (input.previous?.failing ?? []).map((entry) => [entry.k, entry]),
  );
  const previousRed = input.previous?.status === "red";
  const sinceFor = (key: string): number =>
    previousRed ? (previousByKey.get(key)?.r ?? input.runId) : input.runId;
  const stateFor = (key: string): "new" | "still" =>
    previousRed && previousByKey.has(key) ? "still" : "new";

  const entries: DigestEntry[] = [];
  const advisory: Digest["advisory"] = [];
  const unverifiedSlots = new Set<string>();

  for (const result of input.slots) {
    const isAdvisory = result.slot === "advisory";
    for (const failure of result.failures) {
      if (isAdvisory) advisory.push(failure);
      else {
        entries.push({
          key: failure.key,
          kind: "test",
          slot: result.slot,
          class: failure.class,
          label: `${failure.app} · ${failure.project} · ${failure.title}`,
          state: stateFor(failure.key),
          since: sinceFor(failure.key),
          test: failure,
        });
      }
    }
    for (const setup of result.setupErrors) {
      if (isAdvisory) advisory.push(setup);
      else {
        entries.push({
          key: setup.key,
          kind: "setup",
          slot: result.slot,
          class: setup.class,
          label: `${result.slot} · setup · ${setup.error}`,
          state: stateFor(setup.key),
          since: sinceFor(setup.key),
          setup,
        });
      }
    }
  }

  // Results that could not be read are a fact about the slot, not an absence.
  for (const bad of input.unreadable) {
    const key = hashKey(["unreadable", bad.slot]);
    entries.push({
      key,
      kind: "job",
      slot: bad.slot,
      class: "infra-timeout",
      label: `${bad.slot} · results unreadable · ${bad.error}`,
      state: stateFor(key),
      since: sinceFor(key),
      fact: undefined,
      carriedReason: `results file in ${bad.artifactName} could not be read: ${bad.error}`,
    });
    unverifiedSlots.add(bad.slot);
  }

  const failedJobs: Digest["failedJobs"] = [];
  const jobConclusions = new Set(["failure", "cancelled", "timed_out"]);
  for (const job of input.jobs) {
    if (!job.conclusion || !jobConclusions.has(job.conclusion)) continue;
    const slot = slotForJobName(job.name);
    const slotFailing =
      slot === null
        ? 0
        : (slotResults.get(slot)?.failures.length ?? 0) +
          (slotResults.get(slot)?.setupErrors.length ?? 0);
    if (slot !== null && slotFailing > 0) {
      failedJobs.push({ job, fact: null, failing: slotFailing });
      continue;
    }

    const step = failingStep(job);
    const log = input.logs[job.id];
    const lastLine = log === undefined ? null : lastBetaE2eLine(log);
    const tail = log === undefined ? [] : logTail(log);
    const duration = formatDuration(job.started_at, job.completed_at);
    const short = shortJobName(job.name);
    const artifact = slot ? artifactBySlot(slot) : null;
    const logNote =
      log === undefined
        ? "the job log was not fetched"
        : lastLine === null
          ? "no [beta-e2e] line in the fetched job log"
          : lastLine;
    const resultsNote = slot
      ? unreadable.has(slot)
        ? `its results file was unreadable (${unreadable.get(slot)?.error})`
        : artifact
          ? "its artifact holds no results.json"
          : "it uploaded no artifact"
      : "this job produces no test results";
    const fact: JobFact = {
      slot,
      job,
      shortName: short,
      conclusion: job.conclusion,
      step,
      duration,
      lastLogLine: lastLine,
      logTail: tail,
      artifact,
      class: classifyJob(job, slot, step, `${logNote}\n${tail.join("\n")}`),
      message: `no test results: job "${short}" ${job.conclusion} at step "${step}" after ${duration}; ${resultsNote}; last [beta-e2e] log line: ${logNote}`,
      summary: `${job.conclusion} at "${step}" after ${duration}; last [beta-e2e] line: ${logNote}`,
    };
    failedJobs.push({ job, fact, failing: 0 });
    if (slot === "advisory") {
      advisory.push(fact);
      continue;
    }
    const key = hashKey(["job", slot ?? short]);
    entries.push({
      key,
      kind: "job",
      slot: slot ?? short,
      class: fact.class,
      label: `${short} · ${job.conclusion} at ${step}`,
      state: stateFor(key),
      since: sinceFor(key),
      fact,
    });
    if (slot) unverifiedSlots.add(slot);
  }

  // The caller said the run failed but nothing above explains it: say so
  // rather than reporting a clean run.
  const badResult = ["failure", "cancelled", "timed_out"].includes(
    input.runResult,
  );
  if (badResult && entries.length === 0) {
    const key = hashKey(["run", input.runResult]);
    entries.push({
      key,
      kind: "run",
      slot: "run",
      class: "unclassified",
      label: `run ${input.runResult} with no failing test or job identified`,
      state: stateFor(key),
      since: sinceFor(key),
      carriedReason: `the beta E2E workflow call finished "${input.runResult}", but the jobs and results provided show no failed job or failing test. The jobs list may be incomplete; open the run.`,
    });
  }

  // A failure from the last red run is FIXED only on evidence from this run: a
  // test that executed and passed, or a slot that now ran tests (for a setup or
  // job failure), or a job that now succeeded. Anything else did not run, and a
  // test that did not run is not a test that passed.
  const passedKeys = new Set(input.slots.flatMap((result) => result.passed));
  const skippedKeys = new Set(input.slots.flatMap((result) => result.skipped));
  const succeededJobKeys = new Set(
    input.jobs
      .filter((job) => job.conclusion === "success")
      .map((job) =>
        hashKey(["job", slotForJobName(job.name) ?? shortJobName(job.name)]),
      ),
  );
  const ranTests = (slot: string): boolean => {
    const stats = slotResults.get(slot)?.stats;
    return (
      stats !== undefined && stats.expected + stats.unexpected + stats.flaky > 0
    );
  };
  const notRunReason = (old: StateEntry, kind: StateKind): string => {
    if (kind !== "test") {
      return `not re-run: slot ${old.s} ran no tests this time, so the earlier failure is not verified fixed`;
    }
    if (!slotResults.has(old.s)) {
      return unverifiedSlots.has(old.s)
        ? `not re-run: slot ${old.s} produced no usable results this time`
        : `not re-run: slot ${old.s} produced no results this time`;
    }
    if (skippedKeys.has(old.k)) {
      return "not re-run: the suite skipped it this time (test.skip or test.fixme)";
    }
    return `not re-run: it is not in this run's results; slot ${old.s} stopped early (maxFailures or global timeout), or the test was filtered out, renamed, or removed`;
  };

  const currentKeys = new Set(entries.map((entry) => entry.key));
  const fixed: StateEntry[] = [];
  const notRun: DigestEntry[] = [];
  if (previousRed) {
    for (const old of input.previous?.failing ?? []) {
      if (currentKeys.has(old.k)) continue;
      const kind = old.t ?? "test";
      // An unexplained-run-failure entry is superseded by whatever explains
      // the run now; it neither passed nor is waiting to run.
      if (kind === "run") continue;
      const verified =
        kind === "test"
          ? passedKeys.has(old.k)
          : ranTests(old.s) || succeededJobKeys.has(old.k);
      if (verified) {
        fixed.push(old);
        continue;
      }
      notRun.push({
        key: old.k,
        kind: "carried",
        carriedKind: kind,
        slot: old.s,
        class: old.c,
        label: old.l,
        state: "still",
        since: old.r,
        carriedReason: notRunReason(old, kind),
      });
    }
  }

  const flaky = input.slots.flatMap((slot) => slot.flaky);
  const totals = input.slots.reduce(
    (sum, slot) => ({
      expected: sum.expected + slot.stats.expected,
      skipped: sum.skipped + slot.stats.skipped,
      unexpected: sum.unexpected + slot.stats.unexpected,
      flaky: sum.flaky + slot.stats.flaky,
      notRun: sum.notRun + slot.stats.notRun,
      slotsWithResults: sum.slotsWithResults + 1,
    }),
    {
      expected: 0,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
      notRun: 0,
      slotsWithResults: 0,
    },
  );

  const maxFailures = input.maxFailures ?? 8;
  const stoppedEarly = input.slots
    .filter((slot) => slot.stats.unexpected >= maxFailures)
    .map((slot) => slot.slot);

  const status: "red" | "green" = entries.length > 0 ? "red" : "green";
  const newFailures = entries.filter((entry) => entry.state === "new");
  const byClass: Record<FailureClass, number> = {
    env: 0,
    product: 0,
    "infra-timeout": 0,
    unclassified: 0,
  };
  for (const entry of entries) byClass[entry.class] += 1;

  const notify = decideNotify(
    input.previous,
    status,
    previousRed ? newFailures.length : 0,
    input.now,
  );
  const stateChanged =
    !input.previous ||
    input.previous.status !== status ||
    newFailures.length > 0 ||
    fixed.length > 0;

  const prev = input.previous;
  // Gating failures first, so a catastrophic run drops NOT RUN entries before
  // it drops anything that is actually failing.
  const trackedEntries = [...entries, ...notRun];
  const tracked = trackedEntries.slice(0, STATE_MAX_ENTRIES);
  const state: DigestState = {
    v: 1,
    status,
    run: input.runId,
    at: input.now,
    consecutiveRed:
      status === "red"
        ? (prev?.status === "red" ? prev.consecutiveRed : 0) + 1
        : 0,
    firstRed:
      status === "red"
        ? prev?.status === "red"
          ? (prev.firstRed ?? prev.run)
          : input.runId
        : null,
    lastGreen:
      status === "green"
        ? input.runId
        : prev?.status === "green"
          ? prev.run
          : (prev?.lastGreen ?? null),
    lastNotifiedAt: notify.shouldNotify
      ? input.now
      : (prev?.lastNotifiedAt ?? null),
    failing:
      status === "red"
        ? tracked.map((entry) => ({
            k: entry.key,
            s: entry.slot,
            r: entry.since,
            l: truncate(entry.label, 70),
            c: entry.class,
            t:
              entry.kind === "carried"
                ? (entry.carriedKind ?? "test")
                : entry.kind,
          }))
        : [],
    overflow: Math.max(0, trackedEntries.length - tracked.length),
  };

  return {
    status,
    input,
    entries,
    notRun,
    fixed,
    flaky,
    advisory,
    failedJobs,
    totals,
    counts: {
      newFailures: newFailures.length,
      stillFailing: entries.length - newFailures.length,
      fixed: fixed.length,
      notRun: notRun.length,
      flaky: flaky.length,
      byClass,
    },
    stoppedEarly,
    stateChanged,
    notify,
    state,
  };
}

// ---------------------------------------------------------------------------
// State marker

export function embedState(state: DigestState): string {
  const json = JSON.stringify(state).replace(/>/g, "\\u003e");
  return `${STATE_MARKER_PREFIX}${json}${STATE_MARKER_SUFFIX}`;
}

/** Previous state from an issue body; null when the body carries none. */
export function extractState(
  body: string | null | undefined,
): DigestState | null {
  if (!body) return null;
  const start = body.indexOf(STATE_MARKER_PREFIX);
  if (start < 0) return null;
  const end = body.indexOf(STATE_MARKER_SUFFIX, start);
  if (end < 0) {
    throw new Error(
      "The previous issue body has a truncated beta-e2e state marker.",
    );
  }
  const parsed = JSON.parse(
    body.slice(start + STATE_MARKER_PREFIX.length, end),
  ) as DigestState;
  if (
    parsed.v !== 1 ||
    (parsed.status !== "red" && parsed.status !== "green")
  ) {
    throw new Error(
      "The previous issue body has an unrecognised beta-e2e state marker.",
    );
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Reproduction commands

export function reproduceCommands(test: {
  slot: string;
  app: string;
  project: string;
  grep: string;
}): { ci: string; local: string } {
  const lane = test.slot.startsWith("authed-") ? "authed" : "public";
  const apps =
    test.slot === "fleet" || test.slot === "advisory" || test.app === "unknown"
      ? "all"
      : test.app;
  const grep = shellQuote(escapeRegex(test.grep));
  return {
    ci: `gh workflow run beta-e2e.yml --ref main -f apps=${apps} -f lane=${lane} -f grep=${grep}`,
    local: `BETA_E2E_APPS=${apps} pnpm e2e:beta --project=${test.project} --grep ${grep}`,
  };
}

// ---------------------------------------------------------------------------
// Rendering

function runLink(digest: Digest, id: number, label?: string): string {
  return `[${label ?? `#${id}`}](${runUrl(digest.input, id)})`;
}

function stateLabel(entry: DigestEntry, digest: Digest): string {
  if (entry.kind === "carried") {
    return `NOT RUN (last failed in ${runLink(digest, entry.since)})`;
  }
  if (entry.state === "new") return "NEW";
  return `STILL FAILING since ${runLink(digest, entry.since)}`;
}

function notRunSummary(count: number): string {
  return `${count} previously failing test${count === 1 ? "" : "s"} did not run this time, so ${count === 1 ? "it is" : "they are"} not verified fixed`;
}

function artifactLinks(digest: Digest, slot: string) {
  const name = artifactNameForSlot(slot, digest.input.runId);
  const artifact = digest.input.artifacts.find((entry) => entry.name === name);
  return {
    name,
    url: artifact
      ? `${digest.input.serverUrl}/${digest.input.repo}/actions/runs/${digest.input.runId}/artifacts/${artifact.id}`
      : null,
  };
}

export function classTag(failureClass: FailureClass): string {
  return `[${failureClass}]`;
}

function headline(digest: Digest): string {
  const { entries, counts } = digest;
  if (digest.status === "green") {
    return `**Status: GREEN.** No gating failures in this run.${counts.notRun > 0 ? ` ${notRunSummary(counts.notRun)}.` : ""}`;
  }
  const tests = entries.filter((entry) => entry.kind === "test").length;
  const jobs = entries.filter((entry) => entry.kind === "job").length;
  const other = entries.length - tests - jobs;
  const parts = [
    `${tests} failing test${tests === 1 ? "" : "s"}`,
    `${jobs} job${jobs === 1 ? "" : "s"} without usable results`,
  ];
  if (other > 0) parts.push(`${other} other`);
  return `**Status: RED.** ${parts.join(", ")}. NEW ${counts.newFailures}, STILL FAILING ${counts.stillFailing}, FIXED ${counts.fixed}, NOT RUN ${counts.notRun}.`;
}

interface RenderOptions {
  detailLimit: number;
  rowLimit: number;
}

function renderIssueWith(digest: Digest, options: RenderOptions): string {
  const { input, state } = digest;
  const lines: string[] = [];
  const push = (...more: string[]) => lines.push(...more);

  push(headline(digest), "");
  const runBits = [
    `[#${input.runId}](${runUrl(input, input.runId)})`,
    input.runAttempt && input.runAttempt > 1
      ? `attempt ${input.runAttempt}`
      : null,
    input.event ?? null,
    input.sha ? `on \`${input.sha.slice(0, 9)}\`` : null,
    input.now,
  ].filter(Boolean);
  push(`- Run: ${runBits.join(", ")}`);
  if (digest.status === "red") {
    push(
      `- Consecutive red runs: ${state.consecutiveRed}${state.firstRed ? ` (first red: ${runLink(digest, state.firstRed)})` : ""}`,
      `- Last green run: ${state.lastGreen ? runLink(digest, state.lastGreen) : "none recorded"}`,
      `- Classes: ${digest.counts.byClass.product} [product], ${digest.counts.byClass.env} [env], ${digest.counts.byClass["infra-timeout"]} [infra-timeout]${digest.counts.byClass.unclassified ? `, ${digest.counts.byClass.unclassified} [unclassified]` : ""}`,
    );
  } else if (input.previous?.status === "red") {
    push(
      `- Recovered after ${input.previous.consecutiveRed} consecutive red run${input.previous.consecutiveRed === 1 ? "" : "s"} (first red: ${input.previous.firstRed ? runLink(digest, input.previous.firstRed) : "unknown"}).`,
    );
  }
  const { totals } = digest;
  push(
    `- Tests: ${totals.expected} passed, ${totals.unexpected} failed, ${totals.flaky} flaky, ${Math.max(0, totals.skipped - totals.notRun)} skipped${totals.notRun > 0 ? `, ${totals.notRun} did not run (a slot stopped early or timed out)` : ""} across ${totals.slotsWithResults} slots`,
  );
  if (input.slackNote) push(`- Slack: ${input.slackNote}`);
  for (const note of input.notes ?? []) push(`- Report note: ${note}`);
  if (digest.stoppedEarly.length > 0) {
    push(
      `- Stopped early at maxFailures in: ${digest.stoppedEarly.join(", ")}. Tests after the cutoff did not run, so more may be failing.`,
    );
  }
  push("");

  if (digest.failedJobs.length > 0) {
    push(
      "### Failed jobs",
      "",
      "| Job | Result | Failing step | Ran for | Test results |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const { job, fact, failing } of digest.failedJobs) {
      push(
        `| [${plainCell(shortJobName(job.name))}](${job.html_url}) | ${job.conclusion} | ${codeCell(failingStep(job))} | ${formatDuration(job.started_at, job.completed_at)} | ${fact ? "none (see below)" : `${failing} failing`} |`,
      );
    }
    push("");
  }

  const testEntries = digest.entries.filter((entry) => entry.kind === "test");
  if (testEntries.length > 0) {
    push(
      "### Failing tests",
      "",
      "| State | Class | App | Lane / project | Location | Test | First error | Evidence |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const entry of testEntries.slice(0, options.rowLimit)) {
      const test = entry.test as TestFailure;
      const links = artifactLinks(digest, entry.slot);
      const evidence = [
        test.attachments.length > 0
          ? test.attachments.map(codeCell).join("<br>")
          : "no attachment",
        links.url ? `[artifact](${links.url})` : codeCell(links.name),
      ].join("<br>");
      push(
        `| ${stateLabel(entry, digest)} | ${classTag(entry.class)} | ${plainCell(test.app)} | ${codeCell(`${entry.slot} / ${test.project}`)} | ${codeCell(`${test.file}:${test.line}`)} | ${codeCell(test.title)} | ${codeCell(test.error)} | ${evidence} |`,
      );
    }
    if (testEntries.length > options.rowLimit) {
      push(
        "",
        `... and ${testEntries.length - options.rowLimit} more failing tests not listed here (the size of this issue is capped). The full list is in each artifact's \`results.json\`.`,
      );
    }
    push("");
  }

  const otherEntries = digest.entries.filter((entry) => entry.kind !== "test");
  if (otherEntries.length > 0) {
    push("### Jobs and setup without usable test results", "");
    for (const entry of otherEntries) {
      const text =
        entry.fact?.message ??
        entry.setup?.error ??
        entry.carriedReason ??
        entry.label;
      push(`- ${classTag(entry.class)} ${stateLabel(entry, digest)}: ${text}`);
      if (entry.fact?.job) push(`  Job: ${entry.fact.job.html_url}`);
      if (entry.fact?.artifact) {
        const links = artifactLinks(digest, entry.fact.slot ?? "");
        if (links.url) push(`  Artifact: ${links.url}`);
      }
      if (entry.fact && entry.fact.logTail.length > 0) {
        push(
          "",
          "  <details><summary>Last lines of the job log</summary>",
          "",
          fence(entry.fact.logTail.join("\n")),
          "",
          "  </details>",
        );
      }
      if (entry.setup && entry.setup.detail !== entry.setup.error) {
        push(
          "",
          "  <details><summary>Setup error</summary>",
          "",
          fence(entry.setup.detail),
          "",
          "  </details>",
        );
      }
    }
    push("");
  }

  if (digest.notRun.length > 0) {
    push(
      `### Not run this time (${digest.notRun.length}, not verified fixed)`,
      "",
      "These failed in the last red run and did not execute in this one. They do not make this run red or count as new when they fail again, and they are not called fixed until a run executes and passes them.",
      "",
      "| State | Class | Test | Why |",
      "| --- | --- | --- | --- |",
    );
    for (const entry of digest.notRun.slice(0, options.rowLimit)) {
      push(
        `| ${stateLabel(entry, digest)} | ${classTag(entry.class)} | ${codeCell(entry.label)} | ${plainCell(entry.carriedReason ?? "")} |`,
      );
    }
    if (digest.notRun.length > options.rowLimit) {
      push(
        "",
        `... and ${digest.notRun.length - options.rowLimit} more not run (the size of this issue is capped).`,
      );
    }
    push("");
  }

  const withDetail = testEntries.filter((entry) => entry.test?.detail);
  if (withDetail.length > 0 && options.detailLimit > 0) {
    push("### Error details", "");
    for (const entry of withDetail.slice(0, options.detailLimit)) {
      const test = entry.test as TestFailure;
      push(
        `<details><summary>${classTag(entry.class)} ${plainCell(test.app)} · ${plainCell(test.project)} · ${plainCell(truncate(test.title, 120))}</summary>`,
        "",
        fence(test.detail),
        "",
        "</details>",
        "",
      );
    }
    if (withDetail.length > options.detailLimit) {
      push(
        `... error details for ${withDetail.length - options.detailLimit} more failing tests omitted for size.`,
        "",
      );
    }
  }

  if (digest.fixed.length > 0) {
    push("### Fixed since the previous run", "");
    for (const old of digest.fixed.slice(0, 30)) {
      push(
        `- ${classTag(old.c)} \`${old.l.replace(/`/g, "'")}\` (failing since ${runLink(digest, old.r)})`,
      );
    }
    if (digest.fixed.length > 30)
      push(`- ... and ${digest.fixed.length - 30} more`);
    push("");
  }

  if (digest.flaky.length > 0) {
    push(
      `### Flaky in this run (${digest.flaky.length}, passed on retry, not paged)`,
      "",
    );
    for (const test of digest.flaky.slice(0, 15)) {
      push(
        `- ${plainCell(test.app)} · ${plainCell(test.project)} · ${codeCell(test.title)}`,
      );
    }
    if (digest.flaky.length > 15)
      push(`- ... and ${digest.flaky.length - 15} more`);
    push("");
  }

  if (digest.advisory.length > 0) {
    push(`### Advisory findings (${digest.advisory.length}, non-gating)`, "");
    for (const item of digest.advisory.slice(0, 10)) {
      const text =
        "message" in item
          ? item.message
          : "title" in item
            ? item.title
            : item.error;
      push(`- ${codeCell(truncate(text, 200))}`);
    }
    push("");
  }

  const failingSlots = [
    ...new Set(
      digest.entries
        .filter((entry) => entry.kind !== "run")
        .map((entry) => entry.slot),
    ),
  ];
  if (failingSlots.length > 0) {
    push("### Artifacts", "", "| Artifact | Download |", "| --- | --- |");
    for (const slot of failingSlots) {
      const links = artifactLinks(digest, slot);
      push(
        `| ${links.url ? `[${links.name}](${links.url})` : codeCell(links.name)} | ${codeCell(`gh run download ${input.runId} -n ${links.name}`)} |`,
      );
    }
    push("");
  }

  push("### How to investigate", "");
  const sample = testEntries[0]?.test;
  const commands = sample
    ? reproduceCommands({
        slot: testEntries[0]?.slot ?? "public",
        app: sample.app,
        project: sample.project,
        grep: sample.grep,
      })
    : null;
  push(
    "1. Download the artifact for the failing slot (table above). Open `playwright-report/<slot>/index.html` for the HTML report, `results.json` for every error, and the `error-context.md` / screenshot named in the Evidence column.",
    '2. A job listed under "without usable test results" was cancelled or failed before Playwright wrote a report. The line shown is the last `[beta-e2e]` message the job logged, which names the host and step it was in; open the job link for the full log.',
    "3. Reproduce one test on CI against the deployed beta fleet:",
    "",
    fence(
      commands?.ci ??
        "gh workflow run beta-e2e.yml --ref main -f apps=<app> -f lane=<public|authed> -f grep='<test title>'",
    ),
    "",
    "4. Or locally:",
    "",
    fence(
      commands?.local ??
        "BETA_E2E_APPS=<app> pnpm e2e:beta --project=<project> --grep '<test title>'",
    ),
    "",
    "   Authenticated projects (registry, chat, journeys-core, journeys-session, journeys-credentials, journeys-flows, design) also need `BETA_E2E_EMAIL` and `BETA_E2E_SESSION_TOKENS` exported, and chat needs `BETA_E2E_OPENAI_API_KEY` and `BETA_E2E_CLUSTER=chat`. See `e2e/beta/README.md`.",
    "5. Classes: `[product]` an assertion failed (a regression, or a test that no longer matches the product); `[env]` a credential or session problem (secret expired, wrong identity); `[infra-timeout]` a timeout, cancellation, or network failure before the product could be judged.",
    "",
    "This issue is updated in place on every scheduled run and gets a comment only when the set of failures changes. It closes itself when a run is fully green.",
    "",
  );

  return lines.join("\n");
}

export function renderIssueBody(digest: Digest): string {
  const marker = embedState(digest.state);
  const attempts: RenderOptions[] = [
    { detailLimit: 25, rowLimit: 150 },
    { detailLimit: 8, rowLimit: 80 },
    { detailLimit: 0, rowLimit: 40 },
    { detailLimit: 0, rowLimit: 15 },
  ];
  for (const options of attempts) {
    const body = `${renderIssueWith(digest, options)}\n${marker}\n`;
    if (body.length <= ISSUE_BODY_BUDGET) return body;
  }
  // Last resort: the page of facts that matter, never a body GitHub refuses.
  const compact = renderIssueWith(digest, { detailLimit: 0, rowLimit: 5 });
  const room = ISSUE_BODY_BUDGET - marker.length - 200;
  return `${truncate(compact, room)}\n\n(Issue body truncated to fit GitHub's size limit.)\n${marker}\n`;
}

export function renderComment(digest: Digest): string | null {
  const { input } = digest;
  if (digest.status === "green") {
    const notRunNote =
      digest.counts.notRun > 0
        ? ` ${notRunSummary(digest.counts.notRun)}.`
        : "";
    if (input.previous?.status === "red") {
      return `Recovered in ${runLink(digest, input.runId)}. It was red for ${input.previous.consecutiveRed} consecutive run${input.previous.consecutiveRed === 1 ? "" : "s"}${input.previous.firstRed ? `, starting at ${runLink(digest, input.previous.firstRed)}` : ""}.${notRunNote} Closing.`;
    }
    if (input.issueNumber !== undefined) {
      return `${runLink(digest, input.runId)} is green, but this issue is still open without a red state to recover from (it predates the state-tracked report, or its marker is unreadable). Closing; the next failure opens a fresh one.`;
    }
    return null;
  }
  if (!digest.stateChanged) return null;
  const lines = [
    `Run ${runLink(digest, input.runId)}: ${digest.entries.length} failing (NEW ${digest.counts.newFailures}, STILL FAILING ${digest.counts.stillFailing}, FIXED ${digest.counts.fixed}, NOT RUN ${digest.counts.notRun}).`,
  ];
  const fresh = digest.entries
    .filter((entry) => entry.state === "new")
    .slice(0, 8);
  if (fresh.length > 0) {
    lines.push("", "New:");
    for (const entry of fresh) {
      lines.push(
        `- ${classTag(entry.class)} ${codeCell(truncate(entry.label, 160))}`,
      );
    }
  }
  if (digest.fixed.length > 0) {
    lines.push("", "Fixed:");
    for (const old of digest.fixed.slice(0, 8)) {
      lines.push(`- ${classTag(old.c)} ${codeCell(old.l)}`);
    }
  }
  lines.push("", "The issue body holds the full current state.");
  return lines.join("\n");
}

export function renderSlack(digest: Digest): string {
  const { input } = digest;
  const runLinkText = `<${runUrl(input, input.runId)}|run #${input.runNumber ?? input.runId}>`;
  const issueLink = input.issueUrl
    ? ` · <${input.issueUrl}|issue${input.issueNumber ? ` #${input.issueNumber}` : ""}>`
    : "";

  if (digest.status === "green") {
    const prev = input.previous;
    return [
      `:white_check_mark: *Beta E2E recovered* in ${runLinkText}${issueLink}`,
      prev?.status === "red"
        ? `It was red for ${prev.consecutiveRed} consecutive run${prev.consecutiveRed === 1 ? "" : "s"}${prev.firstRed ? ` since <${runUrl(input, prev.firstRed)}|run ${prev.firstRed}>` : ""}.`
        : "No gating failures.",
      ...(digest.counts.notRun > 0
        ? [`NOT RUN: ${notRunSummary(digest.counts.notRun)}.`]
        : []),
    ].join("\n");
  }

  const tests = digest.entries.filter((entry) => entry.kind === "test").length;
  const jobs = digest.entries.length - tests;
  const lines: string[] = [];
  lines.push(
    `:red_circle: *Beta E2E failing*: ${tests} test${tests === 1 ? "" : "s"}, ${jobs} job${jobs === 1 ? "" : "s"} without results (${digest.state.consecutiveRed} consecutive red run${digest.state.consecutiveRed === 1 ? "" : "s"})`,
  );
  lines.push(
    `${runLinkText}${issueLink} · last green: ${digest.state.lastGreen ? `<${runUrl(input, digest.state.lastGreen)}|run ${digest.state.lastGreen}>` : "none recorded"}`,
  );
  lines.push(
    `New ${digest.counts.newFailures} · still failing ${digest.counts.stillFailing} · fixed ${digest.counts.fixed} · NOT RUN ${digest.counts.notRun} · flaky (not paged) ${digest.counts.flaky}`,
  );
  const ranked = [...digest.entries].sort(
    (a, b) => Number(b.state === "new") - Number(a.state === "new"),
  );
  lines.push("Top failures:");
  for (const entry of ranked.slice(0, 5)) {
    const detail =
      entry.test?.error ??
      entry.fact?.summary ??
      entry.setup?.error ??
      entry.carriedReason ??
      entry.label;
    const where = entry.test
      ? `${entry.test.app} · ${entry.test.project} · ${entry.test.title}`
      : entry.fact
        ? `no results: ${entry.fact.shortName}`
        : entry.label;
    lines.push(
      `• ${classTag(entry.class)} ${entry.state === "new" ? "NEW " : ""}${slackEscape(truncate(where, 90))}: ${slackEscape(truncate(detail, 140))}`,
    );
  }
  if (ranked.length > 5)
    lines.push(`• +${ranked.length - 5} more in the issue`);
  const jobLinks = digest.failedJobs
    .slice(0, 4)
    .map(
      ({ job }) => `<${job.html_url}|${slackEscape(shortJobName(job.name))}>`,
    );
  if (jobLinks.length > 0) lines.push(`Failed jobs: ${jobLinks.join(" · ")}`);
  const artifactSlots = [
    ...new Set(digest.entries.map((entry) => entry.slot)),
  ].slice(0, 3);
  const artifactBits = artifactSlots
    .map((slot) => artifactLinks(digest, slot))
    .filter((links) => links.url)
    .map((links) => `<${links.url}|${links.name}>`);
  if (artifactBits.length > 0)
    lines.push(`Artifacts: ${artifactBits.join(" · ")}`);
  return lines.slice(0, 12).join("\n");
}

// ---------------------------------------------------------------------------
// CLI: files in, files out

function readJson(file: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${what} at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${what} at ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function listOf<T>(value: unknown, key: string, what: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const inner = (value as Record<string, unknown> | null)?.[key];
  if (Array.isArray(inner)) return inner as T[];
  throw new Error(
    `${what} is neither an array nor an object with a "${key}" array.`,
  );
}

function findResultFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findResultFiles(full));
    else if (entry === "results.json") found.push(full);
  }
  return found;
}

/**
 * Every results.json under the download directory. The slot is the report
 * folder Playwright wrote it to (`playwright-report/<slot>/results.json`), so it
 * does not depend on how `gh run download` laid the artifacts out; the artifact
 * directory name is only the fallback.
 */
export function collectResults(
  resultsDir: string,
  runId: number,
): Pick<DigestInput, "slots" | "unreadable"> {
  const slots: SlotResults[] = [];
  const unreadable: UnreadableResults[] = [];
  if (!existsSync(resultsDir)) return { slots, unreadable };
  for (const file of findResultFiles(resultsDir).sort()) {
    const folder = path.dirname(file);
    const slot =
      path.basename(path.dirname(folder)) === "playwright-report"
        ? path.basename(folder)
        : slotFromArtifactName(
            path.relative(resultsDir, file).split(path.sep)[0] ?? "unknown",
            runId,
          );
    const artifactName = artifactNameForSlot(slot, runId);
    try {
      slots.push(
        parseResults(
          JSON.parse(readFileSync(file, "utf8")),
          slot,
          artifactName,
        ),
      );
    } catch (error) {
      unreadable.push({
        slot,
        artifactName,
        error: truncate(
          error instanceof Error ? error.message : String(error),
          160,
        ),
      });
    }
  }
  return { slots, unreadable };
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    // `--note` may repeat; every other flag is last-one-wins.
    const name = flag.slice(2);
    args[name] =
      name === "note" && args[name] ? `${args[name]}\n${value}` : value;
    index += 1;
  }
  return args;
}

function required(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

export function loadInput(args: Record<string, string>): DigestInput {
  const runId = Number(required(args, "run-id"));
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error(
      `--run-id must be a positive integer, got ${args["run-id"]}`,
    );
  }
  const jobs = listOf<RunJob>(
    readJson(required(args, "jobs"), "the jobs list"),
    "jobs",
    "the jobs list",
  );
  const artifacts = listOf<RunArtifact>(
    readJson(required(args, "artifacts"), "the artifacts list"),
    "artifacts",
    "the artifacts list",
  );
  const logs: Record<number, string> = {};
  if (args["logs-dir"] && existsSync(args["logs-dir"])) {
    for (const entry of readdirSync(args["logs-dir"])) {
      const match = entry.match(/^(\d+)\.log$/);
      if (match) {
        logs[Number(match[1])] = readFileSync(
          path.join(args["logs-dir"], entry),
          "utf8",
        );
      }
    }
  }
  const notes = (args.note ?? "").split("\n").filter(Boolean);
  let previous: DigestState | null = null;
  if (args["previous-state"] && existsSync(args["previous-state"])) {
    try {
      previous = extractState(readFileSync(args["previous-state"], "utf8"));
    } catch (error) {
      // A damaged marker must not stop the report; it is said, not hidden, and
      // this run is then reported as a first report.
      notes.push(
        `The previous issue's state marker could not be read (${error instanceof Error ? error.message : String(error)}), so NEW / STILL FAILING / FIXED are not compared against it.`,
      );
    }
  }
  return {
    runId,
    runNumber: args["run-number"] ? Number(args["run-number"]) : undefined,
    runAttempt: args["run-attempt"] ? Number(args["run-attempt"]) : undefined,
    repo: required(args, "repo"),
    serverUrl: args["server-url"] ?? "https://github.com",
    sha: args.sha,
    event: args.event,
    runResult: required(args, "run-result"),
    jobs,
    artifacts,
    ...collectResults(args["results-dir"] ?? "", runId),
    logs,
    previous,
    now: args.now ?? new Date().toISOString(),
    issueUrl: args["issue-url"] || undefined,
    issueNumber: args["issue-number"]
      ? Number(args["issue-number"])
      : undefined,
    slackNote: args["slack-note"] || undefined,
    notes,
    maxFailures: args["max-failures"]
      ? Number(args["max-failures"])
      : undefined,
  };
}

export function writeOutputs(digest: Digest, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "issue.md"), renderIssueBody(digest));
  writeFileSync(path.join(outDir, "slack.txt"), `${renderSlack(digest)}\n`);
  writeFileSync(
    path.join(outDir, "state.json"),
    `${JSON.stringify(digest.state, null, 2)}\n`,
  );
  const comment = renderComment(digest);
  if (comment) writeFileSync(path.join(outDir, "comment.md"), `${comment}\n`);
  // A green run closes any open issue: one that went red under this report, and
  // one that predates it (the legacy issue has no state marker, so a green first
  // run would otherwise leave it open until a red run and then a green one).
  const previousRed = digest.input.previous?.status === "red";
  const openIssue = digest.input.issueNumber !== undefined;
  writeFileSync(
    path.join(outDir, "decision.json"),
    `${JSON.stringify(
      {
        status: digest.status,
        title: ISSUE_TITLE,
        labels: ISSUE_LABELS,
        issueAction:
          digest.status === "red"
            ? "upsert"
            : previousRed || openIssue
              ? "close"
              : "none",
        shouldNotify: digest.notify.shouldNotify,
        notifyReason: digest.notify.reason,
        stateChanged: digest.stateChanged,
        hasComment: comment !== null,
        failing: digest.entries.length,
        newFailures: digest.counts.newFailures,
        fixed: digest.counts.fixed,
        notRun: digest.counts.notRun,
        flaky: digest.counts.flaky,
      },
      null,
      2,
    )}\n`,
  );
}

export function main(argv: string[]): void {
  const args = parseArgs(argv);
  const digest = buildDigest(loadInput(args));
  writeOutputs(digest, required(args, "out-dir"));
  console.log(
    `beta-e2e digest: ${digest.status}, ${digest.entries.length} failing (new ${digest.counts.newFailures}, still ${digest.counts.stillFailing}, fixed ${digest.counts.fixed}), notify=${digest.notify.shouldNotify}${digest.notify.reason ? ` (${digest.notify.reason})` : ""}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(
      `beta-e2e digest failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
