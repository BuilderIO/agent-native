import { isActionContractError } from "@agent-native/core/action";
import {
  BuilderBranchError,
  getBuilderBranchStatus,
  runBuilderAgent,
  sendBuilderBranchMessage,
  type BuilderBranchStatus,
} from "@agent-native/core/server";

import {
  assessBuilderDispatch,
  readBuilderDispatchFields,
} from "../lib/builder-dispatch-gate.js";
import { canonicalGitHubRepository } from "../lib/github-repository.js";
import type { TripwireSink } from "../tripwire/types.js";
import type { OperationResult, SideEffect } from "../workflow/adapter.js";
import type { WorkflowErrorCode } from "../workflow/contract.js";
import type { OperationDefinition } from "../workflow/operations.js";

/** How long a branch may sit idle with no pull request before it reads as stuck. */
export const DEFAULT_BUILDER_STUCK_AFTER_MS = 30 * 60_000;

export interface BuilderOperationDeps {
  startAgent: typeof runBuilderAgent;
  getStatus: typeof getBuilderBranchStatus;
  sendMessage: typeof sendBuilderBranchMessage;
  now(): Date;
  stuckAfterMs: number;
  /**
   * The workflow's `builderProjectId`: the project that holds its repository.
   * It fills in an operation whose own `projectId` is blank, and never
   * replaces one that names a project.
   */
  projectId?: string;
  /**
   * The workflow's `extras.repository`: where its pull requests are expected.
   * A check that finds Builder's pull request in another repository fails
   * rather than hand on a number that names a different pull request here.
   */
  repository?: string;
}

const defaultBuilderDeps: BuilderOperationDeps = {
  startAgent: runBuilderAgent,
  getStatus: getBuilderBranchStatus,
  sendMessage: sendBuilderBranchMessage,
  now: () => new Date(),
  stuckAfterMs: DEFAULT_BUILDER_STUCK_AFTER_MS,
};

type BuilderTaskState = "working" | "stuck" | "completed" | "failed";

type Failure = Extract<OperationResult, { ok: false }>;

function failure(
  def: OperationDefinition,
  reason: string,
  message: string,
  options: {
    code?: WorkflowErrorCode;
    retryable?: boolean;
    sideEffect?: SideEffect;
  } = {},
): Failure {
  const sideEffect = options.sideEffect ?? "none";
  return {
    ok: false,
    code:
      options.code ??
      (def.effect === "read" ? "lookup_failed" : "provider_error"),
    message: `${message} (${reason})`,
    retryable: sideEffect === "none" && options.retryable === true,
    sideEffect,
  };
}

const RECONNECT =
  "Connect Builder.io in Settings, and make sure the connection has project access.";

type BuilderRoute = "start" | "check" | "followUp" | "branchStatus" | "message";

/**
 * What Builder's answers say about the four things the code assumes: which
 * token each route takes, whether the Background Agents flag is on, whether a
 * branch keeps the name it was started under, and what `queue` does. Observe
 * only: nothing here changes what an operation returns.
 */
interface BuilderObserve {
  semantics(details: Record<string, unknown>): void;
  branchNameChanged(requested: string, returned: string): void;
  routeUnexpected(route: BuilderRoute, details: Record<string, unknown>): void;
  flagOff(details: Record<string, unknown>): void;
  gateBlocked(clauses: readonly string[]): void;
}

const NOT_OBSERVED: BuilderObserve = {
  semantics() {},
  branchNameChanged() {},
  routeUnexpected() {},
  flagOff() {},
  gateBlocked() {},
};

function createObserve(
  tripwire: TripwireSink | undefined,
  def: OperationDefinition,
): BuilderObserve {
  if (!tripwire) return NOT_OBSERVED;
  const builder = (
    code:
      | "builder_queue_semantics"
      | "builder_branch_name_changed"
      | "builder_route_unexpected"
      | "builder_flag_off",
    severity: "info" | "warn" | "error",
    details: Record<string, unknown>,
  ) =>
    tripwire({
      area: "builder",
      code,
      severity,
      operationId: def.id,
      details,
    });
  return {
    semantics: (details) => builder("builder_queue_semantics", "info", details),
    branchNameChanged: (requested, returned) =>
      builder("builder_branch_name_changed", "warn", {
        requestedBranch: requested,
        returnedBranch: returned,
      }),
    routeUnexpected: (route, details) =>
      builder("builder_route_unexpected", "warn", { route, ...details }),
    flagOff: (details) => builder("builder_flag_off", "error", details),
    gateBlocked: (clauses) =>
      tripwire({
        area: "gate",
        code: "dispatch_gate_blocked",
        severity: "info",
        operationId: def.id,
        details: { clauses: clauses.join(","), count: clauses.length },
      }),
  };
}

// Words in Builder's own error text that say a feature, not this request, is
// the problem. Only these words are recorded, never the text around them.
const FEATURE_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["background_agents", /background agents?/i],
  ["feature", /\bfeatures?\b/i],
  ["enabled", /\benabled\b/i],
  ["disabled", /\bdisabled\b/i],
  ["available", /\bavailable\b/i],
  ["upgrade", /\bupgrade\b/i],
  ["plan", /\bplan\b/i],
];

function featureWords(message: string): string[] {
  return FEATURE_WORDS.filter(([, pattern]) => pattern.test(message)).map(
    ([word]) => word,
  );
}

/** The HTTP status core carries on the error of a start that Builder refused; null when the failure never reached an answer. */
function builderStatusOf(error: Error): number | null {
  const status = (error as { builderStatus?: unknown }).builderStatus;
  return typeof status === "number" ? status : null;
}

function observeBranchError(
  observe: BuilderObserve,
  route: BuilderRoute,
  error: BuilderBranchError,
  durationMs: number,
): void {
  observe.routeUnexpected(route, {
    status: error.status,
    code: error.code,
    durationMs,
  });
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

type TaskRef = { projectId: string; branchName: string };

function readTask(
  def: OperationDefinition,
  fields: Readonly<Record<string, unknown>>,
  defaultProjectId: string | undefined,
): TaskRef | Failure {
  const projectId = nonBlank(fields.projectId) ?? nonBlank(defaultProjectId);
  if (!projectId) {
    return failure(
      def,
      "builder_project_missing",
      `${def.id} needs the Builder project that holds this repository. Set builderProjectId in the workflow settings; Factory never starts a task in a starter project`,
      { code: "credential_missing" },
    );
  }
  const branchName = nonBlank(fields.branchName);
  if (!branchName) {
    return failure(
      def,
      "branch_name_missing",
      `${def.id} needs a branch name`,
      {
        code: "graph_invalid",
      },
    );
  }
  return { projectId, branchName };
}

/**
 * How a failed Builder branch call reads to the engine. `sideEffect: maybe`
 * is only for a send that was already on the wire when it failed: Builder may
 * have delivered the message, and a retry would send it twice.
 */
function fromBranchError(
  def: OperationDefinition,
  error: BuilderBranchError,
): Failure {
  const sent = error.operation === "message";
  const reason = `builder_${error.code}`;
  switch (error.code) {
    case "not_connected":
    case "unauthorized":
    case "forbidden":
      return failure(
        def,
        reason,
        `Builder refused or has no connection for ${def.id}. ${RECONNECT}`,
        {
          code: "credential_missing",
        },
      );
    case "timeout":
    case "network_error":
    case "incomplete_response":
    case "invalid_response":
      return sent
        ? failure(
            def,
            reason,
            `Builder may already have received the message for ${def.id}; check the branch before sending again`,
            {
              sideEffect: "maybe",
            },
          )
        : failure(
            def,
            reason,
            `Builder did not answer ${def.id} in a form Factory could read`,
            {
              retryable: error.code !== "invalid_response",
            },
          );
    case "rate_limited":
    case "server_error":
    case "container_unavailable":
    case "credentials_unavailable":
      return failure(
        def,
        reason,
        `Builder could not take ${def.id} right now; it was not delivered`,
        {
          retryable: true,
        },
      );
    case "branch_not_found":
    case "request_rejected":
    case "message_rejected":
    case "invalid_request":
      return failure(def, reason, `Builder rejected ${def.id}`);
  }
}

const BRANCH_FAILED_STATES = new Set(["archived", "deleted"]);

type Lookup =
  | { kind: "found"; status: BuilderBranchStatus }
  | { kind: "absent" }
  | { kind: "failed"; error: BuilderBranchError };

async function lookupBranch(
  deps: BuilderOperationDeps,
  task: TaskRef,
  observe: BuilderObserve,
): Promise<Lookup> {
  const startedAt = Date.now();
  try {
    return { kind: "found", status: await deps.getStatus(task) };
  } catch (error) {
    if (!(error instanceof BuilderBranchError)) throw error;
    if (error.code === "branch_not_found") return { kind: "absent" };
    observeBranchError(observe, "branchStatus", error, Date.now() - startedAt);
    return { kind: "failed", error };
  }
}

function pullRequestNumber(prUrl: string | null): number | null {
  const match = prUrl ? /\/pull\/(\d+)(?:[/?#]|$)/.exec(prUrl) : null;
  return match ? Number(match[1]) : null;
}

/** `owner/name` of the repository a pull request link points into, whatever host serves it; null when the link has no such path. */
function pullRequestRepository(prUrl: string | null): string | null {
  const match = prUrl
    ? /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\/([^/?#]+)\/([^/?#]+)\/pull\/\d+(?:[/?#]|$)/i.exec(
        prUrl,
      )
    : null;
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The workflow's repository as `owner/name`; null when none is set or the setting is not a repository. */
function expectedRepository(setting: string | undefined): string | null {
  if (!setting?.trim()) return null;
  try {
    return canonicalGitHubRepository(setting);
  } catch {
    // coercion-ok: a setting that is not a repository is not a known one; the merge gate refuses it on its own.
    return null;
  }
}

/**
 * Builder's branch state, in the four words a workflow reads. A merged pull
 * request outranks an archived branch, because Builder archives what it
 * finished. Idle with no pull request is only stuck once it has been idle for
 * the window: a branch Builder has recorded nothing for yet is still starting.
 */
export function mapBranchState(
  status: BuilderBranchStatus,
  now: Date,
  stuckAfterMs: number,
): { state: BuilderTaskState; reason: string; idleForMs: number | null } {
  const idleForMs =
    status.lastActivityAt === null
      ? null
      : Math.max(0, now.getTime() - status.lastActivityAt);
  if (BRANCH_FAILED_STATES.has(status.state)) {
    return status.prStatus === "merged"
      ? { state: "completed", reason: "merged_then_archived", idleForMs }
      : { state: "failed", reason: `branch_${status.state}`, idleForMs };
  }
  if (status.agentState === "running") {
    return { state: "working", reason: "agent_running", idleForMs };
  }
  if (status.agentState === "waiting") {
    return { state: "stuck", reason: "agent_waiting_for_input", idleForMs };
  }
  if (status.prUrl) {
    return { state: "completed", reason: "pull_request_open", idleForMs };
  }
  if (idleForMs === null) {
    return status.agentState === null
      ? { state: "working", reason: "no_activity_recorded_yet", idleForMs }
      : { state: "stuck", reason: "idle_with_no_activity_time", idleForMs };
  }
  return idleForMs >= stuckAfterMs
    ? { state: "stuck", reason: "idle_with_no_pull_request", idleForMs }
    : { state: "working", reason: "idle_within_window", idleForMs };
}

async function check(
  def: OperationDefinition,
  task: TaskRef,
  deps: BuilderOperationDeps,
  observe: BuilderObserve,
): Promise<OperationResult> {
  const startedAt = Date.now();
  const looked = await lookupBranch(deps, task, observe);
  const lookedFor = {
    op: "check",
    durationMs: Date.now() - startedAt,
    requestedBranch: task.branchName,
  };
  if (looked.kind === "failed") {
    observe.semantics({
      ...lookedFor,
      outcome: "failed",
      status: looked.error.status,
      code: looked.error.code,
    });
    return fromBranchError(def, looked.error);
  }
  if (looked.kind === "absent") {
    observe.semantics({ ...lookedFor, outcome: "branch_not_found" });
    return {
      ok: true,
      output: {
        state: "failed",
        reason: "branch_not_found",
        agentState: null,
        branchState: "not_found",
        archived: false,
        prStatus: null,
        prUrl: null,
        prNumber: null,
        prRepository: null,
        hasPullRequest: false,
        lastActivityAt: null,
        idleForMs: null,
      },
    };
  }
  const { status } = looked;
  observe.semantics({
    ...lookedFor,
    outcome: "found",
    agentState: status.agentState,
    branchState: status.state,
    prStatus: status.prStatus,
    response: status,
  });
  const mapped = mapBranchState(status, deps.now(), deps.stuckAfterMs);
  const prRepository = pullRequestRepository(status.prUrl);
  const expected = expectedRepository(deps.repository);
  if (
    prRepository &&
    expected &&
    prRepository.toLowerCase() !== expected.toLowerCase()
  ) {
    return failure(
      def,
      "builder_pr_repository_mismatch",
      `Builder opened its pull request in ${prRepository}, not in this workflow's repository ${expected}, so its number would name a different pull request here`,
      { code: "operation_not_allowed" },
    );
  }
  return {
    ok: true,
    output: {
      state: mapped.state,
      reason: mapped.reason,
      agentState: status.agentState,
      branchState: status.state,
      archived: status.archived,
      prStatus: status.prStatus,
      prUrl: status.prUrl,
      prNumber: pullRequestNumber(status.prUrl),
      prRepository,
      hasPullRequest: status.prUrl !== null,
      lastActivityAt:
        status.lastActivityAt === null
          ? null
          : new Date(status.lastActivityAt).toISOString(),
      idleForMs: mapped.idleForMs,
    },
  };
}

function startedOutput(task: TaskRef, extra: Record<string, unknown>) {
  return { accepted: true, ...task, ...extra };
}

/** A start Builder refused or answered badly. Core hides the response, so this reads only the error's own name, code and status. */
function observeStartFailure(
  observe: BuilderObserve,
  error: Error,
  durationMs: number,
): void {
  const errorCode = (error as { errorCode?: unknown }).errorCode;
  const status = builderStatusOf(error);
  const words = featureWords(error.message);
  observe.routeUnexpected("start", {
    status,
    errorName: error.name,
    ...(typeof errorCode === "string" ? { errorCode } : {}),
    durationMs,
  });
  if (
    words.length > 0 &&
    (words.includes("background_agents") || status === 403 || status === 404)
  ) {
    observe.flagOff({ route: "start", status, words: words.join(",") });
  }
}

async function start(
  def: OperationDefinition,
  task: TaskRef,
  fields: Readonly<Record<string, unknown>>,
  owner: string,
  deps: BuilderOperationDeps,
  observe: BuilderObserve,
): Promise<OperationResult> {
  const prompt = nonBlank(fields.prompt);
  if (!prompt) {
    return failure(
      def,
      "prompt_missing",
      `${def.id} needs a task description`,
      {
        code: "graph_invalid",
      },
    );
  }
  // Builder has no idempotency key on this route. The branch name is the key,
  // so a start that already happened (a retry, a second item in the group, a
  // run that lost its receipt) is found here instead of being started again.
  const existing = await lookupBranch(deps, task, observe);
  if (existing.kind === "failed") {
    return fromBranchError(def, existing.error);
  }
  if (existing.kind === "found") {
    observe.semantics({
      op: "start",
      outcome: "branch_exists",
      requestedBranch: task.branchName,
      branchState: existing.status.state,
    });
    return existing.status.state === "active"
      ? {
          ok: true,
          output: startedOutput(task, { reused: true, status: "existing" }),
          externalRef: task.branchName,
        }
      : failure(
          def,
          "builder_branch_not_active",
          `Builder branch ${task.branchName} already exists but is ${existing.status.state}, so a new task cannot reuse its name`,
        );
  }

  const startedAt = Date.now();
  try {
    const started = await deps.startAgent({
      prompt,
      projectId: task.projectId,
      branchName: task.branchName,
      userEmail: nonBlank(fields.userEmail) ?? owner,
    });
    observe.semantics({
      op: "start",
      outcome: "started",
      durationMs: Date.now() - startedAt,
      requestedBranch: task.branchName,
      returnedBranch: started.branchName,
      status: started.status,
      response: started,
    });
    if (started.branchName !== task.branchName) {
      observe.branchNameChanged(task.branchName, started.branchName);
    }
    return {
      ok: true,
      output: startedOutput(
        { projectId: started.projectId, branchName: started.branchName },
        { status: started.status, url: started.url },
      ),
      externalRef: started.branchName,
      url: started.url,
    };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    observeStartFailure(observe, error, Date.now() - startedAt);
    if (
      isActionContractError(error) &&
      (error.errorCode === "builder_not_connected" ||
        error.errorCode === "builder_legacy_public_key_required")
    ) {
      return failure(
        def,
        error.errorCode,
        `Builder is not connected for ${def.id}. ${RECONNECT}`,
        {
          code: "credential_missing",
        },
      );
    }
    // Core words these as plain errors, so whether Builder made the branch is
    // only known by asking it.
    const transient = /timed out|fetch failed|network|ECONN|ETIMEDOUT/i.test(
      error.message,
    );
    const verify = await lookupBranch(deps, task, observe);
    if (verify.kind === "found" && verify.status.state === "active") {
      return {
        ok: true,
        output: startedOutput(task, { recovered: true, status: "existing" }),
        externalRef: task.branchName,
      };
    }
    if (verify.kind === "absent") {
      return failure(
        def,
        "builder_start_failed",
        `Builder did not start the task for ${def.id}`,
        {
          retryable: transient,
        },
      );
    }
    return failure(
      def,
      "builder_start_outcome_unknown",
      `Builder may have started the task for ${def.id}, and Factory could not confirm either way; check the branch before starting again`,
      { sideEffect: "maybe" },
    );
  }
}

async function followUp(
  def: OperationDefinition,
  task: TaskRef,
  fields: Readonly<Record<string, unknown>>,
  deps: BuilderOperationDeps,
  observe: BuilderObserve,
): Promise<OperationResult> {
  const message = nonBlank(fields.userMessage);
  if (!message) {
    return failure(def, "message_missing", `${def.id} needs a message`, {
      code: "graph_invalid",
    });
  }
  const startedAt = Date.now();
  let sent: Awaited<ReturnType<typeof deps.sendMessage>>;
  try {
    sent = await deps.sendMessage({ ...task, message });
  } catch (error) {
    if (!(error instanceof BuilderBranchError)) throw error;
    const durationMs = Date.now() - startedAt;
    observeBranchError(observe, "message", error, durationMs);
    observe.semantics({
      op: "followUp",
      outcome: "failed",
      durationMs,
      requestedBranch: task.branchName,
      status: error.status,
      code: error.code,
      queue: true,
    });
    return fromBranchError(def, error);
  }
  // Core's message route always asks Builder to queue the message.
  observe.semantics({
    op: "followUp",
    outcome: "accepted",
    durationMs: Date.now() - startedAt,
    requestedBranch: task.branchName,
    queue: true,
    response: sent,
  });
  return {
    ok: true,
    output: { accepted: true, ...task },
    externalRef: task.branchName,
  };
}

/**
 * The dispatch gate for `builder.start`: only a clear, low-risk, high-confidence
 * bug with no product or design question, that nobody has claimed and that
 * touches nothing never started automatically. Its inputs are fields of the
 * operation, so a graph cannot start Builder without binding every one. A
 * refusal is final: nothing was sent, and the same inputs would be refused again.
 */
function refuseUngatedStart(
  def: OperationDefinition,
  fields: Readonly<Record<string, unknown>>,
  observe: BuilderObserve,
): Failure | undefined {
  const read = readBuilderDispatchFields(fields);
  const refusal = read.ok ? assessBuilderDispatch(read.input) : read.refusal;
  if (refusal.allowed) return undefined;
  observe.gateBlocked(refusal.reasonCodes);
  return failure(
    def,
    "builder_dispatch_refused",
    `The Builder dispatch gate refused ${def.id}: ${refusal.reasonCodes.join(", ")}. ${refusal.message}`,
    { code: "operation_not_allowed" },
  );
}

/** Runs `builder.start`, `builder.check` or `builder.followUp` against Builder's branch API. */
export async function executeBuilderOperation(input: {
  operation: OperationDefinition;
  fields: Readonly<Record<string, unknown>>;
  /** The job owner's email: who a started task is attributed to when the graph names no one. */
  owner: string;
  signal: AbortSignal;
  /** Where Builder's answers are reported; absent in a spec that does not look at them. */
  tripwire?: TripwireSink;
  deps?: Partial<BuilderOperationDeps>;
}): Promise<OperationResult> {
  const def = input.operation;
  if (def.implementation.type !== "builder") {
    throw new TypeError(`${def.id} is not a builder operation.`);
  }
  const deps = { ...defaultBuilderDeps, ...input.deps };
  const observe = createObserve(input.tripwire, def);
  if (input.signal.aborted) {
    return failure(
      def,
      "run_stopped",
      `The run stopped before ${def.id} started`,
      {
        code: "budget_paused",
      },
    );
  }
  // Before anything reaches Builder, and before the project is even read: the
  // gate is not something a graph can route around.
  if (def.implementation.op === "start") {
    const refused = refuseUngatedStart(def, input.fields, observe);
    if (refused) return refused;
  }
  const task = readTask(def, input.fields, deps.projectId);
  if ("ok" in task) return task;
  switch (def.implementation.op) {
    case "start":
      return start(def, task, input.fields, input.owner, deps, observe);
    case "check":
      return check(def, task, deps, observe);
    case "followUp":
      return followUp(def, task, input.fields, deps, observe);
  }
}
