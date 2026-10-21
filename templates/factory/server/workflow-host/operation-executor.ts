import { randomUUID } from "node:crypto";

import {
  executeAgentToolCall,
  loadActionsFromStaticRegistry,
  type ActionEntry,
  type AgentToolCallExecutionResult,
} from "@agent-native/core/server";

import { FACTORY_APP_ID } from "../lib/provider-api.js";
import {
  collectFailureFlags,
  connectionAdvice,
  failureFlagFor,
  type FailureFlag,
} from "../lib/workflow-action-errors.js";
import {
  noteCredentialSource,
  withRunObserver,
  type RunObserver,
} from "../lib/workflow-run-observer.js";
import type {
  OperationExecutor,
  OperationRequest,
  OperationResult,
  SideEffect,
} from "../workflow/adapter.js";
import {
  WORKFLOW_ERROR_CODES,
  type WorkflowErrorCode,
  type WorkflowSettings,
} from "../workflow/contract.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  executeBuilderOperation,
  type BuilderOperationDeps,
} from "./builder-operations.js";
import { RUN_WORKFLOW_OPERATION_ACTION } from "./operation-gate.js";
import { ProviderOperationError, extractReceipt } from "./provider-request.js";

interface OperationExecutorOptions {
  /** The job owner's email: the identity every call runs as. */
  owner: string;
  orgId: string;
  factoryId: string;
  /** What `requireFactoryAutomation` reads off the call to find the saved graph. */
  automation: { triggerId: string; triggerName: string; policyId?: string };
  runId: string;
  signal: AbortSignal;
  /**
   * The workflow's own settings. Builder's project, how long a task may sit
   * idle before it reads as stuck, and the repository its pull requests belong
   * in (`extras.repository`) come from here; `deps.builder` overrides them,
   * which is for tests.
   */
  settings?: Pick<
    WorkflowSettings,
    "builderProjectId" | "builderStuckAfterMinutes" | "extras"
  >;
  /**
   * Where the run's tripwires go. The guarded calls it makes run inside it, so
   * the actions and connectors under them report to the same workflow.
   */
  observer?: RunObserver;
  deps?: OperationExecutorDeps;
}

interface OperationExecutorDeps {
  /** Factory's action registry; read from the generated registry on first use. */
  actions?: () => Promise<Record<string, ActionEntry>>;
  callTool?: typeof executeAgentToolCall;
  builder?: Partial<BuilderOperationDeps>;
}

let registryLoad: Promise<Record<string, ActionEntry>> | undefined;

function loadFactoryActions(): Promise<Record<string, ActionEntry>> {
  registryLoad ??= import("../../.generated/actions-registry.js").then(
    (module) => loadActionsFromStaticRegistry(module.default),
    (error: unknown) => {
      registryLoad = undefined;
      throw error;
    },
  );
  return registryLoad;
}

type Failure = Extract<OperationResult, { ok: false }>;

// A tool result is text, so a failure keeps only its message and error code.
// The action's own `retryable` flag travels beside it; this reads the code only
// for a failure that carried no flag, such as one core raised itself.
const RETRYABLE_ERROR_CODE =
  /(?:^|_)(?:rate_limited|timeout|unavailable|request_failed|quota_exhausted)$/;
const CREDENTIAL_ERROR_CODE =
  /(?:^|_)(?:not_connected|not_configured|credentials?_unreadable|credential_missing|connection_required|access_denied|identity_mismatch)$/;
const OUTCOME_UNKNOWN = /_outcome_unknown$/;
// What core appends when it cuts a tool result at its character limit.
const TRUNCATION_MARKER =
  /\.\.\.\[truncated — full result was [\d,]+ chars; only first [\d,]+ shown\]\s*$/;
const UNAVAILABLE_TOOL = /^Unknown or unavailable tool:/;
// A credential that was sent and refused: the run already reported its source.
const CREDENTIAL_REFUSED_CODE = /(?:^|_)(?:access_denied|identity_mismatch)$/;
/** A provider call slower than this is recorded; it is a note, not a failure. */
const SLOW_CALL_MS = 8_000;

function failure(
  def: OperationDefinition,
  reason: string,
  message: string,
  options: {
    code?: WorkflowErrorCode;
    sideEffect?: SideEffect;
    retryable?: boolean;
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

/** Core renders a thrown failure as `Error running <tool>: <message> (errorCode: <code>)`. */
function readToolError(output: string): { message: string; code?: string } {
  const code = /\(errorCode: ([A-Za-z0-9_.-]+)\)/.exec(output)?.[1];
  const message = output
    .replace(/^Error running [^:]+:\s*/, "")
    .split(/\s*\(errorCode: /)[0]
    .trim();
  return { message: message.slice(0, 500), ...(code ? { code } : {}) };
}

function workflowCodeFor(
  def: OperationDefinition,
  errorCode: string | undefined,
): WorkflowErrorCode {
  if (errorCode) {
    if ((WORKFLOW_ERROR_CODES as readonly string[]).includes(errorCode)) {
      return errorCode as WorkflowErrorCode;
    }
    if (CREDENTIAL_ERROR_CODE.test(errorCode)) return "credential_missing";
    // The gate: the saved graph did not name this, or could not be read.
    if (errorCode === "workflow_action_not_allowed") {
      return "operation_not_allowed";
    }
    if (errorCode.startsWith("workflow_")) return "engine_error";
  }
  return def.effect === "read" ? "lookup_failed" : "provider_error";
}

function mapFailedCall(
  def: OperationDefinition,
  tool: Extract<AgentToolCallExecutionResult, { status: "failed" }>,
  flags: readonly FailureFlag[],
): Failure {
  const write = def.effect === "write";
  const { message, code } = readToolError(tool.output);
  let sideEffect: SideEffect;
  if (code && OUTCOME_UNKNOWN.test(code)) sideEffect = "maybe";
  else if (tool.completedSideEffect === true) sideEffect = "done";
  else if (tool.completedSideEffect === false) sideEffect = "none";
  // Core cannot say what an untyped failure did; a typed one is the action's
  // own word that nothing happened, so only an untyped write is unknown.
  else sideEffect = write && !code ? "maybe" : "none";
  const workflowCode = workflowCodeFor(def, code);
  const described = code ? `${message} (${code})` : message;
  return {
    ok: false,
    code: workflowCode,
    message:
      workflowCode === "credential_missing"
        ? `${described} ${connectionAdvice(def.credential.provider)}`
        : described,
    retryable:
      sideEffect === "none" &&
      !!code &&
      (failureFlagFor(flags, code) ?? RETRYABLE_ERROR_CODE.test(code)),
    sideEffect,
  };
}

function unreadableResult(
  def: OperationDefinition,
  reason: "output_truncated" | "invalid_output" | "unexpected_response",
  detail: string,
): Failure {
  if (def.effect === "write") {
    return failure(
      def,
      reason,
      `${def.id} ran, but ${detail}. Check whether it happened before running it again`,
      {
        code: "effect_needs_check",
        sideEffect: reason === "unexpected_response" ? "done" : "maybe",
      },
    );
  }
  return failure(
    def,
    reason,
    `${def.id} returned a result Factory cannot use: ${detail}`,
    {
      code: reason === "output_truncated" ? "output_over_cap" : "lookup_failed",
    },
  );
}

function parseToolOutput(
  def: OperationDefinition,
  output: string,
): { ok: true; value: unknown } | { ok: false; failure: Failure } {
  if (TRUNCATION_MARKER.test(output)) {
    return {
      ok: false,
      failure: unreadableResult(
        def,
        "output_truncated",
        "its output was cut at the tool result limit",
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(output) as unknown };
  } catch {
    // coercion-ok: the unparseable result is returned as a typed failure on the next line
    return {
      ok: false,
      failure: unreadableResult(
        def,
        "invalid_output",
        "its output is not JSON",
      ),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapReceiptFailure(def: OperationDefinition, error: unknown): Failure {
  if (error instanceof ProviderOperationError) {
    return unreadableResult(def, "unexpected_response", error.message);
  }
  throw error;
}

function actionInput(
  def: OperationDefinition,
  fields: Readonly<Record<string, unknown>>,
  factoryId: string,
): Record<string, unknown> {
  const { implementation } = def;
  if (implementation.type !== "action") {
    throw new TypeError(`${def.id} is not an action operation.`);
  }
  const input: Record<string, unknown> = { factoryId };
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    input[implementation.argMap?.[name] ?? name] = value;
  }
  return input;
}

function unknownFieldFailure(
  def: OperationDefinition,
  fields: Readonly<Record<string, unknown>>,
): Failure | undefined {
  const known = new Set<string>([
    ...def.fields.map((field) => field.name),
    ...(def.cursor ? [def.cursor.param] : []),
    ...(def.window ? [def.window.fromParam, def.window.toParam] : []),
  ]);
  const unknown = Object.keys(fields).find((name) => !known.has(name));
  return unknown === undefined
    ? undefined
    : failure(def, "unknown_field", `${def.id} has no field "${unknown}"`, {
        code: "graph_invalid",
      });
}

/** Moves a source's cursor and window out of the fields: the action takes them as their own inputs. */
function providerInput(
  def: OperationDefinition,
  request: OperationRequest,
  factoryId: string,
):
  | { input: Record<string, unknown>; failure?: undefined }
  | { failure: Failure } {
  const fields = { ...request.fields };
  const take = (name: string | undefined): unknown => {
    if (name === undefined) return undefined;
    const value = fields[name];
    delete fields[name];
    return value;
  };
  const cursor = take(def.cursor?.param);
  const from = take(def.window?.fromParam);
  const to = take(def.window?.toParam);
  for (const value of [cursor, from, to]) {
    if (value !== undefined && typeof value !== "string") {
      return {
        failure: failure(
          def,
          "invalid_field",
          `${def.id} was given a cursor or window that is not text`,
          { code: "graph_invalid" },
        ),
      };
    }
  }
  return {
    input: {
      factoryId,
      operationId: def.id,
      fields,
      ...(typeof cursor === "string" ? { cursor } : {}),
      ...(typeof from === "string" && typeof to === "string"
        ? { window: { from, to } }
        : {}),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      // A cursor source's first live run takes the position and no items, so
      // enabling the workflow does not process the provider's whole backlog.
      ...(def.cursor && cursor === undefined && request.mode === "live"
        ? { prime: true }
        : {}),
    },
  };
}

function mapProviderOutput(
  def: OperationDefinition,
  value: unknown,
): OperationResult {
  if (!isRecord(value) || value.ok !== true || !("output" in value)) {
    return unreadableResult(
      def,
      "invalid_output",
      "its result is not the shape the operation action returns",
    );
  }
  if (def.itemMapping) {
    const { items } = value;
    if (!Array.isArray(items)) {
      return unreadableResult(
        def,
        "invalid_output",
        "a source returned no list of items",
      );
    }
    return {
      ok: true,
      output: value.output,
      items,
      ...(typeof value.totalAvailable === "number"
        ? { totalAvailable: value.totalAvailable }
        : {}),
      ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    };
  }
  const externalRef =
    typeof value.externalRef === "string" ? value.externalRef : undefined;
  if (def.receipt && externalRef === undefined) {
    return unreadableResult(
      def,
      "unexpected_response",
      `its result carries no "${def.receipt.externalRef}" to record`,
    );
  }
  return {
    ok: true,
    output: value.output,
    ...(externalRef === undefined ? {} : { externalRef }),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
  };
}

/**
 * Runs the operations a workflow names. An `action` operation and a
 * `provider-request` operation both go through core's guarded tool call, so
 * input validation, audit, approval and the hidden-action filter all apply;
 * a `builder` operation calls core's Builder helpers directly.
 */
export function createOperationExecutor(
  options: OperationExecutorOptions,
): OperationExecutor {
  const deps = options.deps ?? {};
  const loadActions = deps.actions ?? loadFactoryActions;
  const callTool = deps.callTool ?? executeAgentToolCall;
  const { builderProjectId, builderStuckAfterMinutes, extras } =
    options.settings ?? {};
  const repository = extras?.repository;
  const builderDeps: Partial<BuilderOperationDeps> = {
    ...(builderProjectId === undefined ? {} : { projectId: builderProjectId }),
    ...(builderStuckAfterMinutes === undefined
      ? {}
      : { stuckAfterMs: builderStuckAfterMinutes * 60_000 }),
    ...(typeof repository === "string" ? { repository } : {}),
    ...deps.builder,
  };

  async function callGuarded(
    def: OperationDefinition,
    name: string,
    input: Record<string, unknown>,
    request: OperationRequest,
    flags: FailureFlag[],
  ): Promise<AgentToolCallExecutionResult | Failure> {
    const actions = await loadActions();
    if (!actions[name]) {
      return failure(
        def,
        "operation_unavailable",
        `Factory has no action named ${name} to run ${def.id}`,
        { code: "operation_not_allowed" },
      );
    }
    return withRunObserver(options.observer, () =>
      collectFailureFlags(flags, () =>
        callTool({
          actions,
          name,
          input,
          callId: request.receiptKey ?? `${def.id}:${randomUUID()}`,
          signal: AbortSignal.any([options.signal, request.signal]),
          ownerEmail: options.owner,
          orgId: options.orgId,
          appId: FACTORY_APP_ID,
          caller: "automation",
          automation: options.automation,
          runId: options.runId,
          // The audit row of a write is read back by its receipt key.
          ...(request.receiptKey ? { turnId: request.receiptKey } : {}),
        }),
      ),
    );
  }

  function mapCompleted(
    def: OperationDefinition,
    tool: AgentToolCallExecutionResult,
    shape: (value: unknown) => OperationResult,
    flags: readonly FailureFlag[],
  ): OperationResult {
    if (tool.status === "approval_required") {
      return failure(
        def,
        "approval_required",
        `${def.id} needs a person's approval, and a workflow cannot wait for one`,
        { code: "operation_not_allowed" },
      );
    }
    if (tool.status === "failed") {
      if (UNAVAILABLE_TOOL.test(tool.output)) {
        return failure(
          def,
          "operation_unavailable",
          `The action that runs ${def.id} is not available to workflows`,
          { code: "operation_not_allowed" },
        );
      }
      const failed = mapFailedCall(def, tool, flags);
      if (failed.code === "credential_missing") {
        const code = readToolError(tool.output).code;
        if (!code || !CREDENTIAL_REFUSED_CODE.test(code)) {
          noteCredentialSource({
            provider: def.credential.provider,
            source: "none",
            operationId: def.id,
            observer: options.observer,
            details: code ? { errorCode: code } : {},
          });
        }
      }
      return failed;
    }
    const parsed = parseToolOutput(def, tool.output);
    return parsed.ok ? shape(parsed.value) : parsed.failure;
  }

  async function runAction(
    def: OperationDefinition,
    request: OperationRequest,
  ): Promise<OperationResult> {
    if (def.implementation.type !== "action") {
      throw new TypeError(`${def.id} is not an action operation.`);
    }
    const flags: FailureFlag[] = [];
    const tool = await callGuarded(
      def,
      def.implementation.action,
      actionInput(def, request.fields, options.factoryId),
      request,
      flags,
    );
    if ("ok" in tool) return tool;
    return mapCompleted(
      def,
      tool,
      (value) => {
        try {
          const receipt = extractReceipt(def, value, {
            tripwire: options.observer?.tripwire,
          });
          return { ok: true, output: value, ...receipt };
        } catch (error) {
          return mapReceiptFailure(def, error);
        }
      },
      flags,
    );
  }

  async function runProviderRequest(
    def: OperationDefinition,
    request: OperationRequest,
  ): Promise<OperationResult> {
    const prepared = providerInput(def, request, options.factoryId);
    if (prepared.failure) return prepared.failure;
    const flags: FailureFlag[] = [];
    const tool = await callGuarded(
      def,
      RUN_WORKFLOW_OPERATION_ACTION,
      prepared.input,
      request,
      flags,
    );
    if ("ok" in tool) return tool;
    return mapCompleted(
      def,
      tool,
      (value) => mapProviderOutput(def, value),
      flags,
    );
  }

  function dispatch(
    def: OperationDefinition,
    request: OperationRequest,
  ): Promise<OperationResult> {
    switch (def.implementation.type) {
      case "action":
        return runAction(def, request);
      case "provider-request":
        return runProviderRequest(def, request);
      case "builder":
        return executeBuilderOperation({
          operation: def,
          fields: request.fields,
          owner: options.owner,
          signal: AbortSignal.any([options.signal, request.signal]),
          tripwire: options.observer?.tripwire,
          deps: builderDeps,
        });
    }
  }

  /** What only the executor sees of a call: how long it took, and a write it cannot vouch for. */
  function observe(
    def: OperationDefinition,
    result: OperationResult,
    durationMs: number,
  ): void {
    const tripwire = options.observer?.tripwire;
    if (!tripwire) return;
    const provider = def.credential.provider;
    const kind = def.implementation.type;
    if (durationMs > SLOW_CALL_MS) {
      tripwire({
        area: "provider",
        code: "provider_slow",
        severity: "info",
        runId: options.runId,
        operationId: def.id,
        details: { provider, kind, durationMs, ok: result.ok },
      });
    }
    if (result.ok) return;
    // A provider request reports its own ambiguous write, with the status it saw.
    if (result.sideEffect === "maybe" && kind !== "provider-request") {
      tripwire({
        area: "provider",
        code: "provider_write_ambiguous",
        severity: "error",
        runId: options.runId,
        operationId: def.id,
        details: { provider, kind, code: result.code, durationMs },
      });
    }
    if (kind === "builder" && result.code === "credential_missing") {
      noteCredentialSource({
        provider,
        source: "none",
        operationId: def.id,
        observer: options.observer,
      });
    }
  }

  return {
    async execute(request) {
      const def = request.operation;
      if (request.signal.aborted || options.signal.aborted) {
        return failure(
          def,
          "run_stopped",
          `The run stopped before ${def.id} started`,
          {
            code: "budget_paused",
          },
        );
      }
      const unknown = unknownFieldFailure(def, request.fields);
      if (unknown) return unknown;
      const startedAt = Date.now();
      const result = await dispatch(def, request);
      observe(def, result, Date.now() - startedAt);
      return result;
    },
  };
}
