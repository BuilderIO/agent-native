import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  copyActionArguments,
  snapshotActionArguments,
} from "./action-arguments-identity.js";
import {
  actionCallIsRetrySafe,
  actionCallReadOnly,
  actionOutputEffect,
  classifyActionCall,
  type ActionCallClassification,
} from "./action-call-classification.js";
import { coerceGatewayStringifiedArgs } from "./action-input-coercion.js";
import {
  buildActionMcpOutputContract,
  describeOutputContractIssue,
  outputSchemaToJsonSchema,
  type JsonSchemaObject,
  type ActionMcpOutputContract,
} from "./action-output-contract.js";
import {
  normalizeActionChatUIConfig,
  type ActionChatUIConfig,
} from "./action-ui.js";
import type {
  ActionTool,
  AgentChatAttachment,
  AgentChatEvent,
  AgentNativeJsonSchema,
} from "./agent/types.js";
import { normalizeAuditConfig, resolveAuditAttach } from "./audit/config.js";
import type { ActionAuditConfig } from "./audit/types.js";
import {
  assertRegisteredActionAccess,
  type ActionAccessConfig,
} from "./authorization/action-access-runtime.js";
import {
  writeBoundedJsonValue,
  type JsonValueWriter,
} from "./json-schema/json-value.js";
import { subschemasOf } from "./json-schema/subschemas.js";
import {
  jsonTypeOf,
  plainJsonSnapshot,
  recordInputSchemaVerdict,
  UninterpretedSchema,
  UnusableSchemaError,
} from "./json-schema/unusable-schema.js";
import { assertUsableSchema } from "./json-schema/usable-schema.js";
import { parseServiceIdentityEmail } from "./org/service-identity.js";
import { getAsyncLocalStorageCtor } from "./shared/optional-node-builtins.js";
import { wrapRunWithActionTracking } from "./tracking/action-lifecycle.js";

/**
 * Carries an action's execution-frame key across `{ ...entry, run }` wrappers
 * and the registry rebuilds that copy named fields (`preserveActionFlags`).
 */
export const ACTION_EXECUTION_KEY = Symbol.for(
  "agent-native.action.executionKey",
);

/**
 * An action's recorder for a call refused before its run, kept on its
 * execution key so every copy of the entry that carries the key keeps it, even
 * one built by another copy of this module.
 */
const ACTION_INVALID_CALL_RECORDER = Symbol.for(
  "agent-native.action.invalidCallRecorder",
);
const invalidCallErrors = new WeakMap<object, unknown>();

async function throwInvalidCallError(
  _args: unknown,
  ctx?: ActionRunContext,
): Promise<never> {
  throw ctx ? invalidCallErrors.get(ctx) : undefined;
}

/**
 * Records a call refused before its run, for arguments its caller found
 * invalid, as the action's own validation failure would be recorded: through
 * its tracking and audit, with no path to its handler. Returns false, and
 * logs, when the entry carries no action identity to record it through.
 */
export async function recordInvalidActionCall(
  entry: object,
  args: unknown,
  ctx: ActionRunContext,
  error: unknown,
): Promise<boolean> {
  const key = (entry as Record<symbol, unknown>)[ACTION_EXECUTION_KEY];
  const record =
    key !== null && typeof key === "object"
      ? (key as Record<symbol, unknown>)[ACTION_INVALID_CALL_RECORDER]
      : undefined;
  if (typeof record !== "function") {
    console.error(
      `[action] ${ctx.actionName ?? "An action"} refused invalid arguments before its run, but its entry carries no action identity: its audit and tracking have no record of the call.`,
    );
    return false;
  }
  try {
    await record(args, ctx, error);
  } catch {
    // coercion-ok: the caller reports the validation error it already has.
  }
  return true;
}

export type ActionCaller =
  | "tool"
  | "http"
  | "frontend"
  | "mcp-widget"
  | "mcp-widget-write"
  | "cli"
  | "mcp"
  | "webmcp"
  | "a2a"
  | "automation";

export interface ActionAutomationContext {
  triggerId: string;
  triggerName: string;
  policyId?: string;
}

export interface ActionRunContext {
  send?: (event: AgentChatEvent) => void;
  userEmail?: string;
  /**
   * Request headers for server-only actions that must delegate to an
   * authenticated framework protocol, such as Better Auth password setup.
   * Never expose this context to agent tools or return it from an action.
   */
  requestHeaders?: Headers;
  orgId?: string | null;
  /** Restrict nested action credential reads to the explicit organization. */
  credentialScope?: "org";
  appId?: string;
  appRoles?: string[];
  appPermissions?: string[];
  caller: ActionCaller;
  automation?: ActionAutomationContext;
  networkProtocol?: "a2a" | "mcp" | "provider-api";
  networkId?: string;
  networkPeer?: string;
  delegationDepth?: number;
  visitedApps?: string[];
  /** Remote targets that returned a terminal precondition in this turn. */
  blockedA2ATargets?: Map<string, string>;
  attachments?: AgentChatAttachment[];
  signal?: AbortSignal;
  actionName?: string;
  /** Present only on frontend GETs authorized by a scoped directory-widget read capability. */
  mcpDirectoryWidgetReadOnly?: true;
  /** Present only on frontend calls authorized by a scoped directory-widget capability: the resource IDs it is bound to. */
  mcpDirectoryWidgetResourceIds?: Record<string, string>;
  /** Present only on frontend mutations authorized by a scoped directory-widget write capability. */
  mcpDirectoryWidgetWrite?: {
    appId: string;
    resourceIds: Record<string, string>;
    actionNames: readonly string[];
  };
  threadId?: string;
  runId?: string;
  turnId?: string;
  toolCallId?: string;
  approvedToolCallKey?: string;
  /**
   * The client behind a `caller: "mcp"` call. `name` and `version` are its
   * self-reported `clientInfo`. `oauthClientId` is the OAuth client its
   * credential was issued to.
   */
  mcpClient?: { name?: string; version?: string; oauthClientId?: string };
  /** The MCP client accepted this exact call's approval elicitation. */
  mcpClientAccepted?: true;
}

export type ActionAuthorize<TArgs> = (
  args: TArgs,
  ctx?: ActionRunContext,
) => void | boolean | Promise<void | boolean>;

export interface AgentActionStopOptions {
  errorCode?: string;
  details?: Record<string, unknown>;
  toolResult?: string;
}

export interface ActionContractErrorOptions {
  errorCode: string;
  details?: Record<string, unknown>;
  statusCode?: number;
  /**
   * The handler threw before any side effect could run, so the runner can
   * treat the rejection as definitive: it does not stamp `outcomeUnknown`
   * and the model may revise its arguments and retry the same tool in the
   * same turn. Defaults to `true` for a 4xx `statusCode` whose `errorCode`
   * is not `permanent_precondition` (that code keeps the historical "stop,
   * outcome unknown" behavior), and to `false` otherwise. Set it
   * explicitly only to override the default — `true` for a 5xx that is
   * known to reject before any write, or `false` for a 4xx thrown after a
   * side effect may have committed.
   */
  definitiveRejection?: boolean;
}

export class ActionContractError extends Error {
  readonly actionContractError = true;
  readonly errorCode: string;
  readonly details?: Record<string, unknown>;
  readonly statusCode: number;
  readonly definitiveRejection: boolean;

  constructor(message: string, options: ActionContractErrorOptions) {
    super(message);
    this.name = "ActionContractError";
    this.errorCode = options.errorCode;
    this.details = options.details;
    this.statusCode = options.statusCode ?? 409;
    this.definitiveRejection =
      options.definitiveRejection ??
      (this.statusCode >= 400 &&
        this.statusCode < 500 &&
        options.errorCode !== "permanent_precondition");
  }
}

export function isActionContractError(
  error: unknown,
): error is ActionContractError {
  return (
    error instanceof ActionContractError ||
    (!!error &&
      typeof error === "object" &&
      (error as { actionContractError?: unknown }).actionContractError ===
        true &&
      typeof (error as { errorCode?: unknown }).errorCode === "string")
  );
}

/**
 * True when a thrown contract error proves the write never started. The
 * runner then delivers the error to the model without stamping
 * `outcomeUnknown`, so a later same-thread call is a retry rather than a
 * dead-end. Duck-typed contract errors without the new field still follow
 * the 4xx default.
 */
export function isDefinitiveActionRejection(error: unknown): boolean {
  if (!isActionContractError(error)) return false;
  const marked = (error as { definitiveRejection?: unknown })
    .definitiveRejection;
  if (typeof marked === "boolean") return marked;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return (
    typeof statusCode === "number" &&
    statusCode >= 400 &&
    statusCode < 500 &&
    error.errorCode !== "permanent_precondition"
  );
}

export interface FailOptions {
  errorCode?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  /** See {@link ActionContractErrorOptions.definitiveRejection}. */
  definitiveRejection?: boolean;
}

export function fail(message: string, options: FailOptions = {}): never {
  throw new ActionContractError(message, {
    errorCode: options.errorCode ?? "action_failed",
    statusCode: options.statusCode ?? 400,
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.definitiveRejection === undefined
      ? {}
      : { definitiveRejection: options.definitiveRejection }),
  });
}

export type { ActionMcpOutputContract } from "./action-output-contract.js";

/** What a call that broke its output contract already did. `run` returned
 *  before the check, so a non-read-only call's changes are applied. */
export type ActionOutputEffect = "none" | "committed";

export interface ActionOutputContractErrorOptions {
  actionName?: string;
  effect: ActionOutputEffect;
  /** `semantic` is the action's `outputSchema`; `mcp` is the MCP response
   *  contract derived from it. */
  contract: "semantic" | "mcp";
  /** Sanitized `path: code` lines; never values from the output. */
  issues: readonly string[];
}

const MAX_REPORTED_OUTPUT_ISSUES = 5;
const MAX_DETAILED_OUTPUT_ISSUES = 50;

function actionSubject(actionName: string | undefined): string {
  return actionName ? `"${actionName}"` : "The action";
}

function effectOutcome(effect: ActionOutputEffect): string {
  return effect === "committed"
    ? "Its changes are already applied: do not retry it. Read the current state instead."
    : "It is read-only and changed nothing.";
}

/**
 * A result that broke its declared output contract after `run` returned. It is
 * typed so no caller mistakes it for a failed call: a write reports `committed`
 * and tells the caller not to retry.
 */
export class ActionOutputContractError extends ActionContractError {
  readonly outputContractError = true;
  readonly actionName?: string;
  readonly effect: ActionOutputEffect;
  readonly contract: "semantic" | "mcp";
  readonly issues: readonly string[];

  constructor(options: ActionOutputContractErrorOptions) {
    const shown = options.issues.slice(0, MAX_REPORTED_OUTPUT_ISSUES);
    const more = options.issues.length - shown.length;
    const issueText = `${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`;
    super(
      `${actionSubject(options.actionName)} returned a result that does not match its declared output contract (${issueText}). ${effectOutcome(options.effect)}`,
      {
        errorCode: "output_contract_violation",
        statusCode: 500,
        details: {
          effect: options.effect,
          contract: options.contract,
          issues: options.issues.slice(0, MAX_DETAILED_OUTPUT_ISSUES),
        },
      },
    );
    this.name = "ActionOutputContractError";
    this.actionName = options.actionName;
    this.effect = options.effect;
    this.contract = options.contract;
    this.issues = options.issues.slice(0, MAX_DETAILED_OUTPUT_ISSUES);
  }
}

export function isActionOutputContractError(
  error: unknown,
): error is ActionOutputContractError {
  return (
    isActionContractError(error) &&
    (error as { outputContractError?: unknown }).outputContractError === true &&
    ((error as { effect?: unknown }).effect === "none" ||
      (error as { effect?: unknown }).effect === "committed")
  );
}

/**
 * What a failed call had already done. An output-contract error or a
 * post-run stop/connection signal carries its own `effect`. A definitive
 * 4xx / `fail()` rejection means the write never started (`none`).
 * `undefined` when the failure carries no such evidence, so the caller
 * must not assume the call changed nothing.
 */
export function actionFailureEffect(
  error: unknown,
): ActionOutputEffect | undefined {
  if (isActionOutputContractError(error)) return error.effect;
  if (isDefinitiveActionRejection(error)) return "none";
  if (!isAgentActionStopError(error)) return undefined;
  const effect = (error as { effect?: unknown }).effect;
  return effect === "none" || effect === "committed" ? effect : undefined;
}

/** What a dispatched call did, and whether other sessions must refresh. */
export interface InvocationEffect {
  /** `unknown`: a write may have run that nothing confirms or rules out. */
  readonly effect: ActionOutputEffect | "unknown";
  /** A write that publishes changes entered its handler, or may have. */
  readonly changed: boolean;
}

/**
 * What a dispatched call did, for every transport, from what ran in it by the
 * time it settled or was abandoned. In order: an action's entry that recorded
 * no call of the action ran something else, so what it did is unknown; a
 * write its own declarations cannot speak for (nested in it, or under an
 * entry that recorded no call) entered its handler, so it may have written;
 * otherwise the call's own write, from its record or, untracked, its
 * declaration, which only then a receipt, `retrySafe` or a typed failure the
 * call raised itself may narrow.
 */
export function invocationEffect(
  entry: { changeEvents?: boolean },
  outcome: ActionExecutionOutcome,
  settled: {
    /** The call's classification; `undefined` is a write. */
    readOnly?: boolean;
    retrySafe?: boolean;
    receipt?: { changed: boolean };
    /** It failed, with what it threw; `lost` when its result never came. */
    failed?: { error?: unknown; lost?: boolean };
  },
): InvocationEffect {
  const { evidence, record } = outcome;
  const { failed, readOnly } = settled;
  // A typed effect speaks for the call that raised it, not for one it passed
  // through. Untracked, nothing names that call, so it stands.
  const typed =
    failed && !failed.lost && (!evidence || evidence.raised === failed.error)
      ? actionFailureEffect(failed.error)
      : undefined;
  if (outcome.refused) return { effect: "none", changed: false };
  if (outcome.keyed && !record) return { effect: "unknown", changed: true };
  if (evidence?.writeEntered && (evidence.nestedWriteEntered || !record)) {
    return {
      effect: !failed || typed === "committed" ? "committed" : "unknown",
      changed: evidence.changeEntered,
    };
  }
  const wrote = record ? record.evidence.writeEntered : readOnly !== true;
  const changed = record
    ? record.evidence.changeEntered
    : entry.changeEvents !== false && (failed ? typed === "committed" : wrote);
  const effect = !failed
    ? (settled.receipt?.changed ?? wrote)
      ? "committed"
      : "none"
    : failed.lost
      ? wrote || readOnly !== true
        ? "unknown"
        : "none"
      : (typed ?? (wrote && !settled.retrySafe ? "unknown" : "none"));
  return { effect, changed };
}

/** Whether a failed call must publish an action change. */
export function failedCallEmitsChange(
  entry: { changeEvents?: boolean },
  error: unknown,
  outcome: ActionExecutionOutcome,
): boolean {
  return invocationEffect(entry, outcome, { failed: { error } }).changed;
}

/** Whether a call that returned must publish an action change; untracked, by its classification of `args`. */
export function ranCallEmitsChange(
  entry: Parameters<typeof actionCallReadOnly>[0] & { changeEvents?: boolean },
  outcome: ActionExecutionOutcome,
  args: unknown,
  fallbackReadOnly: boolean,
): boolean {
  const readOnly = actionCallReadOnly(entry, args) ?? fallbackReadOnly;
  return invocationEffect(entry, outcome, { readOnly }).changed;
}

/**
 * What a write action verified about its own effect. An action opts in by
 * returning a plain-object result with a reserved `_receipt: WriteReceipt`.
 * The agent loop reads it before the result is stringified and truncated, so
 * the final answer is reconciled with what the write did instead of with the
 * model's reading of a JSON string.
 *
 * - `changed: false`: nothing was written (a no-op); not a completed side effect.
 * - `verified: true`: the effect was observed. `false`: it was checked and did
 *   not hold. `"unverified"`: it could not be checked.
 * - `subject`: the stable target of the write, such as a dashboard id. Later
 *   receipts from the same action with the same subject that are `changed` and
 *   `verified: true` supersede this one, so a no-op that was then fixed does
 *   not flag the answer. A receipt with failing checks is superseded only when
 *   those later receipts carry an `ok` check with the same `id` for every
 *   check that failed here, because a verified write speaks only for what it
 *   checked. Without a subject a receipt is never superseded.
 * - Bounds, enforced by the loop: summary and subject 200 chars, 8 checks, 5
 *   warnings.
 */
export interface WriteReceipt {
  changed: boolean;
  verified: true | false | "unverified";
  summary: string;
  subject?: string;
  checks?: Array<{ id: string; ok: boolean; detail?: string }>;
  warnings?: string[];
}

export class AgentActionStopError extends Error {
  readonly agentNativeStop = true;
  readonly errorCode?: string;
  readonly details?: Record<string, unknown>;
  readonly toolResult?: string;
  /** Set by the framework only on a signal raised while the result of a call
   *  that already ran was checked: what that call had done. */
  readonly effect?: ActionOutputEffect;

  constructor(message: string, options: AgentActionStopOptions = {}) {
    super(message);
    this.name = "AgentActionStopError";
    this.errorCode = options.errorCode;
    this.details = options.details;
    this.toolResult = options.toolResult;
  }
}

export function isAgentActionStopError(
  err: unknown,
): err is AgentActionStopError {
  return (
    err instanceof AgentActionStopError ||
    Boolean(
      err &&
      typeof err === "object" &&
      "agentNativeStop" in err &&
      (err as { agentNativeStop?: unknown }).agentNativeStop === true,
    )
  );
}

export interface AgentConnectionRequiredOptions {
  provider: string;
  reason?: "connect" | "grant" | "reauthorize" | "admin_required";
  appId?: string;
  source?: { id: string; kind?: string; label?: string };
  toolResult?: string;
}

export class AgentConnectionRequiredError extends AgentActionStopError {
  readonly agentConnectionRequired = true;
  readonly provider: string;
  readonly reason: NonNullable<AgentConnectionRequiredOptions["reason"]>;
  readonly appId?: string;
  readonly source?: AgentConnectionRequiredOptions["source"];

  constructor(message: string, options: AgentConnectionRequiredOptions) {
    super(message, {
      errorCode: "connection_required",
      toolResult: options.toolResult,
    });
    this.name = "AgentConnectionRequiredError";
    this.provider = options.provider;
    this.reason = options.reason ?? "connect";
    this.appId = options.appId;
    this.source = options.source;
  }
}

export function isAgentConnectionRequiredError(
  error: unknown,
): error is AgentConnectionRequiredError {
  return (
    error instanceof AgentConnectionRequiredError ||
    Boolean(
      error &&
      typeof error === "object" &&
      "agentConnectionRequired" in error &&
      (error as { agentConnectionRequired?: unknown })
        .agentConnectionRequired === true,
    )
  );
}

const postRunSignalOrigins = new WeakMap<
  AgentActionStopError,
  { signal: AgentActionStopError; actionName?: string }
>();

/**
 * A stop or connection signal raised while the result of a call that already
 * ran was checked, as the call reports it. It stays a signal of the same kind,
 * so callers still stop or ask for the connection, but its message, tool
 * result and details are replaced: they may repeat the result. A connection
 * keeps its routing (provider, reason, app, source) in its fields, details and
 * message, since MCP and HTTP callers see only those. It carries the call's
 * effect, so a write still refreshes other sessions and is not retried.
 */
function postRunSignal(
  signal: AgentActionStopError,
  failure: { actionName?: string; effect: ActionOutputEffect },
): AgentActionStopError {
  const subject = actionSubject(failure.actionName);
  const outcome = effectOutcome(failure.effect);
  let copy: AgentActionStopError;
  let details: Record<string, unknown> = { effect: failure.effect };
  if (isAgentConnectionRequiredError(signal)) {
    const routing = {
      provider: signal.provider,
      reason: signal.reason,
      ...(signal.appId ? { appId: signal.appId } : {}),
      ...(signal.source ? { source: signal.source } : {}),
    };
    const target = [
      `provider ${JSON.stringify(routing.provider)}`,
      `reason ${JSON.stringify(routing.reason)}`,
      ...(routing.appId ? [`app ${JSON.stringify(routing.appId)}`] : []),
      ...(routing.source
        ? [`source ${JSON.stringify(routing.source.id)}`]
        : []),
    ].join(", ");
    copy = new AgentConnectionRequiredError(
      `${subject} needs a connection to finish checking its result (${target}). ${outcome}`,
      routing,
    );
    details = { ...details, ...routing };
  } else {
    copy = new AgentActionStopError(
      `${subject} stopped while its result was checked. ${outcome}`,
      signal.errorCode ? { errorCode: signal.errorCode } : {},
    );
  }
  Object.assign(copy, { effect: failure.effect, details });
  postRunSignalOrigins.set(copy, { signal, actionName: failure.actionName });
  return copy;
}

/**
 * A failure that left a call nested in this one, as this call reports it once
 * a write entered its handler somewhere in this call: a nested call that
 * changed nothing does not undo what ran beside or around it.
 */
function withCommittedEffect(error: unknown): unknown {
  if (actionFailureEffect(error) !== "none") return error;
  // A definitive rejection still speaks for its own write, not a nested
  // one; keep the same object so invocationEffect can see raised === error
  // and the nested-write branch can still report unknown.
  if (isDefinitiveActionRejection(error)) return error;
  if (isActionOutputContractError(error)) {
    return new ActionOutputContractError({
      actionName: error.actionName,
      effect: "committed",
      contract: error.contract,
      issues: error.issues,
    });
  }
  const origin = postRunSignalOrigins.get(error as AgentActionStopError);
  return postRunSignal(origin?.signal ?? (error as AgentActionStopError), {
    actionName: origin?.actionName,
    effect: "committed",
  });
}

export interface ActionHttpConfig {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path?: string;
}

export interface PublicAgentActionConfig {
  expose: boolean;
  readOnly: boolean;
  requiresAuth?: boolean;
  isConsequential?: boolean;
  title?: string;
  description?: string;
  allowRawQueryInput?: boolean;
}

export type ActionPlanModeEffect = "read" | "write" | "unknown";

export interface ActionChangeResource {
  resourceType: string;
  resourceId: string;
}

export interface ActionPlanModeConfig<TInput = unknown> {
  effect: ActionPlanModeEffect | ((args: TInput) => ActionPlanModeEffect);
  allowedValues?: Record<string, readonly string[]>;
  allowedProperties?: readonly string[];
  requiredProperties?: readonly string[];
  omittedProperties?: readonly string[];
  description?: string;
}

export interface ActionDeepLink {
  url: string;
  label: string;
  view?: string;
}

export type ActionLinkBuilder = (ctx: {
  args: Record<string, any>;
  result: any;
}) => ActionDeepLink | null | undefined;

export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app" as const;
export const MCP_APP_RESOURCE_URI_META_KEY = "ui/resourceUri" as const;

export interface ActionMcpAppCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export type ActionMcpAppCspBuilder = (ctx: {
  actionName: string;
  appId?: string;
  requestOrigin?: string;
  catalogMode?: "app" | "directory";
}) => ActionMcpAppCsp | Promise<ActionMcpAppCsp>;

export interface ActionMcpAppPermissions {
  camera?: Record<string, never>;
  microphone?: Record<string, never>;
  geolocation?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
}

export interface ActionMcpAppResourceMeta {
  csp?: ActionMcpAppCsp | ActionMcpAppCspBuilder;
  permissions?: ActionMcpAppPermissions;
  domain?: string;
  prefersBorder?: boolean;
}

export type ActionMcpAppHtmlBuilder = (ctx: {
  actionName: string;
  appId?: string;
  requestOrigin?: string;
  catalogMode?: "app" | "directory";
  startToolName?: string;
}) => string;

export interface ActionMcpAppResourceConfig {
  uri?: string;
  name?: string;
  title?: string;
  description?: string;
  html: string | ActionMcpAppHtmlBuilder;
  mimeType?: typeof MCP_APP_MIME_TYPE;
  _meta?: Record<string, unknown>;
  csp?: ActionMcpAppCsp | ActionMcpAppCspBuilder;
  permissions?: ActionMcpAppPermissions;
  domain?: string;
  prefersBorder?: boolean;
}

export interface ActionMcpAppConfig {
  structuredContent?: boolean;
  resource?: ActionMcpAppResourceConfig;
  visibility?: Array<"model" | "app">;
  compactCatalog?: boolean;
}

export interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
}

type InferParams<T extends Record<string, ParameterSchema> | undefined> =
  T extends Record<string, ParameterSchema>
    ? { [K in keyof T]?: string }
    : Record<string, string>;

export type ActionOutputErrorStrategy = "strict" | "warn" | "fallback";

export interface ActionMcpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint?: boolean;
}

interface DefineActionWithSchema<
  TSchema extends StandardSchemaV1,
  TReturn = any,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  title?: string;
  description: string;
  schema: TSchema;
  parameters?: never;
  agentInputSchema?: StandardSchemaV1;
  outputSchema?: TOutputSchema;
  outputErrorStrategy?: ActionOutputErrorStrategy;
  outputFallback?: TReturn;
  /** Advertise `outputSchema` to MCP clients as the tool's `outputSchema`
   *  and validate every `structuredContent` against it. Set it only after
   *  auditing that every value `run` can return meets the schema; it requires
   *  `outputErrorStrategy: "strict"`, because a `"warn"` or `"fallback"`
   *  action would otherwise advertise a contract it does not enforce.
   *  `defineAction` throws when the schema has no Standard JSON Schema output
   *  converter or its root cannot become `structuredContent`. */
  mcpOutputSchema?: boolean;
  run: (
    args: StandardSchemaV1.InferOutput<TSchema>,
    ctx?: ActionRunContext,
  ) => Promise<TReturn> | TReturn;
  http?: ActionHttpConfig | false;
  requiresAuth?: boolean;
  maxBodyBytes?: number;
  uiOnly?: boolean;
  agentTool?: boolean;
  /** Whether this action is exposed to EXTERNAL agents over MCP (and the direct
   *  A2A action surface, which shares the same policy).
   *
   *  **Defaults to `agentTool`, not to `true`**: an action hidden from the
   *  agent is hidden from outside agents too, so one flag stays one decision.
   *  Declaring `mcpTool` overrides that inheritance in both directions.
   *
   *  - `false` — hard veto. The action is absent from `tools/list` AND from
   *    `tools/call` on every MCP tier, including the rare `--full-catalog`
   *    opt-in, while the in-app agent still calls it normally. Use it for
   *    actions that only make sense with an in-app screen, a live session, or
   *    the framework's own UI on the other end.
   *  - `true` — the action-owned form of `mcp.connectorCatalog` membership:
   *    this action is served on the curated external catalog. Declaring it on
   *    any action activates the connector tier for the app, which is what lets
   *    a template delete its hand-maintained `connectorCatalog` name list.
   *    Paired with `agentTool: false` it makes the action MCP-only — external
   *    agents get it, the app's own agent does not.
   *  - `undefined` (default) — follows `agentTool`; the tier rules then decide
   *    whether it is advertised up front or found through `tool-search`.
   *
   *  Membership is not permission: an external caller still passes the OAuth
   *  scope, `externalAgents` policy, and `publicAgent` checks. Resolved by
   *  `isActionExposedToExternalAgents` below, which every external surface
   *  reads instead of testing these two fields itself — including the rule
   *  that an action ending the in-app agent's turn is in-app only by default,
   *  because the user's answer flows back through the in-app chat that an
   *  external caller is not on. */
  mcpTool?: boolean;
  mcpAnnotations?: ActionMcpToolAnnotations;
  deferLoading?: boolean;
  readOnly?: boolean;
  grounding?: boolean;
  allowInPlanMode?: boolean;
  planMode?: ActionPlanModeConfig<StandardSchemaV1.InferInput<TSchema>>;
  /** `false` keeps a mutating action from publishing an `action` change event
   *  (and its sync_events row) after each call. For writes no other session
   *  needs to see, such as telemetry. Defaults to publishing; read-only
   *  actions never publish. */
  changeEvents?: boolean;
  /** `false` keeps this action's query results out of the browser's persisted
   *  query cache, so a read that must not outlive the page (secrets, one-time
   *  codes, private data) is never painted from disk on a revisit. Defaults to
   *  persisting. */
  persistInBrowser?: boolean;
  /** Names the shareable resource a mutating call changes so the `action`
   *  change event also reaches every collaborator who can read it, not only the
   *  actor. Without it other open sessions are never told and show stale data
   *  until they reload. Receives the call's raw input and what the action
   *  returned (for a call keyed by a child id whose resource only the result
   *  names); return `null` when the call touches no resource or changed nothing. */
  changeResource?: (
    input: StandardSchemaV1.InferInput<TSchema>,
    result: TReturn,
  ) => ActionChangeResource | null | undefined;
  parallelSafe?: boolean;
  /**
   * Re-running this write after an error or a lost result cannot duplicate or
   * corrupt data: it validates before it writes, or it sets an end state
   * (replace-by-id, search-and-replace that fails loudly on a second run). The
   * agent loop then lets the model correct its arguments and retry instead of
   * ending the run as `write_tool_outcome_unknown`. Pass a predicate when only
   * some inputs qualify. Do not set it on an action that appends, sends, or
   * charges. It covers this action's own write: once a write nested in it
   * entered its handler, a failure stays an unknown outcome.
   */
  retrySafe?:
    | boolean
    | ((input: StandardSchemaV1.InferInput<TSchema>) => boolean);
  endsTurn?: boolean;
  dedupe?: boolean;
  toolCallable?: boolean;
  capabilityScopes?: readonly string[];
  publicAgent?: PublicAgentActionConfig;
  link?: ActionLinkBuilder;
  mcpApp?: ActionMcpAppConfig;
  chatUI?: ActionChatUIConfig;
  timeoutMs?: number;
  maxResultChars?: number;
  needsApproval?:
    | boolean
    | ((
        args: StandardSchemaV1.InferOutput<TSchema>,
        ctx?: ActionRunContext,
      ) => boolean | Promise<boolean>);
  allowPersistentApproval?: boolean;
  /**
   * Authorization gate that runs before `run()` on **every** caller — agent
   * tool, HTTP, frontend, MCP, A2A, and CLI. It wraps `run` itself rather than
   * hanging off the action entry, because a flag consulted by the dispatcher
   * only guards the dispatchers that remember to consult it.
   *
   * This is *authorization*, not approval: `needsApproval` asks a human to
   * bless one call the caller is already allowed to make, while `authorize`
   * decides whether they are allowed at all. It also does not replace
   * `accessFilter` / `assertAccess` — those scope which rows a permitted caller
   * may see; this decides whether the operation is open to them.
   *
   * ```ts
   * import { coachAccess } from "../lib/access.js";
   *
   * export default defineAction({
   *   description: "Archive a training plan.",
   *   schema,
   *   authorize: coachAccess.requireAny("coach-admin"),
   *   run: async (args) => { ... },
   * });
   * ```
   */
  authorize?: ActionAuthorize<StandardSchemaV1.InferOutput<TSchema>>;
  access?: ActionAccessConfig;
  audit?: ActionAuditConfig;
}

interface DefineActionWithParams<
  TParams extends Record<string, ParameterSchema> | undefined =
    | Record<string, ParameterSchema>
    | undefined,
  TReturn = any,
> {
  title?: string;
  description: string;
  parameters?: TParams;
  schema?: never;
  agentInputSchema?: never;
  outputSchema?: StandardSchemaV1;
  outputErrorStrategy?: ActionOutputErrorStrategy;
  outputFallback?: TReturn;
  mcpOutputSchema?: boolean;
  run: (
    args: InferParams<TParams>,
    ctx?: ActionRunContext,
  ) => Promise<TReturn> | TReturn;
  http?: ActionHttpConfig | false;
  requiresAuth?: boolean;
  maxBodyBytes?: number;
  uiOnly?: boolean;
  agentTool?: boolean;
  mcpTool?: boolean;
  mcpAnnotations?: ActionMcpToolAnnotations;
  deferLoading?: boolean;
  readOnly?: boolean;
  grounding?: boolean;
  allowInPlanMode?: boolean;
  planMode?: ActionPlanModeConfig<InferParams<TParams>>;
  changeEvents?: boolean;
  persistInBrowser?: boolean;
  changeResource?: (
    input: InferParams<TParams>,
    result: TReturn,
  ) => ActionChangeResource | null | undefined;
  parallelSafe?: boolean;
  /** See `ActionDefinition.retrySafe`. */
  retrySafe?: boolean | ((input: InferParams<TParams>) => boolean);
  endsTurn?: boolean;
  dedupe?: boolean;
  toolCallable?: boolean;
  capabilityScopes?: readonly string[];
  publicAgent?: PublicAgentActionConfig;
  link?: ActionLinkBuilder;
  mcpApp?: ActionMcpAppConfig;
  chatUI?: ActionChatUIConfig;
  timeoutMs?: number;
  maxResultChars?: number;
  needsApproval?:
    | boolean
    | ((
        args: InferParams<TParams>,
        ctx?: ActionRunContext,
      ) => boolean | Promise<boolean>);
  allowPersistentApproval?: boolean;
  authorize?: ActionAuthorize<InferParams<TParams>>;
  access?: ActionAccessConfig;
  audit?: ActionAuditConfig;
}

export interface ActionDefinition<TInput, TReturn> {
  readonly run: (
    args: TInput,
    ctx?: ActionRunContext,
  ) => Promise<TReturn> | TReturn;
  /** @internal Framework use only — do not call directly. */
  readonly tool: import("./agent/types.js").ActionTool;
  readonly http?: ActionHttpConfig | false;
  readonly requiresAuth?: boolean;
  readonly maxBodyBytes?: number;
  readonly uiOnly?: boolean;
  readonly agentTool?: boolean;
  readonly mcpTool?: boolean;
  readonly mcpAnnotations?: ActionMcpToolAnnotations;
  readonly deferLoading?: boolean;
  readonly readOnly?: boolean;
  readonly grounding?: boolean;
  readonly allowInPlanMode?: boolean;
  readonly planMode?: ActionPlanModeConfig<TInput>;
  readonly changeEvents?: boolean;
  readonly persistInBrowser?: boolean;
  readonly changeResource?: (
    input: TInput,
    result: TReturn,
  ) => ActionChangeResource | null | undefined;
  readonly parallelSafe?: boolean;
  readonly retrySafe?: boolean | ((input: TInput) => boolean);
  readonly endsTurn?: boolean;
  readonly dedupe?: boolean;
  readonly toolCallable?: boolean;
  readonly capabilityScopes?: readonly string[];
  readonly publicAgent?: PublicAgentActionConfig;
  readonly link?: ActionLinkBuilder;
  readonly mcpApp?: ActionMcpAppConfig;
  readonly chatUI?: ActionChatUIConfig;
  readonly timeoutMs?: number;
  readonly maxResultChars?: number;
  readonly outputSchema?: StandardSchemaV1;
  readonly outputErrorStrategy?: ActionOutputErrorStrategy;
  readonly outputFallback?: TReturn;
  /** Present only when the action opted in with `mcpOutputSchema: true`. */
  readonly mcpOutputContract?: ActionMcpOutputContract;
  readonly needsApproval?:
    | boolean
    | ((args: TInput, ctx?: ActionRunContext) => boolean | Promise<boolean>);
  readonly allowPersistentApproval?: boolean;
  readonly audit?: ActionAuditConfig;
  readonly access?: ActionAccessConfig;
}

export function defineAction<
  TSchema extends StandardSchemaV1,
  TReturn,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
>(
  options: DefineActionWithSchema<TSchema, TReturn, TOutputSchema>,
): ActionDefinition<StandardSchemaV1.InferInput<TSchema>, TReturn>;
export function defineAction<
  TParams extends Record<string, ParameterSchema> | undefined,
  TReturn,
>(
  options: DefineActionWithParams<TParams, TReturn>,
): ActionDefinition<InferParams<TParams>, TReturn>;
export function defineAction(options: any) {
  const hasSchema = options.schema && "~standard" in options.schema;

  // Converting a schema to JSON Schema is the dominant module-scope cost of an
  // action-heavy app's cold start, so convert only the schema the agent sees.
  let toolParameters: ActionTool["parameters"];
  let inputSchemaVerdict: ConvertedSchema["verdict"];
  if (hasSchema) {
    ({ parameters: toolParameters, verdict: inputSchemaVerdict } =
      schemaToJsonSchema(
        options.agentInputSchema && "~standard" in options.agentInputSchema
          ? options.agentInputSchema
          : options.schema,
        options.description,
      ));
  } else if (options.parameters) {
    toolParameters = {
      type: "object" as const,
      properties: options.parameters,
    };
  }

  const executionKey = {};
  const ownFrame = () => {
    const frame = actionExecutionStorage?.getStore()?.frame;
    return frame?.key === executionKey ? frame : undefined;
  };
  const handlerRun = async (args: any, ctx?: ActionRunContext) => {
    const frame = ownFrame();
    if (frame) {
      frame.handlerEntered = true;
      // Evidence for this call and every call it runs inside, whatever
      // they were declared to do.
      if (frame.writes) {
        for (let f: ActionExecutionFrame | undefined = frame; f; f = f.parent) {
          f.writeEntered = true;
          if (f !== frame) f.nestedWriteEntered = true;
          if (frame.emitsChange) f.changeEntered = true;
        }
      }
    }
    return options.run(args, ctx);
  };
  const guardedRun =
    typeof options.authorize === "function" || options.access
      ? wrapRunWithAccess(handlerRun, options.access, options.authorize)
      : handlerRun;
  const uiOnlyGuardedRun =
    options.uiOnly === true
      ? async (args: any, ctx?: ActionRunContext, gateArgs?: () => unknown) => {
          if (ctx?.caller !== "frontend") {
            fail("This action can only be called from the signed-in app UI.", {
              errorCode: "ui_only_action",
              statusCode: 403,
            });
          }
          return guardedRun(args, ctx, gateArgs);
        }
      : guardedRun;

  const hasOutputSchema =
    options.outputSchema && "~standard" in options.outputSchema;
  const outputErrorStrategy: ActionOutputErrorStrategy =
    options.outputErrorStrategy === "strict" ||
    options.outputErrorStrategy === "warn" ||
    options.outputErrorStrategy === "fallback"
      ? options.outputErrorStrategy
      : "warn";

  const httpConfig = options.http as ActionHttpConfig | false | undefined;
  const inferredReadOnly =
    httpConfig !== false &&
    httpConfig !== undefined &&
    httpConfig.method === "GET";
  const readOnly: boolean | undefined =
    typeof options.readOnly === "boolean"
      ? options.readOnly
      : inferredReadOnly
        ? true
        : undefined;

  const checkOutput = hasOutputSchema
    ? outputValidator(
        options.outputSchema,
        outputErrorStrategy,
        options.outputFallback,
        options.description,
      )
    : undefined;
  // Runs inside input validation, so a call is classified from the arguments
  // `run` receives, defaults applied, and inside audit and tracking, so an
  // invalid call is still recorded as a failed run.
  const classifiedRun = async (args: any, ctx?: ActionRunContext) => {
    // Classify before `run`, which may change `args`: the effect of a call is
    // what it was asked to do. A prepared call keeps the classification its
    // gates read.
    const prepared = takePreparedClassification(ctx, args, executionKey);
    const callReadOnly = prepared
      ? prepared.readOnly
      : actionCallReadOnly({ readOnly, planMode: options.planMode }, args);
    const frame = ownFrame();
    if (frame) {
      frame.writes = callReadOnly !== true;
      frame.emitsChange = options.changeEvents !== false;
    }
    // What the call has done so far: whether a write entered its handler in
    // it or in a call nested in it. Without a frame nothing tracks that, so
    // its classification stands in, and a write is assumed to have run.
    const effect = (): ActionOutputEffect =>
      frame
        ? frame.writeEntered
          ? "committed"
          : "none"
        : actionOutputEffect(callReadOnly);
    // Readers after the run, and the gates before the handler, each get
    // their own copy of a prepared call: one could change what the next
    // reads, or what the handler runs.
    const gateArgs = prepared
      ? () => preparedCallArguments(prepared)
      : () => args;
    // A call nested in another with the same context is not the action the
    // context names, so its failures do not name it. Untracked, nesting
    // cannot be told, so none does.
    let actionName: string | undefined;
    if (frame) {
      frame.record = {
        get args() {
          return gateArgs();
        },
        readOnly: callReadOnly,
        evidence: frame,
      };
      if (frame.outcome) frame.outcome.record = frame.record;
      frame.context = ctx;
      let nested = false;
      for (let f = frame.parent; f && !nested; f = f.parent) {
        nested = ctx !== undefined && f.context === ctx;
      }
      if (!nested) actionName = ctx?.actionName;
    }
    let output: unknown;
    try {
      output = await uiOnlyGuardedRun(args, ctx, gateArgs);
    } catch (error) {
      if (effect() !== "committed") throw error;
      const committed = withCommittedEffect(error);
      if (frame) frame.raised = committed;
      throw committed;
    }
    if (!checkOutput) return output;
    try {
      return await checkOutput(output, { actionName, effect: effect() });
    } catch (error) {
      if (frame) frame.raised = error;
      throw error;
    }
  };
  const run = hasSchema
    ? wrapWithValidation(options.schema, classifiedRun, toolParameters)
    : classifiedRun;

  const uiOnly: boolean | undefined =
    typeof options.uiOnly === "boolean" ? options.uiOnly : undefined;

  const auditConfig = normalizeAuditConfig(options.audit);
  const finalRun = resolveAuditAttach(auditConfig, readOnly)
    ? wrapRunWithAudit(run, auditConfig)
    : run;
  const trackedRun = wrapRunWithServicePrincipalGrant(
    wrapRunWithActionTracking(finalRun, readOnly),
  );
  const invalidCallRun = wrapRunWithActionTracking(
    resolveAuditAttach(auditConfig, readOnly)
      ? wrapRunWithAudit(throwInvalidCallError, auditConfig)
      : throwInvalidCallError,
    readOnly,
  );

  const toolCallable: boolean | undefined =
    typeof options.toolCallable === "boolean"
      ? options.toolCallable
      : undefined;
  const agentTool: boolean | undefined =
    typeof options.agentTool === "boolean" ? options.agentTool : undefined;
  const mcpTool: boolean | undefined =
    typeof options.mcpTool === "boolean" ? options.mcpTool : undefined;
  const mcpAnnotations: ActionMcpToolAnnotations | undefined =
    options.mcpAnnotations === undefined
      ? undefined
      : options.mcpAnnotations &&
          typeof options.mcpAnnotations === "object" &&
          !Array.isArray(options.mcpAnnotations) &&
          typeof options.mcpAnnotations.readOnlyHint === "boolean" &&
          typeof options.mcpAnnotations.destructiveHint === "boolean" &&
          typeof options.mcpAnnotations.openWorldHint === "boolean" &&
          (options.mcpAnnotations.idempotentHint === undefined ||
            typeof options.mcpAnnotations.idempotentHint === "boolean")
        ? options.mcpAnnotations
        : (() => {
            throw new TypeError(
              "mcpAnnotations must define boolean readOnlyHint, destructiveHint, and openWorldHint values; idempotentHint is an optional boolean.",
            );
          })();
  const deferLoading: boolean | undefined =
    typeof options.deferLoading === "boolean"
      ? options.deferLoading
      : undefined;
  const parallelSafe: boolean | undefined =
    typeof options.parallelSafe === "boolean"
      ? options.parallelSafe
      : undefined;
  const retrySafe =
    typeof options.retrySafe === "boolean" ||
    typeof options.retrySafe === "function"
      ? options.retrySafe
      : undefined;
  const endsTurn: boolean | undefined =
    typeof options.endsTurn === "boolean" ? options.endsTurn : undefined;
  const dedupe: boolean | undefined =
    typeof options.dedupe === "boolean" ? options.dedupe : undefined;
  const publicAgent: PublicAgentActionConfig | undefined =
    options.publicAgent &&
    typeof options.publicAgent === "object" &&
    !Array.isArray(options.publicAgent)
      ? options.publicAgent
      : undefined;
  const link: ActionLinkBuilder | undefined =
    typeof options.link === "function" ? options.link : undefined;
  const mcpApp: ActionMcpAppConfig | undefined = (() => {
    if (
      !options.mcpApp ||
      typeof options.mcpApp !== "object" ||
      Array.isArray(options.mcpApp)
    ) {
      return undefined;
    }
    if (
      (options.mcpApp.compactCatalog === true ||
        options.mcpApp.structuredContent === true) &&
      !options.mcpApp.resource
    ) {
      return options.mcpApp as ActionMcpAppConfig;
    }
    if (
      options.mcpApp.resource &&
      typeof options.mcpApp.resource === "object" &&
      !Array.isArray(options.mcpApp.resource) &&
      (typeof options.mcpApp.resource.html === "string" ||
        typeof options.mcpApp.resource.html === "function")
    ) {
      return options.mcpApp as ActionMcpAppConfig;
    }
    return undefined;
  })();
  const chatUI = normalizeActionChatUIConfig(options.chatUI);
  const mcpOutputContract: ActionMcpOutputContract | undefined = (() => {
    if (options.mcpOutputSchema !== true) return undefined;
    if (!hasOutputSchema) {
      throw new TypeError("mcpOutputSchema requires an outputSchema.");
    }
    if (outputErrorStrategy !== "strict") {
      throw new TypeError(
        'mcpOutputSchema requires outputErrorStrategy: "strict", so the advertised contract is enforced.',
      );
    }
    return buildActionMcpOutputContract(options.outputSchema, {
      openLink: Boolean(link || mcpApp?.resource),
    });
  })();

  const entry = {
    tool: {
      ...(typeof options.title === "string" && options.title.trim()
        ? { title: options.title.trim() }
        : {}),
      description: options.description,
      parameters: toolParameters,
    },
    run: wrapRunWithExecutionBoundary(trackedRun, executionKey),
    ...(hasSchema ? { schema: options.schema } : {}),
    ...(options.http !== undefined ? { http: options.http } : {}),
    ...(typeof options.requiresAuth === "boolean"
      ? { requiresAuth: options.requiresAuth }
      : {}),
    ...(typeof options.maxBodyBytes === "number"
      ? { maxBodyBytes: options.maxBodyBytes }
      : {}),
    ...(typeof uiOnly === "boolean" ? { uiOnly } : {}),
    ...(typeof agentTool === "boolean" ? { agentTool } : {}),
    ...(typeof mcpTool === "boolean" ? { mcpTool } : {}),
    ...(mcpAnnotations ? { mcpAnnotations } : {}),
    ...(typeof deferLoading === "boolean" ? { deferLoading } : {}),
    ...(typeof readOnly === "boolean" ? { readOnly } : {}),
    ...(typeof options.grounding === "boolean"
      ? { grounding: options.grounding }
      : {}),
    ...(typeof options.allowInPlanMode === "boolean"
      ? { allowInPlanMode: options.allowInPlanMode }
      : {}),
    ...(options.planMode &&
    typeof options.planMode === "object" &&
    !Array.isArray(options.planMode) &&
    (typeof options.planMode.effect === "function" ||
      options.planMode.effect === "read" ||
      options.planMode.effect === "write" ||
      options.planMode.effect === "unknown")
      ? { planMode: options.planMode }
      : {}),
    ...(typeof options.changeEvents === "boolean"
      ? { changeEvents: options.changeEvents }
      : {}),
    ...(typeof options.persistInBrowser === "boolean"
      ? { persistInBrowser: options.persistInBrowser }
      : {}),
    ...(typeof options.changeResource === "function"
      ? { changeResource: options.changeResource }
      : {}),
    ...(typeof parallelSafe === "boolean" ? { parallelSafe } : {}),
    ...(retrySafe !== undefined ? { retrySafe } : {}),
    ...(typeof endsTurn === "boolean" ? { endsTurn } : {}),
    ...(typeof dedupe === "boolean" ? { dedupe } : {}),
    ...(typeof toolCallable === "boolean" ? { toolCallable } : {}),
    ...(Array.isArray(options.capabilityScopes) &&
    options.capabilityScopes.length > 0
      ? { capabilityScopes: options.capabilityScopes }
      : {}),
    ...(publicAgent ? { publicAgent } : {}),
    ...(link ? { link } : {}),
    ...(mcpApp ? { mcpApp } : {}),
    ...(chatUI ? { chatUI } : {}),
    ...(typeof options.timeoutMs === "number"
      ? { timeoutMs: options.timeoutMs }
      : {}),
    ...(typeof options.maxResultChars === "number"
      ? { maxResultChars: options.maxResultChars }
      : {}),
    ...(hasOutputSchema
      ? {
          outputSchema: options.outputSchema,
          outputErrorStrategy,
          ...(outputErrorStrategy === "fallback"
            ? { outputFallback: options.outputFallback }
            : {}),
        }
      : {}),
    ...(mcpOutputContract ? { mcpOutputContract } : {}),
    ...(typeof options.needsApproval === "boolean" ||
    typeof options.needsApproval === "function"
      ? { needsApproval: options.needsApproval }
      : {}),
    ...(typeof options.allowPersistentApproval === "boolean"
      ? { allowPersistentApproval: options.allowPersistentApproval }
      : {}),
    ...(auditConfig ? { audit: auditConfig } : {}),
    ...(options.access ? { access: options.access } : {}),
  };
  // Enumerable on purpose: an app that wraps `run` with `{ ...entry, run }`
  // keeps the key, so the loop can still tell a pre-handler refusal from a
  // handler failure. Without it the wrapper's own frame never becomes the
  // action's frame and every validation error reads as an unknown write.
  Object.defineProperty(entry, ACTION_EXECUTION_KEY, {
    value: executionKey,
    enumerable: true,
  });
  Object.defineProperty(executionKey, ACTION_INVALID_CALL_RECORDER, {
    value: (args: unknown, ctx: ActionRunContext, error: unknown) => {
      invalidCallErrors.set(ctx, error);
      return invalidCallRun(args, ctx);
    },
  });
  if (inputSchemaVerdict) {
    recordInputSchemaVerdict(entry.tool, inputSchemaVerdict);
  }
  return entry;
}

export function isActionExposedToExternalAgents(entry: {
  agentTool?: boolean;
  mcpTool?: boolean;
  endsTurn?: boolean;
  uiOnly?: boolean;
}): boolean {
  if (entry.uiOnly === true) return false;
  if (entry.endsTurn === true) {
    return entry.mcpTool === true;
  }
  return typeof entry.mcpTool === "boolean"
    ? entry.mcpTool
    : entry.agentTool !== false;
}

export function isActionHiddenFromEveryAgentSurface(entry: {
  agentTool?: boolean;
  mcpTool?: boolean;
  uiOnly?: boolean;
}): boolean {
  return (
    entry.uiOnly === true ||
    (entry.agentTool === false && entry.mcpTool !== true)
  );
}

function wrapRunWithAccess(
  run: (args: any, ctx?: ActionRunContext) => any,
  access: ActionAccessConfig | undefined,
  authorize: ActionAuthorize<any> | undefined,
): (
  args: any,
  ctx?: ActionRunContext,
  gateArgs?: () => unknown,
) => Promise<any> {
  return async function accessCheckedRun(
    args: any,
    ctx?: ActionRunContext,
    gateArgs: () => unknown = () => args,
  ) {
    if (access) await assertRegisteredActionAccess(access, gateArgs(), ctx);
    if (authorize) {
      const verdict = await authorize(gateArgs() as any, ctx);
      if (verdict === false) {
        const err = new Error("Not authorized") as Error & {
          statusCode: number;
        };
        err.name = "ForbiddenError";
        err.statusCode = 403;
        throw err;
      }
    }
    return run(args, ctx);
  };
}

/**
 * Runs outside action tracking, so a refused call is audited once as a denial
 * and never as a failed run of the action. Every route to running an action as
 * a service identity passes here.
 */
function wrapRunWithServicePrincipalGrant(
  run: (args: any, ctx?: ActionRunContext) => any,
): (args: any, ctx?: ActionRunContext) => any {
  return function grantCheckedRun(args: any, ctx?: ActionRunContext) {
    if (!parseServiceIdentityEmail(ctx?.userEmail)) return run(args, ctx);
    return import("./org/service-principal-guard.js")
      .then(({ enforceServicePrincipalActionGrant }) =>
        enforceServicePrincipalActionGrant({
          email: ctx!.userEmail,
          orgId: ctx!.orgId,
          // A missing name only passes an unrestricted grant.
          actionName: ctx!.actionName ?? "",
          caller: ctx!.caller,
        }),
      )
      .then(() => run(args, ctx));
  };
}

function wrapRunWithAudit(
  run: (args: any, ctx?: ActionRunContext) => any,
  auditConfig: ActionAuditConfig | undefined,
): (args: any, ctx?: ActionRunContext) => Promise<any> {
  return async function auditedRun(args: any, ctx?: ActionRunContext) {
    // The run consumes the preparation, and its handler may change `args`.
    const prepared = boundActionCallIntent(ctx, args);
    const recorded = prepared ? preparedCallArguments(prepared) : args;
    let result: any;
    let error: unknown;
    let threw = false;
    try {
      result = await run(args, ctx);
    } catch (err) {
      error = err;
      threw = true;
    }
    try {
      const { recordActionAudit } = await import("./audit/record.js");
      await recordActionAudit(
        threw
          ? { config: auditConfig, args: recorded, ctx, status: "error", error }
          : {
              config: auditConfig,
              args: recorded,
              ctx,
              status: "success",
              result,
            },
      );
    } catch {
      // Recorder failed to load/run — never affect the action.
    }
    if (threw) throw error;
    return result;
  };
}

/**
 * Remove or rewrite JSON Schema keywords that some providers' function-calling
 * schema validators reject. OpenAI (and Gemini via the Builder gateway) reject
 * `propertyNames` — which Zod v4 emits for `z.record(z.string(), …)` — with a
 * `400 invalid_function_parameters` error, causing the model turn to produce no
 * content (surfacing as an empty assistant response). Anthropic ignores the
 * keyword, so stripping it is safe across providers and keeps action schemas
 * portable. `propertyNames` only constrained object *keys*; the value/shape of
 * the object is unaffected by its removal.
 *
 * OpenAI rejects `oneOf` the same way — "Invalid schema for function 'x': …
 * 'oneOf' is not permitted" — while accepting `anyOf`. Zod v4's `toJSONSchema`
 * emits `oneOf` for every `z.discriminatedUnion`, so any action with one was
 * 400'd for the whole request before a token streamed, and the gateway folded
 * that 400 into a generic 500. Measured: 178k events / 786 users over seven
 * weeks from a single action. For a discriminated union the two keywords accept
 * the same documents, and the tool-input validator already handles both
 * (see `narrowUnionBranchErrors`), so the rewrite is behaviour-preserving.
 *
 * Only descends through actual subschema positions (properties, items, union
 * branches, definitions, etc.) — never through value-bearing keywords like
 * `default`, `const`, `enum`, or `examples`, whose objects may legitimately
 * contain a `propertyNames` data key that must be preserved.
 */
/**
 * A schema position with no `type` — what Zod emits for `z.unknown()` /
 * `z.any()` — is rejected by OpenAI with "schema must have a 'type' key",
 * 400ing the whole request exactly like `oneOf` did. There are 137 such sites
 * across the templates, so this has to be answered at the boundary rather than
 * by retyping every action.
 *
 * Expressed as a union of concrete JSON types because that shape is already
 * proven against the live validator: `setFilterDefault.value`, a
 * `z.union([string, number, boolean, null])` sitting in the same tool schema,
 * was never flagged while the typeless sibling next to it was. The default
 * writer is bounded (see `json-schema/json-value.ts`); MCP passes a writer
 * that references an unbounded root definition instead.
 *
 * Every rewrite here must only widen what the schema accepts: callers advertise
 * the result, and a host that validates arguments against it would otherwise
 * reject calls the action accepts. Removing a keyword widens only in a positive
 * position, so the keywords whose meaning depends on a sibling are handled
 * together: `patternProperties` exempts keys from `additionalProperties`,
 * every in-place applicator feeds `unevaluatedProperties`/`unevaluatedItems`,
 * and loosening `contains` raises the match count `maxContains` caps.
 */
const TYPE_SUBSTITUTE_KEYS = [
  "type",
  "anyOf",
  "oneOf",
  "allOf",
  "enum",
  "const",
  "$ref",
  "not",
] as const;

const PROVIDER_SUPPORTED_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uuid",
]);

const LOOKAROUND_IN_PATTERN = /\(\?<?[=!]/;

const PROVIDER_REJECTED_KEYWORDS = [
  "propertyNames",
  "dependentSchemas",
  "dependentRequired",
  "dependencies",
  "if",
  "then",
  "else",
  "not",
] as const;

const EVALUATION_DEPENDENT_KEYWORDS = [
  "unevaluatedProperties",
  "unevaluatedItems",
] as const;

export function stripUnsupportedSchemaKeywords<T>(
  node: T,
  writeJsonValue: JsonValueWriter = writeBoundedJsonValue,
): T {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const obj = node as Record<string, unknown>;

  for (const keyword of PROVIDER_REJECTED_KEYWORDS) delete obj[keyword];
  for (const keyword of EVALUATION_DEPENDENT_KEYWORDS) delete obj[keyword];
  if (obj.patternProperties !== undefined) {
    delete obj.patternProperties;
    if (obj.additionalProperties !== true) delete obj.additionalProperties;
  }
  if (obj.contains !== undefined) delete obj.maxContains;
  if (
    typeof obj.format === "string" &&
    !PROVIDER_SUPPORTED_FORMATS.has(obj.format)
  ) {
    delete obj.format;
  }
  if (
    typeof obj.pattern === "string" &&
    LOOKAROUND_IN_PATTERN.test(obj.pattern)
  ) {
    delete obj.pattern;
  }

  for (const child of subschemasOf(obj)) {
    stripUnsupportedSchemaKeywords(child.value, writeJsonValue);
  }
  if (Array.isArray(obj.oneOf)) {
    const existing = Array.isArray(obj.anyOf) ? obj.anyOf : [];
    obj.anyOf = [...existing, ...obj.oneOf];
    delete obj.oneOf;
  }
  if (obj.type === undefined) typeEnumeratedValues(obj);
  withStringOnlyEnum(obj);
  if (!TYPE_SUBSTITUTE_KEYS.some((key) => obj[key] !== undefined)) {
    writeJsonValue(obj);
  }
  return node;
}

/**
 * Codex lowers `const` to a one-value `enum` and types a typeless `enum` as
 * "string" (`sanitize_json_schema` in codex-rs/tools/src/json_schema.rs), so
 * `{ "const": 1 }` reaches the model as a string and a host checking against
 * it refuses `1`. The values already fix the type, so writing it accepts
 * exactly what the schema did. Values of several types split into one typed
 * anyOf branch per type, the shape every provider took for the JSON-value
 * union.
 */
function typeEnumeratedValues(obj: Record<string, unknown>): void {
  const values =
    obj.const !== undefined
      ? [obj.const]
      : Array.isArray(obj.enum)
        ? obj.enum
        : [];
  const byType = new Map<string, unknown[]>();
  for (const value of values) {
    const type = jsonTypeOf(value);
    byType.set(type, [...(byType.get(type) ?? []), value]);
  }
  // An empty `enum` stays untyped, so `defineAction` and the in-app and MCP
  // converters refuse one (`assertUsableSchema`) before they run this.
  if (byType.size === 0) return;
  if (byType.size === 1) {
    obj.type = [...byType.keys()][0];
    return;
  }
  const branches = [...byType].map(([type, members]) => {
    if (type === "null") return { type };
    const branch = { type, enum: members };
    withStringOnlyEnum(branch);
    return branch;
  });
  delete obj.const;
  delete obj.enum;
  if (obj.anyOf === undefined) obj.anyOf = branches;
  else {
    const allOf = Array.isArray(obj.allOf) ? obj.allOf : [];
    obj.allOf = [...allOf, { anyOf: branches }];
  }
}

/**
 * Gemini's `enum` holds strings only
 * (https://ai.google.dev/api/generate-content#v1beta.Schema), so an enum
 * listing any other value goes out as its type, with the values in the
 * description, as MCP does with `maxItems`: the type stays and only the list
 * goes, which widens. One value is a `const`, which says the same, and a
 * `const` beside the enum already names the one value both allow. Before they
 * run this, `defineAction` and the in-app and MCP converters refuse a `const`
 * its enum does not list and an enum with no value of its type
 * (`assertUsableSchema`), so what is left accepts a value.
 */
function withStringOnlyEnum(obj: Record<string, unknown>): void {
  const values = obj.enum;
  if (!Array.isArray(values)) return;
  if (values.every((value) => typeof value === "string")) return;
  delete obj.enum;
  if (obj.const !== undefined) return;
  if (values.length === 1) {
    obj.const = values[0];
    return;
  }
  const allowed = `Allowed values: ${values.map((value) => JSON.stringify(value)).join(", ")}.`;
  obj.description =
    typeof obj.description === "string" && obj.description
      ? `${obj.description} ${allowed}`
      : allowed;
}

interface ConvertedSchema {
  parameters: ActionTool["parameters"];
  verdict?: UnusableSchemaError | UninterpretedSchema;
}

function schemaToJsonSchema(
  schema: StandardSchemaV1,
  _description?: string,
): ConvertedSchema {
  const s = schema as any;
  const anyObject = { type: "object" as const, properties: {} };
  try {
    // Finding the emitter is part of converting: a property that throws is a
    // schema this cannot convert, not one from a library with no emitter.
    const jsonSchema = s["~standard"]?.jsonSchema;
    let emitted: unknown;
    if (jsonSchema?.input) {
      emitted = jsonSchema.input({ target: "draft-2020-12" });
    } else if (s._zod?.def) emitted = zodDefToJsonSchema(s._zod.def);
    else return { parameters: anyObject };
    // The emitter's result can be cached and shared, so it is never edited.
    // Checked before stripping, which can hide what the check finds from the
    // converters that read the parameters: a `const` loses the non-string
    // `enum` that does not list it, and `oneOf` becomes `anyOf` under a
    // reference into it unless that reference is rebased.
    const verdict = assertUsableSchema(plainJsonSnapshot(emitted));
    const source =
      verdict instanceof UninterpretedSchema ? verdict.schema : verdict;
    delete source.$schema;
    return {
      parameters: stripUnsupportedSchemaKeywords<unknown>(
        source,
      ) as ActionTool["parameters"],
      ...(verdict instanceof UninterpretedSchema ? { verdict } : {}),
    };
  } catch (error) {
    // Alone, `anyObject` would claim the schema accepts any object. With the
    // reason beside it, MCP and the in-app agent leave the action out; A2A
    // cards, the manifest and tool search still read `anyObject`.
    return {
      parameters: anyObject,
      verdict:
        error instanceof UnusableSchemaError
          ? error
          : new UnusableSchemaError(
              "",
              `could not be converted: ${error instanceof Error ? error.message : String(error)}`,
            ),
    };
  }
}

function zodDefToJsonSchema(def: any): any {
  const type = def.type;

  if (type === "object") {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    const shape = def.shape;
    if (shape) {
      for (const [key, fieldSchema] of Object.entries(shape) as any[]) {
        const fieldDef = fieldSchema?._zod?.def;
        if (fieldDef) {
          const prop = zodDefToJsonSchema(fieldDef);
          const desc = fieldSchema?.description;
          if (desc && !prop.description) prop.description = desc;
          properties[key] = prop;
          if (
            fieldDef.type !== "optional" &&
            fieldDef.type !== "default" &&
            fieldDef.type !== "nullable"
          ) {
            required.push(key);
          }
        }
      }
    }
    const result: any = { type: "object", properties };
    if (required.length > 0) result.required = required;
    return result;
  }

  if (type === "string") {
    const result: any = { type: "string" };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "number" || type === "float" || type === "int") {
    const result: any = { type: type === "int" ? "integer" : "number" };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "boolean") {
    const result: any = { type: "boolean" };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "enum") {
    const entries = def.entries;
    const enumValues = Array.isArray(entries)
      ? entries
      : typeof entries === "object" && entries !== null
        ? Object.values(entries)
        : entries;
    const result: any = { type: "string", enum: enumValues };
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "literal") {
    return { type: typeof def.value, enum: [def.value] };
  }

  if (type === "array") {
    const result: any = { type: "array" };
    if (def.element?._zod?.def) {
      result.items = zodDefToJsonSchema(def.element._zod.def);
    }
    if (def.description) result.description = def.description;
    return result;
  }

  if (type === "optional") {
    if (def.innerType?._zod?.def) {
      return zodDefToJsonSchema(def.innerType._zod.def);
    }
  }

  if (type === "default") {
    if (def.innerType?._zod?.def) {
      const inner = zodDefToJsonSchema(def.innerType._zod.def);
      inner.default =
        typeof def.defaultValue === "function"
          ? def.defaultValue()
          : def.defaultValue;
      return inner;
    }
  }

  if (type === "nullable") {
    if (def.innerType?._zod?.def) {
      const inner = zodDefToJsonSchema(def.innerType._zod.def);
      return { anyOf: [inner, { type: "null" }] };
    }
  }

  if (type === "union") {
    if (def.options?.length) {
      const allLiterals = def.options.every(
        (o: any) => o?._zod?.def?.type === "literal",
      );
      if (allLiterals) {
        const values = def.options.map((o: any) => o._zod.def.value);
        const jsonTypeOf = (v: any) =>
          typeof v === "number"
            ? "number"
            : typeof v === "boolean"
              ? "boolean"
              : "string";
        const uniqueTypes = [...new Set(values.map(jsonTypeOf))];
        if (uniqueTypes.length === 1) {
          return { type: uniqueTypes[0], enum: values };
        }
        return {
          anyOf: values.map((v: any) => ({ type: jsonTypeOf(v), enum: [v] })),
        };
      }
      return {
        anyOf: def.options.map((o: any) =>
          zodDefToJsonSchema(o._zod?.def ?? {}),
        ),
      };
    }
  }

  if (type === "pipe") {
    if (def.out?._zod?.def) {
      return zodDefToJsonSchema(def.out._zod.def);
    }
    if (def.in?._zod?.def) {
      return zodDefToJsonSchema(def.in._zod.def);
    }
  }

  return { type: "string" };
}

const MAX_SIGNATURE_DEPTH = 4;
const MAX_SIGNATURE_LENGTH = 1200;

function describeSchemaType(
  spec: AgentNativeJsonSchema | undefined,
  depth: number,
): string {
  if (!spec) return "any";
  if (spec.const !== undefined) return JSON.stringify(spec.const);
  if (Array.isArray(spec.enum)) {
    return spec.enum.map((value) => JSON.stringify(value)).join("|");
  }

  const branches = spec.oneOf ?? spec.anyOf;
  if (branches?.length) {
    if (depth >= MAX_SIGNATURE_DEPTH) return "object";
    return branches
      .map((branch) => describeSchemaType(branch, depth))
      .join(" | ");
  }

  if (spec.properties && Object.keys(spec.properties).length > 0) {
    if (depth >= MAX_SIGNATURE_DEPTH) return "object";
    const required = new Set(spec.required ?? []);
    const members = Object.entries(spec.properties)
      .map(
        ([key, value]) =>
          `${key}${required.has(key) ? "*" : "?"}: ${describeSchemaType(value, depth + 1)}`,
      )
      .join(", ");
    return `{ ${members} }`;
  }

  if (spec.items) {
    if (depth >= MAX_SIGNATURE_DEPTH) return "array";
    return `array<${describeSchemaType(spec.items, depth + 1)}>`;
  }

  return Array.isArray(spec.type) ? spec.type.join("|") : (spec.type ?? "any");
}

export function describeToolParameterSignature(
  parameters: ActionTool["parameters"] | undefined,
  only?: readonly string[],
): string | null {
  const properties = parameters?.properties;
  if (!properties) return null;
  const required = new Set(parameters?.required ?? []);
  const keys = Object.keys(properties).filter(
    (key) => !only?.length || only.includes(key),
  );
  const sig = (keys.length ? keys : Object.keys(properties))
    .map(
      (key) =>
        `${key}${required.has(key) ? "*" : "?"}: ${describeSchemaType(properties[key], 1)}`,
    )
    .join(", ");
  if (!sig) return null;
  return `{ ${sig.length > MAX_SIGNATURE_LENGTH ? `${sig.slice(0, MAX_SIGNATURE_LENGTH)}…` : sig} }`;
}

/**
 * Arguments already validated for the run that receives them, so it does not
 * parse them again. A prepared call is held by its arguments object, which a
 * wrapper that rebuilds the context still passes through; arguments that are
 * not an object, and `validateActionArgs`, use the context. From
 * `actionCallIntent`, the call also carries its classification and the action
 * it was classified for.
 */
interface PreparedRun {
  readonly schema: StandardSchemaV1 | undefined;
  readonly value: unknown;
  readonly key?: object;
  readonly intent?: PreparedActionCall;
}

const preparedRuns = new WeakMap<object, PreparedRun>();

function preparedRunHolder(ctx: unknown, args: unknown): object | undefined {
  if (args !== null && typeof args === "object" && preparedRuns.has(args)) {
    return args;
  }
  return ctx !== null && typeof ctx === "object" ? ctx : undefined;
}

function preparedRunFor(ctx: unknown, args: unknown): PreparedRun | undefined {
  const holder = preparedRunHolder(ctx, args);
  const prepared = holder ? preparedRuns.get(holder) : undefined;
  return prepared && Object.is(prepared.value, args) ? prepared : undefined;
}

/** A prepared call, consumed by the run of the action it was classified for. */
function takePreparedClassification(
  ctx: ActionRunContext | undefined,
  args: unknown,
  executionKey: object,
): PreparedActionCall | undefined {
  const prepared = preparedRunFor(ctx, args);
  if (!prepared?.intent || prepared.key !== executionKey) return undefined;
  preparedRuns.delete(preparedRunHolder(ctx, args)!);
  return prepared.intent;
}

/** What a call, and every call nested in it, has done so far. */
export interface ActionCallEvidence {
  /** A write entered its handler. */
  readonly writeEntered: boolean;
  /** A write whose action publishes changes entered its handler. */
  readonly changeEntered: boolean;
  /** One of those writes was nested in the call, not the call's own. */
  readonly nestedWriteEntered?: boolean;
  /**
   * The failure this call raised or rebuilt itself; only its typed effect
   * speaks for the call. Its own, so another call throwing it again cannot
   * change it.
   */
  readonly raised?: unknown;
}

/** One `defineAction` call as `run` received it, for the transport that made it. */
export interface ActionCallRecord {
  /**
   * The arguments after input validation applied defaults. For a prepared
   * call, each read is a fresh copy of the arguments it was prepared with.
   */
  readonly args: unknown;
  /** The call's classification, taken before `run`; `undefined` when undeclared. */
  readonly readOnly: boolean | undefined;
  /** Live while the call runs. */
  readonly evidence: ActionCallEvidence;
}

/**
 * What a dispatcher observed of one call, live from before it awaits `run`, so
 * a caller that stops waiting still reads what has run: whether it was
 * refused before any handler, and the record of the `defineAction` call it
 * ran. The record lives on the execution frame, not the context, so a wrapper
 * that rebuilds the context keeps it.
 */
export interface ActionExecutionOutcome {
  refused: boolean;
  record?: ActionCallRecord;
  /** What the call, and every call nested in it, has done; absent untracked. */
  evidence?: ActionCallEvidence;
  /** The entry is a `defineAction` action's, so its run records a call of it. */
  keyed?: boolean;
}

/** Rejected action input; execution phase determines whether effects are possible. */
export class ActionInputValidationError extends Error {}

type ActionExecutionRun = (args: any, ctx?: ActionRunContext) => Promise<any>;
type ActionExecutionFrame = {
  key: object;
  run: ActionExecutionRun;
  parent?: ActionExecutionFrame;
  handlerEntered: boolean;
  /** A write entered its handler in this call or in one nested in it. */
  writeEntered: boolean;
  /** One of those writes publishes action changes. */
  changeEntered: boolean;
  /** This call's classification, once validated arguments set it. */
  writes?: boolean;
  emitsChange?: boolean;
  boundaryPending?: boolean;
  /** The call's record, and the context it ran with, once validated. */
  record?: ActionCallRecord;
  context?: ActionRunContext;
  nestedWriteEntered?: boolean;
  raised?: unknown;
  /** The dispatcher's outcome, which takes the record as it is made. */
  outcome?: ActionExecutionOutcome;
};
type ActionExecutionState = {
  frame?: ActionExecutionFrame;
  failures: WeakMap<object, ActionExecutionFrame>;
};
const ActionExecutionStorage = getAsyncLocalStorageCtor();
const actionExecutionStorage = ActionExecutionStorage
  ? new ActionExecutionStorage<ActionExecutionState>()
  : undefined;

function wrapRunWithExecutionBoundary(
  run: ActionExecutionRun,
  key: object,
): ActionExecutionRun {
  const boundaryRun: ActionExecutionRun = async (args, ctx) => {
    if (!actionExecutionStorage) return run(args, ctx);
    const parent = actionExecutionStorage.getStore();
    const frame: ActionExecutionFrame =
      parent?.frame?.boundaryPending &&
      (parent.frame.run === boundaryRun || parent.frame.key === key)
        ? parent.frame
        : {
            key,
            run: boundaryRun,
            parent: parent?.frame,
            handlerEntered: false,
            writeEntered: false,
            changeEntered: false,
          };
    frame.key = key;
    frame.boundaryPending = false;
    frame.handlerEntered = false;
    const state: ActionExecutionState = {
      frame,
      failures: parent?.failures ?? new WeakMap(),
    };
    return actionExecutionStorage.run(state, async () => {
      try {
        return await run(args, ctx);
      } catch (error) {
        if (error !== null && typeof error === "object") {
          state.failures.set(error, frame);
        }
        throw error;
      }
    });
  };
  return boundaryRun;
}

/** @internal Observe one public action invocation without transferring child refusals. */
export async function runActionWithExecutionOutcome(
  run: ActionExecutionRun,
  args: unknown,
  ctx: ActionRunContext | undefined,
  outcome: ActionExecutionOutcome,
  entry?: object,
): Promise<any> {
  outcome.refused = false;
  delete outcome.record;
  delete outcome.evidence;
  delete outcome.keyed;
  // A mutable async stack cannot safely attribute overlapping invocations.
  if (!actionExecutionStorage) return run(args, ctx);
  const parent = actionExecutionStorage.getStore();
  const entryKey = entry
    ? (entry as Record<symbol, unknown>)[ACTION_EXECUTION_KEY]
    : undefined;
  const keyed = entryKey !== null && typeof entryKey === "object";
  const frame: ActionExecutionFrame = {
    // The entry's own key lets its boundary adopt this frame when an app has
    // wrapped `run`; an unkeyed entry gets a placeholder nothing can match.
    key: keyed ? entryKey : {},
    run,
    parent: parent?.frame,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    boundaryPending: true,
    outcome,
  };
  outcome.evidence = frame;
  outcome.keyed = keyed;
  // Read before the action's boundary takes it.
  const prepared = preparedRunFor(ctx, args)?.intent;
  const state: ActionExecutionState = {
    frame,
    failures: parent?.failures ?? new WeakMap(),
  };
  return actionExecutionStorage.run(state, async () => {
    try {
      return await run(args, ctx);
    } catch (error) {
      const failure =
        error !== null && typeof error === "object"
          ? state.failures.get(error)
          : undefined;
      // Error types cannot prove non-execution once the handler has entered.
      // A keyed entry whose boundary was never entered threw in an app
      // wrapper around `run`, before any handler could start.
      outcome.refused =
        !frame.writeEntered &&
        ((!frame.handlerEntered && failure === frame) ||
          (frame.key !== undefined && frame.boundaryPending === true && keyed));
      // A typed failure from inside speaks only for the call that raised it,
      // not for a write beside it, a call the entry never recorded, or an
      // entry's own untracked write; this call reports its own effect.
      const mayHaveWritten =
        !outcome.refused &&
        actionFailureEffect(error) !== undefined &&
        invocationEffect(entry ?? {}, outcome, {
          readOnly: prepared?.readOnly,
          retrySafe:
            prepared !== undefined &&
            actionCallIsRetrySafe(entry ?? {}, preparedCallArguments(prepared)),
          failed: { error },
        }).effect !== "none";
      if (mayHaveWritten) {
        frame.raised = withCommittedEffect(error);
        throw frame.raised;
      }
      throw error;
    } finally {
      // A boundary entered once the call settled is a call of its own: it
      // cannot leave its record on this one.
      frame.boundaryPending = false;
    }
  });
}

export async function validateActionArgs(
  schema: StandardSchemaV1,
  args: unknown,
  toolParameters?: ActionTool["parameters"],
  ctx?: object,
): Promise<any> {
  args = coerceGatewayStringifiedArgs(args, toolParameters);
  const result = await schema["~standard"].validate(args);
  if (result.issues) {
    const missing: string[] = [];
    const other: string[] = [];
    for (const issue of result.issues) {
      const pathStr = issue.path
        ? issue.path.map((p) => (typeof p === "object" ? p.key : p)).join(".")
        : "";
      const msg = String(issue.message ?? "");
      if (
        pathStr &&
        (msg === "Required" ||
          /invalid.*undefined/i.test(msg) ||
          /expected.*received undefined/i.test(msg))
      ) {
        missing.push(pathStr);
      } else {
        other.push(pathStr ? `${pathStr}: ${msg}` : msg);
      }
    }

    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `Missing required parameter${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      );
    }
    if (other.length > 0) {
      parts.push(other.join("; "));
    }

    let received: string;
    try {
      received = JSON.stringify(args);
      if (received.length > 500) received = received.slice(0, 500) + "…";
    } catch {
      received = String(args);
    }

    const signature = describeToolParameterSignature(toolParameters);
    const expected = signature
      ? ` Expected: ${signature} (where * = required, ? = optional).`
      : "";

    throw new ActionInputValidationError(
      `Invalid action parameters — ${parts.join(". ")}. Received: ${received}.${expected}`,
    );
  }
  const value = (result as StandardSchemaV1.SuccessResult<any>).value;
  if (ctx) preparedRuns.set(ctx, { schema, value });
  return value;
}

declare const preparedActionCallBrand: unique symbol;

/**
 * One call prepared to run: its arguments as its action will run them, input
 * validation and defaults applied, and the classification of those arguments.
 * Only `actionCallIntent` makes one, and `runPreparedActionCall` executes
 * exactly these arguments with this classification, without parsing or
 * classifying them again. An entry without an input schema runs its arguments
 * as given.
 */
export type PreparedActionCall = {
  readonly valid: true;
  /**
   * Exact identity of the arguments, which approvals, replays and reuse
   * bind. Read the arguments with `preparedCallArguments`.
   */
  readonly argumentsHash: string;
  readonly [preparedActionCallBrand]: true;
} & ActionCallClassification;

/**
 * A call prepared to run, or the error validation refused it with. Gates that
 * decide whether, how, or how often a call may run read this, never the raw
 * arguments, which defaults can turn from a read into a write.
 */
export type ActionCallIntent =
  | PreparedActionCall
  | { readonly valid: false; readonly error: unknown };

/**
 * What only `actionCallIntent` can vouch for: the schema and action an intent
 * was prepared with, and the snapshot of its arguments, which no consumer
 * holds: each reads its own copy.
 */
const preparedIntents = new WeakMap<
  object,
  {
    readonly schema: StandardSchemaV1 | undefined;
    readonly key?: object;
    readonly snapshot: unknown;
  }
>();

export async function actionCallIntent(
  entry: {
    schema?: unknown;
    tool?: { parameters?: ActionTool["parameters"] };
    readOnly?: boolean;
    planMode?: ActionPlanModeConfig<any>;
  },
  input: unknown,
): Promise<ActionCallIntent> {
  let args = input;
  const schema =
    entry.schema &&
    typeof entry.schema === "object" &&
    "~standard" in entry.schema
      ? (entry.schema as StandardSchemaV1)
      : undefined;
  let snapshot: ReturnType<typeof snapshotActionArguments>;
  try {
    if (schema) {
      args = await validateActionArgs(schema, input, entry.tool?.parameters);
    }
    // Arguments with no exact snapshot (an accessor, a Map, a class
    // instance) are refused: a gate could not be sure it read what runs.
    snapshot = snapshotActionArguments(args);
  } catch (error) {
    return { valid: false, error };
  }
  const intent = {
    valid: true,
    argumentsHash: snapshot.hash,
    ...classifyActionCall(entry, copyActionArguments(snapshot.value)),
  } as PreparedActionCall;
  const key = (entry as Record<symbol, unknown>)[ACTION_EXECUTION_KEY];
  preparedIntents.set(intent, {
    schema,
    ...(key !== null && typeof key === "object" ? { key } : {}),
    snapshot: snapshot.value,
  });
  return intent;
}

/**
 * A fresh, mutable copy of the arguments `call` was prepared with, for one
 * consumer: a gate, the handler, or a reader after the run. No two consumers
 * share one, so none can change what another reads.
 */
export function preparedCallArguments(call: PreparedActionCall): unknown {
  const prepared = preparedIntents.get(call);
  if (!prepared) {
    throw new TypeError(
      "Only a call prepared by actionCallIntent has prepared arguments.",
    );
  }
  return copyActionArguments(prepared.snapshot);
}

/**
 * @internal Executes a prepared call: `entry.run` receives its own copy of the
 * prepared arguments, which the action's input validation and classification
 * take as prepared instead of repeating. With `outcome`, the run is observed
 * as `runActionWithExecutionOutcome` observes it.
 */
export function runPreparedActionCall(
  entry: { run(args: any, ctx?: ActionRunContext): unknown },
  call: PreparedActionCall,
  ctx: ActionRunContext,
  outcome?: ActionExecutionOutcome,
): Promise<any> {
  const prepared = preparedIntents.get(call);
  if (!prepared) {
    throw new TypeError(
      "Only a call prepared by actionCallIntent can be run as prepared.",
    );
  }
  const args = copyActionArguments(prepared.snapshot);
  preparedRuns.set(args !== null && typeof args === "object" ? args : ctx, {
    schema: prepared.schema,
    value: args,
    ...(prepared.key ? { key: prepared.key } : {}),
    intent: call,
  });
  return outcome
    ? runActionWithExecutionOutcome(
        entry.run as ActionExecutionRun,
        args,
        ctx,
        outcome,
        entry,
      )
    : Promise.resolve(entry.run(args, ctx));
}

/** @internal The prepared call a run of these arguments executes, before its action consumes it. */
export function boundActionCallIntent(
  ctx: ActionRunContext | undefined,
  args: unknown,
): PreparedActionCall | undefined {
  return preparedRunFor(ctx, args)?.intent;
}

function wrapWithValidation(
  schema: StandardSchemaV1,
  run: Function,
  toolParameters?: ActionTool["parameters"],
): (args: any, ctx?: ActionRunContext) => any {
  return async (args: any, ctx?: ActionRunContext) => {
    if (preparedRunFor(ctx, args)?.schema === schema) return run(args, ctx);
    return run(await validateActionArgs(schema, args, toolParameters), ctx);
  };
}

function outputValidator(
  outputSchema: StandardSchemaV1,
  strategy: ActionOutputErrorStrategy,
  fallback: unknown,
  description: string | undefined,
): (
  output: unknown,
  call: { actionName?: string; effect: ActionOutputEffect },
) => Promise<unknown> {
  let semanticSchema: JsonSchemaObject | undefined;
  const contractSchema = () => {
    try {
      semanticSchema ??= outputSchemaToJsonSchema(outputSchema);
    } catch {
      // coercion-ok: without a JSON Schema nothing is known to be declared,
      // so every segment of an issue path is masked.
    }
    return semanticSchema;
  };
  return async (output, call) => {
    let result: StandardSchemaV1.Result<unknown>;
    try {
      result = await outputSchema["~standard"].validate(output);
    } catch (error) {
      // A connection request or stop from a transform is the action's own
      // signal, not a broken result, so it stops the call under every
      // strategy: the one way `"warn"` is not non-breaking. `run` already
      // returned, so it travels as the call's post-run failure.
      if (
        isAgentConnectionRequiredError(error) ||
        isAgentActionStopError(error)
      ) {
        throw postRunSignal(error, call);
      }
      // A refinement that throws has not judged the output, and its message
      // may repeat it.
      if (strategy === "strict") {
        throw new ActionOutputContractError({
          actionName: call.actionName,
          effect: call.effect,
          contract: "semantic",
          issues: ["(root): validator_threw"],
        });
      }
      if (strategy === "fallback") return fallback;
      const label = description ? ` (${description})` : "";
      console.warn(
        `Action outputSchema threw while validating the result${label}`,
        error,
      );
      return output;
    }

    if (!result.issues) {
      return (result as StandardSchemaV1.SuccessResult<any>).value;
    }

    if (strategy === "strict") {
      const schema = contractSchema();
      throw new ActionOutputContractError({
        actionName: call.actionName,
        effect: call.effect,
        contract: "semantic",
        issues: result.issues.map((issue) =>
          describeOutputContractIssue(
            (issue.path ?? []).map((p) => {
              const key = typeof p === "object" ? p.key : p;
              return typeof key === "number" ? key : String(key);
            }),
            (issue as { code?: unknown }).code,
            schema,
          ),
        ),
      });
    }
    if (strategy === "fallback") {
      return fallback;
    }
    const issues = result.issues
      .map((issue) => {
        const pathStr = issue.path
          ? issue.path.map((p) => (typeof p === "object" ? p.key : p)).join(".")
          : "";
        const msg = String(issue.message ?? "");
        return pathStr ? `${pathStr}: ${msg}` : msg;
      })
      .join("; ");
    const label = description ? ` (${description})` : "";
    console.warn(`Action output did not match outputSchema${label}: ${issues}`);
    return output;
  };
}
