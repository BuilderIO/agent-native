import type { StandardSchemaV1 } from "@standard-schema/spec";

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
import { wrapRunWithActionTracking } from "./tracking/action-lifecycle.js";

export type ActionCaller =
  | "tool"
  | "http"
  | "frontend"
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
  attachments?: AgentChatAttachment[];
  signal?: AbortSignal;
  actionName?: string;
  threadId?: string;
  runId?: string;
  turnId?: string;
  approvedToolCallKey?: string;
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
}

export class ActionContractError extends Error {
  readonly actionContractError = true;
  readonly errorCode: string;
  readonly details?: Record<string, unknown>;
  readonly statusCode: number;

  constructor(message: string, options: ActionContractErrorOptions) {
    super(message);
    this.name = "ActionContractError";
    this.errorCode = options.errorCode;
    this.details = options.details;
    this.statusCode = options.statusCode ?? 409;
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

export interface FailOptions {
  errorCode?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export function fail(message: string, options: FailOptions = {}): never {
  throw new ActionContractError(message, {
    errorCode: options.errorCode ?? "action_failed",
    statusCode: options.statusCode ?? 400,
    ...(options.details === undefined ? {} : { details: options.details }),
  });
}

export class AgentActionStopError extends Error {
  readonly agentNativeStop = true;
  readonly errorCode?: string;
  readonly details?: Record<string, unknown>;
  readonly toolResult?: string;

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
  deferLoading?: boolean;
  readOnly?: boolean;
  grounding?: boolean;
  allowInPlanMode?: boolean;
  planMode?: ActionPlanModeConfig<StandardSchemaV1.InferInput<TSchema>>;
  parallelSafe?: boolean;
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
  deferLoading?: boolean;
  readOnly?: boolean;
  grounding?: boolean;
  allowInPlanMode?: boolean;
  planMode?: ActionPlanModeConfig<InferParams<TParams>>;
  parallelSafe?: boolean;
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
  readonly deferLoading?: boolean;
  readonly readOnly?: boolean;
  readonly grounding?: boolean;
  readonly allowInPlanMode?: boolean;
  readonly planMode?: ActionPlanModeConfig<TInput>;
  readonly parallelSafe?: boolean;
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

  let toolParameters: ActionTool["parameters"];
  if (hasSchema) {
    toolParameters = schemaToJsonSchema(options.schema, options.description);
  } else if (options.parameters) {
    toolParameters = {
      type: "object" as const,
      properties: options.parameters,
    };
  }

  if (
    hasSchema &&
    options.agentInputSchema &&
    "~standard" in options.agentInputSchema
  ) {
    toolParameters = schemaToJsonSchema(
      options.agentInputSchema,
      options.description,
    );
  }

  const guardedRun =
    typeof options.authorize === "function" || options.access
      ? wrapRunWithAccess(options.run, options.access, options.authorize)
      : options.run;
  const uiOnlyGuardedRun =
    options.uiOnly === true
      ? async (args: any, ctx?: ActionRunContext) => {
          if (ctx?.caller !== "frontend") {
            fail("This action can only be called from the signed-in app UI.", {
              errorCode: "ui_only_action",
              statusCode: 403,
            });
          }
          return guardedRun(args, ctx);
        }
      : guardedRun;

  const inputValidatedRun = hasSchema
    ? wrapWithValidation(options.schema, uiOnlyGuardedRun, toolParameters)
    : uiOnlyGuardedRun;

  const hasOutputSchema =
    options.outputSchema && "~standard" in options.outputSchema;
  const outputErrorStrategy: ActionOutputErrorStrategy =
    options.outputErrorStrategy === "strict" ||
    options.outputErrorStrategy === "warn" ||
    options.outputErrorStrategy === "fallback"
      ? options.outputErrorStrategy
      : "warn";
  const run = hasOutputSchema
    ? wrapWithOutputValidation(
        options.outputSchema,
        inputValidatedRun,
        outputErrorStrategy,
        options.outputFallback,
        options.description,
      )
    : inputValidatedRun;

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
  const uiOnly: boolean | undefined =
    typeof options.uiOnly === "boolean" ? options.uiOnly : undefined;

  const auditConfig = normalizeAuditConfig(options.audit);
  const finalRun = resolveAuditAttach(auditConfig, readOnly)
    ? wrapRunWithAudit(run, auditConfig)
    : run;
  const trackedRun = wrapRunWithActionTracking(finalRun, readOnly);

  const toolCallable: boolean | undefined =
    typeof options.toolCallable === "boolean"
      ? options.toolCallable
      : undefined;
  const agentTool: boolean | undefined =
    typeof options.agentTool === "boolean" ? options.agentTool : undefined;
  const mcpTool: boolean | undefined =
    typeof options.mcpTool === "boolean" ? options.mcpTool : undefined;
  const deferLoading: boolean | undefined =
    typeof options.deferLoading === "boolean"
      ? options.deferLoading
      : undefined;
  const parallelSafe: boolean | undefined =
    typeof options.parallelSafe === "boolean"
      ? options.parallelSafe
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

  return {
    tool: {
      ...(typeof options.title === "string" && options.title.trim()
        ? { title: options.title.trim() }
        : {}),
      description: options.description,
      parameters: toolParameters,
    },
    run: trackedRun,
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
    ...(typeof parallelSafe === "boolean" ? { parallelSafe } : {}),
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
): (args: any, ctx?: ActionRunContext) => Promise<any> {
  return async function accessCheckedRun(args: any, ctx?: ActionRunContext) {
    if (access) {
      await assertRegisteredActionAccess(access, args, ctx);
    }
    if (authorize) {
      const verdict = await authorize(args, ctx);
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

function wrapRunWithAudit(
  run: (args: any, ctx?: ActionRunContext) => any,
  auditConfig: ActionAuditConfig | undefined,
): (args: any, ctx?: ActionRunContext) => Promise<any> {
  return async function auditedRun(args: any, ctx?: ActionRunContext) {
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
          ? { config: auditConfig, args, ctx, status: "error", error }
          : { config: auditConfig, args, ctx, status: "success", result },
      );
    } catch {
      // Recorder failed to load/run — never affect the action.
    }
    if (threw) throw error;
    return result;
  };
}

const SUBSCHEMA_VALUE_KEYS = [
  "items",
  "additionalItems",
  "contains",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
] as const;
const SUBSCHEMA_ARRAY_KEYS = [
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
] as const;
const SUBSCHEMA_MAP_KEYS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
] as const;

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
 * was never flagged while the typeless sibling next to it was. `true` for
 * `additionalProperties` is a boolean, not a subschema, so it needs no type of
 * its own; array items get one bounded level rather than recursing forever.
 */
const JSON_VALUE_BRANCHES: ReadonlyArray<Record<string, unknown>> = [
  { type: "string" },
  { type: "number" },
  { type: "boolean" },
  { type: "null" },
  { type: "object", additionalProperties: true },
  {
    type: "array",
    items: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        { type: "object", additionalProperties: true },
      ],
    },
  },
];

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
  "patternProperties",
  "dependentSchemas",
  "dependentRequired",
  "if",
  "then",
  "else",
  "not",
] as const;

export function stripUnsupportedSchemaKeywords<T>(node: T): T {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const obj = node as Record<string, unknown>;

  for (const keyword of PROVIDER_REJECTED_KEYWORDS) delete obj[keyword];
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

  for (const key of SUBSCHEMA_VALUE_KEYS) {
    const value = obj[key];
    if (Array.isArray(value)) {
      for (const sub of value) stripUnsupportedSchemaKeywords(sub);
    } else {
      stripUnsupportedSchemaKeywords(value);
    }
  }
  for (const key of SUBSCHEMA_ARRAY_KEYS) {
    const value = obj[key];
    if (Array.isArray(value)) {
      for (const sub of value) stripUnsupportedSchemaKeywords(sub);
    }
  }
  for (const key of SUBSCHEMA_MAP_KEYS) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const sub of Object.values(value)) {
        stripUnsupportedSchemaKeywords(sub);
      }
    }
  }
  if (Array.isArray(obj.oneOf)) {
    const existing = Array.isArray(obj.anyOf) ? obj.anyOf : [];
    obj.anyOf = [...existing, ...obj.oneOf];
    delete obj.oneOf;
  }
  if (!TYPE_SUBSTITUTE_KEYS.some((key) => obj[key] !== undefined)) {
    obj.anyOf = JSON_VALUE_BRANCHES.map((branch) => ({ ...branch }));
  }
  return node;
}

function schemaToJsonSchema(
  schema: StandardSchemaV1,
  _description?: string,
): ActionTool["parameters"] {
  const s = schema as any;

  if (s["~standard"]?.jsonSchema?.input) {
    try {
      const result = s["~standard"].jsonSchema.input({
        target: "draft-07",
      }) as any;
      if (result && typeof result === "object") {
        delete result.$schema;
      }
      return stripUnsupportedSchemaKeywords(result) as ActionTool["parameters"];
    } catch {
      // Fall through to manual converter
    }
  }

  if (s._zod?.def) {
    return stripUnsupportedSchemaKeywords(zodDefToJsonSchema(s._zod.def));
  }

  return { type: "object" as const, properties: {} };
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

const NO_COERCE = Symbol("no-coerce");

function coerceStringToSchemaType(raw: string, types: string[]): unknown {
  const trimmed = raw.trim();
  if (types.includes("boolean")) {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
  }
  if (
    (types.includes("array") &&
      trimmed.startsWith("[") &&
      trimmed.endsWith("]")) ||
    (types.includes("object") &&
      trimmed.startsWith("{") &&
      trimmed.endsWith("}"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (types.includes("array") && Array.isArray(parsed)) return parsed;
      if (
        types.includes("object") &&
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch {
      // fall through — leave the original so validation reports the real error
    }
  }
  if (
    (types.includes("number") || types.includes("integer")) &&
    trimmed !== "" &&
    Number.isFinite(Number(trimmed))
  ) {
    const n = Number(trimmed);
    if (types.includes("number") || Number.isInteger(n)) return n;
  }
  return NO_COERCE;
}

function coerceGatewayStringifiedArgs(
  args: unknown,
  parameters?: ActionTool["parameters"],
): unknown {
  const properties = parameters?.properties as
    | Record<string, { type?: string | string[] }>
    | undefined;
  if (!properties) return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  let out: Record<string, unknown> | null = null;
  for (const [key, raw] of Object.entries(args as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const spec = properties[key];
    if (!spec) continue;
    const types = Array.isArray(spec.type)
      ? spec.type
      : spec.type
        ? [spec.type]
        : [];
    if (types.length === 0 || types.includes("string")) continue;
    const coerced = coerceStringToSchemaType(raw, types);
    if (coerced === NO_COERCE) continue;
    if (!out) out = { ...(args as Record<string, unknown>) };
    out[key] = coerced;
  }
  return out ?? args;
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

const preValidatedForContext = new WeakMap<
  object,
  { schema: StandardSchemaV1; value: unknown }
>();

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

    throw new Error(
      `Invalid action parameters — ${parts.join(". ")}. Received: ${received}.${expected}`,
    );
  }
  const value = (result as StandardSchemaV1.SuccessResult<any>).value;
  if (ctx) preValidatedForContext.set(ctx, { schema, value });
  return value;
}

function wrapWithValidation(
  schema: StandardSchemaV1,
  run: Function,
  toolParameters?: ActionTool["parameters"],
): (args: any, ctx?: ActionRunContext) => any {
  return async (args: any, ctx?: ActionRunContext) => {
    const cached =
      ctx && typeof ctx === "object"
        ? preValidatedForContext.get(ctx)
        : undefined;
    if (cached && cached.schema === schema && Object.is(cached.value, args)) {
      return run(args, ctx);
    }
    return run(await validateActionArgs(schema, args, toolParameters), ctx);
  };
}

function wrapWithOutputValidation(
  outputSchema: StandardSchemaV1,
  run: (args: any, ctx?: ActionRunContext) => any,
  strategy: ActionOutputErrorStrategy,
  fallback: unknown,
  description?: string,
): (args: any, ctx?: ActionRunContext) => any {
  return async (args: any, ctx?: ActionRunContext) => {
    const output = await run(args, ctx);
    const result = await outputSchema["~standard"].validate(output);

    if (!result.issues) {
      return (result as StandardSchemaV1.SuccessResult<any>).value;
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
    const summary = `Action output did not match outputSchema${label}: ${issues}`;

    if (strategy === "strict") {
      throw new Error(summary);
    }
    if (strategy === "fallback") {
      return fallback;
    }
    console.warn(summary);
    return output;
  };
}
