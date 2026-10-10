import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type SignupE2EReportState = {
  version: 1;
  reporter: "signup-e2e";
  outcome: "unknown" | "failure" | "clean";
  findingCount: number;
  runUrl: string | null;
  reportArtifactUrl: string | null;
};

export type SignupAgentReportState = {
  version: 1;
  reporter: "signup-agent";
  outcome: "unknown" | "findings" | "clean";
  findingCount: number;
  reportComplete: boolean;
  runUrl: string | null;
  reportArtifactUrl: string | null;
};

export type SignupE2EPlan = {
  state: SignupE2EReportState;
  recovery: {
    findingCount: number;
    previousRunUrl: string | null;
    previousReportArtifactUrl: string | null;
  } | null;
};

export type SignupAgentPlan = {
  state: SignupAgentReportState;
  recovery: {
    findingCount: number;
    previousReportComplete: boolean;
    previousRunUrl: string | null;
    previousReportArtifactUrl: string | null;
  } | null;
};

export function finalizeSignupE2EReport(input: {
  previous: SignupE2EReportState;
  plan: SignupE2EPlan;
  slackDelivered: boolean;
  requireSlackDelivery?: boolean;
}): SignupE2EReportState {
  validateE2EPlan(input.plan);
  return (input.requireSlackDelivery ||
    input.plan.recovery ||
    input.plan.state.outcome === "failure") &&
    !input.slackDelivered
    ? input.previous
    : input.plan.state;
}

export function finalizeSignupAgentReport(input: {
  previous: SignupAgentReportState;
  plan: SignupAgentPlan;
  slackDelivered: boolean;
}): SignupAgentReportState {
  validateAgentPlan(input.plan);
  return (input.plan.recovery || input.plan.state.outcome === "findings") &&
    !input.slackDelivered
    ? input.previous
    : input.plan.state;
}

export function initialSignupE2EReportState(): SignupE2EReportState {
  return {
    version: 1,
    reporter: "signup-e2e",
    outcome: "unknown",
    findingCount: 0,
    runUrl: null,
    reportArtifactUrl: null,
  };
}

export function initialSignupAgentReportState(): SignupAgentReportState {
  return {
    version: 1,
    reporter: "signup-agent",
    outcome: "unknown",
    findingCount: 0,
    reportComplete: false,
    runUrl: null,
    reportArtifactUrl: null,
  };
}

export function legacySignupReportFallbackAllowed(
  rawJobs: string,
  persistStepName: string,
): boolean {
  const value = parseRecord(rawJobs, "previous workflow jobs");
  if (!Array.isArray(value.jobs)) {
    throw new Error("previous workflow jobs have an invalid shape");
  }

  const persistStepConclusions: unknown[] = [];
  for (const job of value.jobs) {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      throw new Error("previous workflow jobs have an invalid shape");
    }
    for (const step of job.steps) {
      if (!isRecord(step) || typeof step.name !== "string") {
        throw new Error("previous workflow steps have an invalid shape");
      }
      if (step.name === persistStepName) {
        persistStepConclusions.push(step.conclusion);
      }
    }
  }
  return persistStepConclusions.every((conclusion) => conclusion === "skipped");
}

export function legacySignupE2ETestStepResult(
  rawJobs: string,
): "failure" | "success" | "unknown" {
  const value = parseRecord(rawJobs, "previous workflow jobs");
  if (!Array.isArray(value.jobs)) {
    throw new Error("previous workflow jobs have an invalid shape");
  }
  const signupJobs = value.jobs.filter(
    (job) => isRecord(job) && job.name === "Full signup flow / Signup canary",
  );
  if (signupJobs.length !== 1) return "unknown";

  const signupJob = signupJobs[0];
  if (!isRecord(signupJob) || !Array.isArray(signupJob.steps)) {
    throw new Error("previous Signup canary job has an invalid shape");
  }
  const testSteps = signupJob.steps.filter(
    (step) => isRecord(step) && step.name === "Run full signup flow",
  );
  if (testSteps.length !== 1 || !isRecord(testSteps[0])) return "unknown";

  const conclusion = testSteps[0].conclusion;
  if (conclusion === "failure" || conclusion === "timed_out") {
    return "failure";
  }
  return conclusion === "success" ? "success" : "unknown";
}

export function legacySignupE2EOutcomeFromJobs(
  rawJobs: string,
  evidence: { available: boolean; inconclusive: boolean },
): "failure" | "clean" | "unknown" {
  const testResult = legacySignupE2ETestStepResult(rawJobs);
  if (testResult === "failure") return "failure";
  if (
    testResult !== "success" ||
    !evidence.available ||
    evidence.inconclusive
  ) {
    return "unknown";
  }
  return "clean";
}

export function parseSignupE2EReportState(raw: string): SignupE2EReportState {
  const value = parseRecord(raw, "signup E2E reporter state");
  if (
    value.version !== 1 ||
    value.reporter !== "signup-e2e" ||
    !isOneOf(value.outcome, ["unknown", "failure", "clean"]) ||
    !isCount(value.findingCount) ||
    !isNullableRunUrl(value.runUrl) ||
    !isNullableArtifactUrl(value.reportArtifactUrl)
  ) {
    throw new Error("signup E2E reporter state has an invalid shape");
  }
  return value as SignupE2EReportState;
}

export function parseSignupAgentReportState(
  raw: string,
): SignupAgentReportState {
  const value = parseRecord(raw, "signup agent reporter state");
  if (
    value.version !== 1 ||
    value.reporter !== "signup-agent" ||
    !isOneOf(value.outcome, ["unknown", "findings", "clean"]) ||
    !isCount(value.findingCount) ||
    typeof value.reportComplete !== "boolean" ||
    !isNullableRunUrl(value.runUrl) ||
    !isNullableArtifactUrl(value.reportArtifactUrl)
  ) {
    throw new Error("signup agent reporter state has an invalid shape");
  }
  return value as SignupAgentReportState;
}

export function planSignupE2EReport(input: {
  previous: SignupE2EReportState;
  eventName: string;
  outcome: "failure" | "clean" | "inconclusive";
  findingCount: number;
  runUrl: string;
  reportArtifactUrl?: string | null;
}): SignupE2EPlan {
  if (!isOneOf(input.outcome, ["failure", "clean", "inconclusive"])) {
    throw new Error("signup E2E report outcome is invalid");
  }
  validateCount(input.findingCount);
  validateRunUrl(input.runUrl);
  if (input.reportArtifactUrl) validateArtifactUrl(input.reportArtifactUrl);

  if (input.eventName !== "schedule" || input.outcome === "inconclusive") {
    return { state: input.previous, recovery: null };
  }

  if (input.outcome === "failure") {
    return {
      state: {
        version: 1,
        reporter: "signup-e2e",
        outcome: "failure",
        findingCount: input.findingCount,
        runUrl: input.runUrl,
        reportArtifactUrl: input.reportArtifactUrl ?? null,
      },
      recovery: null,
    };
  }

  const recovery =
    input.previous.outcome === "failure"
      ? {
          findingCount: input.previous.findingCount,
          previousRunUrl: input.previous.runUrl,
          previousReportArtifactUrl: input.previous.reportArtifactUrl,
        }
      : null;
  return {
    state: {
      version: 1,
      reporter: "signup-e2e",
      outcome: "clean",
      findingCount: 0,
      runUrl: input.runUrl,
      reportArtifactUrl: input.reportArtifactUrl ?? null,
    },
    recovery,
  };
}

export function planSignupAgentReport(input: {
  previous: SignupAgentReportState;
  eventName: string;
  outcome: "findings" | "clean" | "incomplete" | "inconclusive";
  findingCount: number;
  reportComplete: boolean;
  runUrl: string;
  reportArtifactUrl?: string | null;
}): SignupAgentPlan {
  if (
    !isOneOf(input.outcome, ["findings", "clean", "incomplete", "inconclusive"])
  ) {
    throw new Error("signup agent report outcome is invalid");
  }
  validateCount(input.findingCount);
  validateRunUrl(input.runUrl);
  if (input.reportArtifactUrl) validateArtifactUrl(input.reportArtifactUrl);

  if (input.eventName !== "schedule" || input.outcome === "inconclusive") {
    return { state: input.previous, recovery: null };
  }

  if (input.outcome === "findings" && input.findingCount > 0) {
    return {
      state: {
        version: 1,
        reporter: "signup-agent",
        outcome: "findings",
        findingCount: input.findingCount,
        reportComplete: input.reportComplete,
        runUrl: input.runUrl,
        reportArtifactUrl: input.reportArtifactUrl ?? null,
      },
      recovery: null,
    };
  }

  if (input.outcome !== "clean" || !input.reportComplete) {
    return { state: input.previous, recovery: null };
  }

  const recovery =
    input.previous.outcome === "findings" && input.previous.findingCount > 0
      ? {
          findingCount: input.previous.findingCount,
          previousReportComplete: input.previous.reportComplete,
          previousRunUrl: input.previous.runUrl,
          previousReportArtifactUrl: input.previous.reportArtifactUrl,
        }
      : null;
  return {
    state: {
      version: 1,
      reporter: "signup-agent",
      outcome: "clean",
      findingCount: 0,
      reportComplete: true,
      runUrl: input.runUrl,
      reportArtifactUrl: input.reportArtifactUrl ?? null,
    },
    recovery,
  };
}

export function renderSignupE2ERecovery(input: {
  recovery: NonNullable<SignupE2EPlan["recovery"]>;
  runUrl: string;
  reportArtifactUrl?: string | null;
}): string {
  validateRunUrl(input.runUrl);
  if (input.reportArtifactUrl) validateArtifactUrl(input.reportArtifactUrl);
  const recoveryCount = input.recovery.findingCount;
  const priorDetails = input.recovery.previousReportArtifactUrl
    ? `Previous failure details: ${slackLink(input.recovery.previousReportArtifactUrl, "previous report artifact")}.`
    : input.recovery.previousRunUrl
      ? `Previous failed run: ${slackLink(input.recovery.previousRunUrl, "workflow run")}.`
      : "Previous failure details are available in the task run history.";
  const currentDetails = input.reportArtifactUrl
    ? `Current signup test evidence: ${slackLink(input.reportArtifactUrl, "test-result artifact")}.`
    : `Current evidence: ${slackLink(input.runUrl, "workflow run")}.`;
  return [
    ":white_check_mark: *Signup E2E recovered*",
    recoveryCount > 0
      ? `A complete scheduled pass cleared ${recoveryCount} finding${recoveryCount === 1 ? "" : "s"} from the previous failed run.`
      : "A complete scheduled pass follows the previous failed run.",
    priorDetails,
    currentDetails,
    `Recovery run: ${slackLink(input.runUrl, "workflow run")}`,
  ].join("\n");
}

export function renderSignupAgentRecovery(input: {
  recovery: NonNullable<SignupAgentPlan["recovery"]>;
  runUrl: string;
  reportArtifactUrl?: string | null;
}): string {
  validateRunUrl(input.runUrl);
  if (input.reportArtifactUrl) validateArtifactUrl(input.reportArtifactUrl);
  const priorDetails = input.recovery.previousReportArtifactUrl
    ? `Previous findings: ${slackLink(input.recovery.previousReportArtifactUrl, "previous report artifact")}.`
    : input.recovery.previousRunUrl
      ? `Previous report: ${slackLink(input.recovery.previousRunUrl, "workflow run")}.`
      : "Previous findings are available in the task run history.";
  const currentDetails = input.reportArtifactUrl
    ? `Complete clean review and screenshot evidence: ${slackLink(input.reportArtifactUrl, "current report artifact")}.`
    : `Current evidence: ${slackLink(input.runUrl, "workflow run")}.`;
  const priorWasComplete = input.recovery.previousReportComplete;
  return [
    priorWasComplete
      ? ":white_check_mark: *Signup agent findings cleared*"
      : ":white_check_mark: *Signup agent review found no current findings*",
    priorWasComplete
      ? `A complete clean review cleared ${input.recovery.findingCount} finding${input.recovery.findingCount === 1 ? "" : "s"} from the previous report.`
      : "The previous report was incomplete, so its findings are not individually confirmed as cleared.",
    priorDetails,
    currentDetails,
    `Recovery run: ${slackLink(input.runUrl, "workflow run")}`,
  ].join("\n");
}

function parseRecord(raw: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function validateE2EPlan(plan: SignupE2EPlan): void {
  parseSignupE2EReportState(JSON.stringify(plan.state));
  if (plan.recovery !== null) validateRecovery(plan.recovery);
}

function validateAgentPlan(plan: SignupAgentPlan): void {
  parseSignupAgentReportState(JSON.stringify(plan.state));
  if (plan.recovery !== null) {
    validateRecovery(plan.recovery);
    if (typeof plan.recovery.previousReportComplete !== "boolean") {
      throw new Error("signup agent recovery plan has an invalid shape");
    }
  }
}

function validateRecovery(recovery: {
  findingCount: number;
  previousRunUrl: string | null;
  previousReportArtifactUrl: string | null;
}): void {
  validateCount(recovery.findingCount);
  if (recovery.previousRunUrl !== null) {
    validateRunUrl(recovery.previousRunUrl);
  }
  if (recovery.previousReportArtifactUrl !== null) {
    validateArtifactUrl(recovery.previousReportArtifactUrl);
  }
}

function parseE2EPlan(raw: string): SignupE2EPlan {
  const value = parseRecord(raw, "signup E2E report plan");
  const plan = {
    state: parseSignupE2EReportState(JSON.stringify(value.state) ?? ""),
    recovery: parseRecovery(value.recovery),
  };
  validateE2EPlan(plan);
  return plan;
}

function parseAgentPlan(raw: string): SignupAgentPlan {
  const value = parseRecord(raw, "signup agent report plan");
  const plan = {
    state: parseSignupAgentReportState(JSON.stringify(value.state) ?? ""),
    recovery: parseAgentRecovery(value.recovery),
  };
  validateAgentPlan(plan);
  return plan;
}

function parseAgentRecovery(value: unknown): SignupAgentPlan["recovery"] {
  if (value === null) return null;
  const recovery = parseRecovery(value);
  if (!isRecord(value) || typeof value.previousReportComplete !== "boolean") {
    throw new Error("signup agent recovery plan has an invalid shape");
  }
  return {
    ...recovery,
    previousReportComplete: value.previousReportComplete,
  };
}

function parseRecovery(value: unknown): SignupE2EPlan["recovery"] {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isCount(value.findingCount) ||
    !isNullableRunUrl(value.previousRunUrl) ||
    !isNullableArtifactUrl(value.previousReportArtifactUrl)
  ) {
    throw new Error("signup report recovery plan has an invalid shape");
  }
  return {
    findingCount: value.findingCount,
    previousRunUrl: value.previousRunUrl,
    previousReportArtifactUrl: value.previousReportArtifactUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validateCount(value: number): void {
  if (!isCount(value))
    throw new Error("signup report finding count is invalid");
}

function isNullableRunUrl(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isRunUrl(value));
}

function isNullableArtifactUrl(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isArtifactUrl(value));
}

function validateRunUrl(value: string): void {
  if (!isRunUrl(value)) throw new Error("signup report run URL is invalid");
}

function validateArtifactUrl(value: string): void {
  if (!isArtifactUrl(value)) {
    throw new Error("signup report artifact URL is invalid");
  }
}

function isRunUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/BuilderIO\/agent-native\/actions\/runs\/\d+$/.test(url.pathname)
    );
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function isArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/BuilderIO\/agent-native\/actions\/runs\/\d+\/artifacts\/\d+$/.test(
        url.pathname,
      )
    );
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function slackLink(url: string, label: string): string {
  return `<${url}|${label}>`;
}

function parseArgs(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        `expected flag/value pair near ${key ?? "end of arguments"}`,
      );
    }
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function requireArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

function requireBooleanArg(args: Map<string, string>, name: string): boolean {
  const value = requireArg(args, name);
  if (value !== "true" && value !== "false") {
    throw new Error(`--${name} must be true or false`);
  }
  return value === "true";
}

function readPrevious<T>(path: string, parse: (raw: string) => T): T {
  return parse(readFileSync(path, "utf8"));
}

function runCli(): void {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));

  if (command === "init-e2e") {
    writeFileSync(
      requireArg(args, "out-file"),
      `${JSON.stringify(initialSignupE2EReportState(), null, 2)}\n`,
    );
    return;
  }

  if (command === "init-agent") {
    writeFileSync(
      requireArg(args, "out-file"),
      `${JSON.stringify(initialSignupAgentReportState(), null, 2)}\n`,
    );
    return;
  }

  if (command === "legacy-fallback-allowed") {
    process.stdout.write(
      String(
        legacySignupReportFallbackAllowed(
          readFileSync(requireArg(args, "jobs-file"), "utf8"),
          requireArg(args, "persist-step-name"),
        ),
      ),
    );
    return;
  }

  if (command === "legacy-e2e-outcome") {
    process.stdout.write(
      legacySignupE2EOutcomeFromJobs(
        readFileSync(requireArg(args, "jobs-file"), "utf8"),
        {
          available: requireBooleanArg(args, "signup-evidence-available"),
          inconclusive: requireBooleanArg(args, "signup-evidence-inconclusive"),
        },
      ),
    );
    return;
  }

  if (command === "legacy-e2e-test-result") {
    process.stdout.write(
      legacySignupE2ETestStepResult(
        readFileSync(requireArg(args, "jobs-file"), "utf8"),
      ),
    );
    return;
  }

  if (command === "validate-e2e-state") {
    parseSignupE2EReportState(
      readFileSync(requireArg(args, "state-file"), "utf8"),
    );
    return;
  }

  if (command === "finalize-e2e") {
    const previous = readPrevious(
      requireArg(args, "previous-state"),
      parseSignupE2EReportState,
    );
    const plan = parseE2EPlan(readFileSync(requireArg(args, "plan"), "utf8"));
    const state = finalizeSignupE2EReport({
      previous,
      plan,
      slackDelivered: requireBooleanArg(args, "slack-delivered"),
      requireSlackDelivery: requireBooleanArg(args, "require-slack-delivery"),
    });
    writeFileSync(
      requireArg(args, "out-file"),
      `${JSON.stringify(state, null, 2)}\n`,
    );
    return;
  }

  if (command === "finalize-agent") {
    const previous = readPrevious(
      requireArg(args, "previous-state"),
      parseSignupAgentReportState,
    );
    const plan = parseAgentPlan(readFileSync(requireArg(args, "plan"), "utf8"));
    const state = finalizeSignupAgentReport({
      previous,
      plan,
      slackDelivered: requireBooleanArg(args, "slack-delivered"),
    });
    writeFileSync(
      requireArg(args, "out-file"),
      `${JSON.stringify(state, null, 2)}\n`,
    );
    return;
  }

  const previousPath = requireArg(args, "previous-state");
  const eventName = requireArg(args, "event");
  const runUrl = requireArg(args, "run-url");
  const reportArtifactUrl = args.get("report-artifact-url") || null;
  const outDir = requireArg(args, "out-dir");
  mkdirSync(outDir, { recursive: true });

  if (command === "plan-e2e") {
    const plan = planSignupE2EReport({
      previous: readPrevious(previousPath, parseSignupE2EReportState),
      eventName,
      outcome: requireArg(args, "outcome") as
        | "failure"
        | "clean"
        | "inconclusive",
      findingCount: Number(requireArg(args, "finding-count")),
      runUrl,
      reportArtifactUrl,
    });
    writeFileSync(
      resolve(outDir, "plan.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    if (plan.recovery) {
      writeFileSync(
        resolve(outDir, "recovery.txt"),
        `${renderSignupE2ERecovery({
          recovery: plan.recovery,
          runUrl,
          reportArtifactUrl,
        })}\n`,
      );
    }
    writeRecoveryOutput(Boolean(plan.recovery));
    return;
  }

  if (command === "plan-agent") {
    const plan = planSignupAgentReport({
      previous: readPrevious(previousPath, parseSignupAgentReportState),
      eventName,
      outcome: requireArg(args, "outcome") as
        | "findings"
        | "clean"
        | "incomplete"
        | "inconclusive",
      findingCount: Number(requireArg(args, "finding-count")),
      reportComplete: requireBooleanArg(args, "report-complete"),
      runUrl,
      reportArtifactUrl,
    });
    writeFileSync(
      resolve(outDir, "plan.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    if (plan.recovery) {
      writeFileSync(
        resolve(outDir, "recovery.txt"),
        `${renderSignupAgentRecovery({
          recovery: plan.recovery,
          runUrl,
          reportArtifactUrl,
        })}\n`,
      );
    }
    writeRecoveryOutput(Boolean(plan.recovery));
    return;
  }

  throw new Error(`unknown command: ${command ?? ""}`);
}

function writeRecoveryOutput(recovered: boolean): void {
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `recovered=${recovered}\n`, {
      flag: "a",
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `::error::Could not plan signup report continuity: ${message}`,
    );
    process.exitCode = 1;
  }
}
