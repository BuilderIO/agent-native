import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type HealthNotification = {
  id: string;
  kind: "incident" | "incident-update" | "recovery";
  runUrl: string;
  signature?: string;
  failing?: string;
  totalFindings?: number;
  omittedFindings?: number;
  detailsTruncated?: boolean;
  reportArtifactUrl?: string;
};

export type HealthReportState = {
  version: 1;
  incidentActive: boolean;
  failureSignature: string | null;
  lastScheduledHealthOutcome: "success" | "failure" | null;
  lastScheduledHealthAt: string | null;
  latestHealthFailureAt: string | null;
  pendingNotifications: HealthNotification[];
};

export type HealthReportInput = {
  state: HealthReportState;
  healthOutcome: "success" | "failure";
  eventName: string;
  historyRead: "ok" | "unavailable";
  observedAt: string;
  runId: string;
  runAttempt: string;
  runUrl: string;
  failingLog: string;
};

export type HealthReportPlan = {
  state: HealthReportState;
  notification: HealthNotification | null;
  signature: string | null;
  failing: string | null;
  totalFindings: number;
  omittedFindings: number;
  detailsTruncated: boolean;
};

const MAX_PENDING_NOTIFICATIONS = 100;
const MAX_FAILURE_DETAILS_LENGTH = 5_000;
const STATE_PERSISTENCE_STEP = "Persist health reporter state";

export function hasSuccessfulStatePersistenceStep(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    throw new Error("health reporter previous run has an invalid job list");
  }

  return value.jobs.some((job, jobIndex) => {
    if (!isRecord(job)) {
      throw new Error(
        `health reporter previous run has an invalid job at index ${jobIndex}`,
      );
    }
    if (job.steps === undefined) return false;
    if (!Array.isArray(job.steps)) {
      throw new Error(
        `health reporter previous run has an invalid steps list at job ${jobIndex}`,
      );
    }

    return job.steps.some((step, stepIndex) => {
      if (!isRecord(step)) {
        throw new Error(
          `health reporter previous run has an invalid step at job ${jobIndex}, index ${stepIndex}`,
        );
      }
      return (
        step.name === STATE_PERSISTENCE_STEP && step.conclusion === "success"
      );
    });
  });
}

export function initialHealthReportState(): HealthReportState {
  return {
    version: 1,
    incidentActive: false,
    failureSignature: null,
    lastScheduledHealthOutcome: null,
    lastScheduledHealthAt: null,
    latestHealthFailureAt: null,
    pendingNotifications: [],
  };
}

export function parseHealthReportState(raw: string): HealthReportState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("health reporter state is not valid JSON");
  }

  if (!isRecord(value) || value.version !== 1) {
    throw new Error("health reporter state has an unsupported version");
  }
  if (typeof value.incidentActive !== "boolean") {
    throw new Error(
      "health reporter state has an invalid incidentActive value",
    );
  }
  if (
    value.failureSignature !== null &&
    typeof value.failureSignature !== "string"
  ) {
    throw new Error(
      "health reporter state has an invalid failureSignature value",
    );
  }
  if (
    value.lastScheduledHealthOutcome !== null &&
    value.lastScheduledHealthOutcome !== "success" &&
    value.lastScheduledHealthOutcome !== "failure"
  ) {
    throw new Error(
      "health reporter state has an invalid lastScheduledHealthOutcome value",
    );
  }
  for (const field of [
    "lastScheduledHealthAt",
    "latestHealthFailureAt",
  ] as const) {
    const timestamp = value[field];
    if (
      timestamp !== null &&
      (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)))
    ) {
      throw new Error(`health reporter state has an invalid ${field} value`);
    }
  }
  if (!Array.isArray(value.pendingNotifications)) {
    throw new Error(
      "health reporter state has an invalid pendingNotifications list",
    );
  }

  const pendingNotifications = value.pendingNotifications.map(
    (entry, index) => {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        (entry.kind !== "incident" &&
          entry.kind !== "incident-update" &&
          entry.kind !== "recovery") ||
        typeof entry.runUrl !== "string" ||
        (entry.signature !== undefined &&
          typeof entry.signature !== "string") ||
        (entry.failing !== undefined && typeof entry.failing !== "string") ||
        (entry.totalFindings !== undefined &&
          (!Number.isInteger(entry.totalFindings) ||
            entry.totalFindings < 0)) ||
        (entry.omittedFindings !== undefined &&
          (!Number.isInteger(entry.omittedFindings) ||
            entry.omittedFindings < 0)) ||
        (entry.detailsTruncated !== undefined &&
          typeof entry.detailsTruncated !== "boolean") ||
        (entry.reportArtifactUrl !== undefined &&
          typeof entry.reportArtifactUrl !== "string")
      ) {
        throw new Error(
          `health reporter state has an invalid notification at index ${index}`,
        );
      }
      return entry as HealthNotification;
    },
  );

  if (pendingNotifications.length > MAX_PENDING_NOTIFICATIONS) {
    throw new Error(
      "health reporter state has too many pending Slack notifications",
    );
  }

  return {
    version: 1,
    incidentActive: value.incidentActive,
    failureSignature: value.failureSignature,
    lastScheduledHealthOutcome: value.lastScheduledHealthOutcome,
    lastScheduledHealthAt: value.lastScheduledHealthAt,
    latestHealthFailureAt: value.latestHealthFailureAt,
    pendingNotifications,
  };
}

export function extractFailureDetails(log: string): {
  failing: string;
  signature: string;
  totalFindings: number;
  omittedFindings: number;
  detailsTruncated: boolean;
} {
  const failures = log
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:✗|!)\s/.test(line));
  const totalFindings = failures.length || 1;
  const allDetails =
    failures.length > 0
      ? failures
      : ["(the health audit failed before per-app details were available)"];
  const visible: string[] = [];
  let used = 0;
  for (const line of allDetails) {
    const size = Array.from(`${line}\n`).length;
    if (used + size > MAX_FAILURE_DETAILS_LENGTH) break;
    visible.push(line);
    used += size;
  }
  const failing =
    visible.join("\n") || allDetails[0]!.slice(0, MAX_FAILURE_DETAILS_LENGTH);
  const visibleFindingCount = visible.length || 1;
  const detailsTruncated =
    visible.length === 0 && allDetails[0]!.length > MAX_FAILURE_DETAILS_LENGTH;
  const omittedFindings = Math.max(0, totalFindings - visibleFindingCount);
  const signature = createHash("sha256")
    .update(allDetails.join("\n").replace(/\d/g, ""))
    .digest("hex")
    .slice(0, 12);
  return {
    failing,
    signature,
    totalFindings,
    omittedFindings,
    detailsTruncated,
  };
}

export function planHealthReport(input: HealthReportInput): HealthReportPlan {
  const state = structuredClone(input.state);
  let signature: string | null = null;
  let failing: string | null = null;
  let totalFindings = 0;
  let omittedFindings = 0;
  let detailsTruncated = false;
  const scheduled = input.eventName === "schedule";
  const failureConfirmed =
    !scheduled ||
    input.historyRead === "unavailable" ||
    state.lastScheduledHealthOutcome === "failure";
  const recoveryConfirmed =
    !scheduled ||
    (state.lastScheduledHealthOutcome === "success" &&
      Boolean(state.lastScheduledHealthAt) &&
      Boolean(state.latestHealthFailureAt) &&
      state.lastScheduledHealthAt! > state.latestHealthFailureAt!);

  if (input.healthOutcome === "failure") {
    const details = extractFailureDetails(input.failingLog);
    failing = details.failing;
    signature = details.signature;
    totalFindings = details.totalFindings;
    omittedFindings = details.omittedFindings;
    detailsTruncated = details.detailsTruncated;
    state.latestHealthFailureAt = input.observedAt;
    if (scheduled) {
      state.lastScheduledHealthOutcome = "failure";
      state.lastScheduledHealthAt = input.observedAt;
    }
    if (state.incidentActive) {
      const changed = state.failureSignature !== details.signature;
      state.failureSignature = details.signature;
      if (changed) {
        enqueueIncidentUpdate(state, {
          id: `${input.runId}-${input.runAttempt}-incident-update`,
          kind: "incident-update",
          runUrl: input.runUrl,
          signature: details.signature,
          failing: details.failing,
          totalFindings: details.totalFindings,
          omittedFindings: details.omittedFindings,
          detailsTruncated: details.detailsTruncated,
        });
      }
    } else if (failureConfirmed) {
      state.incidentActive = true;
      state.failureSignature = details.signature;
      enqueueNotification(state, {
        id: `${input.runId}-${input.runAttempt}-incident`,
        kind: "incident",
        runUrl: input.runUrl,
        signature: details.signature,
        failing: details.failing,
        totalFindings: details.totalFindings,
        omittedFindings: details.omittedFindings,
        detailsTruncated: details.detailsTruncated,
      });
    }
  } else {
    if (scheduled) {
      state.lastScheduledHealthOutcome = "success";
      state.lastScheduledHealthAt = input.observedAt;
    }
    if (state.incidentActive && recoveryConfirmed) {
      state.incidentActive = false;
      state.failureSignature = null;
      enqueueNotification(state, {
        id: `${input.runId}-${input.runAttempt}-recovery`,
        kind: "recovery",
        runUrl: input.runUrl,
      });
    }
  }

  return {
    state,
    notification: state.pendingNotifications[0] ?? null,
    signature,
    failing,
    totalFindings,
    omittedFindings,
    detailsTruncated,
  };
}

export function acknowledgeHealthNotification(
  state: HealthReportState,
  notificationId: string,
): HealthReportState {
  const index = state.pendingNotifications.findIndex(
    ({ id }) => id === notificationId,
  );
  if (index === -1) {
    throw new Error(
      `health reporter notification ${notificationId} is not pending`,
    );
  }
  return {
    ...state,
    pendingNotifications: state.pendingNotifications.filter(
      (_, itemIndex) => itemIndex !== index,
    ),
  };
}

export function renderHealthNotification(
  notification: HealthNotification,
): string {
  if (notification.kind === "recovery") {
    return [
      ":white_check_mark: *Production health recovered*",
      "The fleet passed the scheduled recovery threshold.",
      `<${notification.runUrl}|View the GitHub Actions run>.`,
    ].join("\n");
  }

  const details = (
    notification.failing ?? "(failure details unavailable)"
  ).replace(/`/g, "'");
  const totalFindings = notification.totalFindings ?? 1;
  const omittedFindings = notification.omittedFindings ?? 0;
  return [
    notification.kind === "incident-update"
      ? ":rotating_light: *Production health incident updated*"
      : ":rotating_light: *Production health incident*",
    notification.kind === "incident-update"
      ? "The active incident's failing app set changed."
      : "The 15-minute production health audit is failing.",
    `Health signature: \`${notification.signature ?? "unknown"}\``,
    `Findings: ${totalFindings} total; showing ${totalFindings - omittedFindings}; ${omittedFindings} omitted from this Slack message.`,
    "```",
    details,
    "```",
    ...(omittedFindings > 0
      ? [
          `${omittedFindings} additional failing checks are in the full report artifact.`,
        ]
      : []),
    ...(notification.detailsTruncated
      ? [
          "At least one failure detail was truncated; the full report artifact has the complete log.",
        ]
      : []),
    ...(notification.reportArtifactUrl
      ? [
          `Full report and log: <${notification.reportArtifactUrl}|90-day health report artifact>.`,
        ]
      : ["Full report artifact is unavailable; see the workflow run logs."]),
    `<${notification.runUrl}|View the GitHub Actions run>.`,
  ].join("\n");
}

export function renderDegradedHealthNotification(input: {
  healthOutcome: "success" | "failure";
  historyRead: "ok" | "unavailable";
  runUrl: string;
  failingLog: string;
  reportArtifactUrl?: string;
}): string {
  const details =
    input.healthOutcome === "failure"
      ? extractFailureDetails(input.failingLog)
      : {
          failing: "No failing health checks.",
          totalFindings: 0,
          omittedFindings: 0,
          detailsTruncated: false,
        };
  const history =
    input.historyRead === "unavailable"
      ? "Prior Actions history or reporter state could not be read."
      : "Prior reporter state could not be read.";
  return [
    ":warning: *Production health report is degraded*",
    input.healthOutcome === "failure"
      ? "The current health audit failed."
      : "The current health audit passed.",
    `${history} Deduplication and incident history are unknown; the report job will fail after delivery.`,
    `Findings: ${details.totalFindings} total; showing ${details.totalFindings - details.omittedFindings}; ${details.omittedFindings} omitted from this Slack message.`,
    "```",
    details.failing,
    "```",
    ...(details.omittedFindings > 0
      ? [
          `${details.omittedFindings} additional failing checks are in the full report artifact.`,
        ]
      : []),
    ...(details.detailsTruncated
      ? [
          "At least one failure detail was truncated; the full report artifact has the complete log.",
        ]
      : []),
    ...(input.reportArtifactUrl
      ? [
          `Full report and log: <${input.reportArtifactUrl}|90-day health report artifact>.`,
        ]
      : ["Full report artifact is unavailable; see the workflow run logs."]),
    `<${input.runUrl}|View the workflow run and state-read error>.`,
  ].join("\n");
}

function enqueueNotification(
  state: HealthReportState,
  notification: HealthNotification,
): void {
  if (state.pendingNotifications.some(({ id }) => id === notification.id))
    return;
  if (state.pendingNotifications.length >= MAX_PENDING_NOTIFICATIONS) {
    throw new Error(
      "health reporter state cannot queue another Slack notification",
    );
  }
  state.pendingNotifications.push(notification);
}

function enqueueIncidentUpdate(
  state: HealthReportState,
  notification: HealthNotification,
): void {
  const pendingIndex = state.pendingNotifications.findIndex(
    ({ kind }) => kind === "incident-update",
  );
  if (pendingIndex !== -1) {
    state.pendingNotifications[pendingIndex] = notification;
    return;
  }
  enqueueNotification(state, notification);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type CliArgs = Record<string, string>;

function parseCliArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--"))
      throw new Error(`unexpected argument: ${key ?? ""}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${key}`);
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function requireArg(args: CliArgs, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`missing --${key}`);
  return value;
}

function writeState(path: string, state: HealthReportState): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function runPlan(args: CliArgs): void {
  const statePath = requireArg(args, "state");
  const state = parseHealthReportState(readFileSync(statePath, "utf8"));
  const outcome = requireArg(args, "outcome");
  if (outcome !== "success" && outcome !== "failure") {
    throw new Error(`unsupported health outcome: ${outcome}`);
  }
  const historyRead = requireArg(args, "history-read");
  if (historyRead !== "ok" && historyRead !== "unavailable") {
    throw new Error(`unsupported history status: ${historyRead}`);
  }

  const plan = planHealthReport({
    state,
    healthOutcome: outcome,
    eventName: requireArg(args, "event"),
    historyRead,
    observedAt: requireArg(args, "observed-at"),
    runId: requireArg(args, "run-id"),
    runAttempt: requireArg(args, "run-attempt"),
    runUrl: requireArg(args, "run-url"),
    failingLog: args["failing-log"]
      ? readFileSync(args["failing-log"], "utf8")
      : "",
  });
  writeState(statePath, plan.state);

  const outputPath = requireArg(args, "output");
  const output = {
    notification: plan.notification,
    signature: plan.signature,
    failing: plan.failing,
    incidentActive: plan.state.incidentActive,
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  if (plan.notification) {
    const channel = requireArg(args, "slack-channel");
    const payloadPath = requireArg(args, "slack-payload");
    const payload = {
      channel,
      text: renderHealthNotification(plan.notification),
      unfurl_links: false,
      unfurl_media: false,
    };
    writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(
      githubOutput,
      `notification_id=${plan.notification?.id ?? ""}\n`,
    );
    appendFileSync(
      githubOutput,
      `notification_kind=${plan.notification?.kind ?? ""}\n`,
    );
    appendFileSync(
      githubOutput,
      `incident_active=${plan.state.incidentActive}\n`,
    );
  }
}

function runAcknowledge(args: CliArgs): void {
  const statePath = requireArg(args, "state");
  const state = parseHealthReportState(readFileSync(statePath, "utf8"));
  const updated = acknowledgeHealthNotification(
    state,
    requireArg(args, "notification-id"),
  );
  writeState(statePath, updated);
}

function runAttachReport(args: CliArgs): void {
  const statePath = requireArg(args, "state");
  const state = parseHealthReportState(readFileSync(statePath, "utf8"));
  const notificationId = requireArg(args, "notification-id");
  const reportUrl = requireArg(args, "report-url");
  const index = state.pendingNotifications.findIndex(
    ({ id }) => id === notificationId,
  );
  if (index === -1) {
    throw new Error(
      `health reporter notification ${notificationId} is not pending`,
    );
  }
  const current = state.pendingNotifications[index]!;
  const notification = {
    ...current,
    reportArtifactUrl: current.reportArtifactUrl ?? reportUrl,
  };
  state.pendingNotifications[index] = notification;
  writeState(statePath, state);

  const payload = {
    channel: requireArg(args, "slack-channel"),
    text: renderHealthNotification(notification),
    unfurl_links: false,
    unfurl_media: false,
  };
  writeFileSync(
    requireArg(args, "slack-payload"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function runDegraded(args: CliArgs): void {
  const payload = {
    channel: requireArg(args, "slack-channel"),
    text: renderDegradedHealthNotification({
      healthOutcome: requireArg(args, "outcome") as "success" | "failure",
      historyRead: requireArg(args, "history-read") as "ok" | "unavailable",
      runUrl: requireArg(args, "run-url"),
      failingLog: readFileSync(requireArg(args, "failing-log"), "utf8"),
      reportArtifactUrl: args["report-url"],
    }),
    unfurl_links: false,
    unfurl_media: false,
  };
  writeFileSync(
    requireArg(args, "slack-payload"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function runValidate(args: CliArgs): void {
  parseHealthReportState(readFileSync(requireArg(args, "state"), "utf8"));
}

function runPersistenceStatus(args: CliArgs): void {
  const jobs = JSON.parse(readFileSync(requireArg(args, "jobs"), "utf8"));
  process.stdout.write(`${hasSuccessfulStatePersistenceStep(jobs)}\n`);
}

function main(): void {
  const command = process.argv[2];
  const args = parseCliArgs(process.argv.slice(3));
  if (command === "plan") return runPlan(args);
  if (command === "ack") return runAcknowledge(args);
  if (command === "attach-report") return runAttachReport(args);
  if (command === "degraded") return runDegraded(args);
  if (command === "validate") return runValidate(args);
  if (command === "persistence-status") return runPersistenceStatus(args);
  throw new Error(`unknown command: ${command ?? ""}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::Health reporter failed: ${message}`);
    process.exitCode = 1;
  }
}
