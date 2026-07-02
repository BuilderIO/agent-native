import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  normalizeActionChatUIConfig,
  type ActionChatUIConfig,
} from "./action-ui.js";
import type {
  ActionTool,
  AgentChatAttachment,
  AgentChatEvent,
} from "./agent/types.js";
import { normalizeAuditConfig, resolveAuditAttach } from "./audit/config.js";
import type { ActionAuditConfig } from "./audit/types.js";

/**
 * How an action's `run` was invoked. Tagged at each dispatch site so the action
 * (and tracking) can branch on the surface that called it.
 *
 * - `"tool"` — the in-app agent loop, sub-agents/agent-teams, or A2A (which
 *   drives the same agent loop). All agent tool calls are `"tool"`.
 * - `"http"` — a programmatic HTTP POST/GET to `/_agent-native/actions/<name>`
 *   without the frontend request marker.
 * - `"frontend"` — a browser call via `useActionQuery` / `useActionMutation` /
 *   `callAction` (tagged with the `X-Request-Source` header).
 * - `"cli"` — `pnpm action <name>` (the CLI runner).
 * - `"mcp"` — an external agent over the MCP `tools/call` endpoint.
 * - `"a2a"` — a direct A2A action dispatch (currently unused: A2A runs through
 *   the agent loop, so those calls are `"tool"`). Reserved for completeness.
 */
export type ActionCaller = "tool" | "http" | "frontend" | "cli" | "mcp" | "a2a";

/**
 * Context passed as the optional second argument to an action's `run`.
 * Carries the resolved request identity and the invocation source so actions
 * can read `ctx.userEmail` / `ctx.orgId` / `ctx.caller` directly instead of
 * calling `getRequestUserEmail()` / `getRequestOrgId()` by hand.
 *
 * Backward compatible: existing 1-arg `run(args)` functions keep working, and
 * callers that only need `send` (the agent loop) can still destructure it.
 */
export interface ActionRunContext {
  /**
   * Emit an SSE event to the client. Only meaningful inside the agent tool
   * loop (e.g. `agent_call_text` streaming); `undefined` on every other
   * surface.
   */
  send?: (event: AgentChatEvent) => void;
  /**
   * Resolved request user email, or `undefined` when there is no authenticated
   * identity. NEVER defaulted to a dev identity — actions that need a fallback
   * must apply their own.
   */
  userEmail?: string;
  /** Resolved org id, or `null` when the request has no org. */
  orgId?: string | null;
  /** How this action was invoked. */
  caller: ActionCaller;
  /**
   * Attachments submitted with the current agent turn (pasted text blocks,
   * uploaded files, images), exactly as the server received them — with full,
   * untruncated `text` for text attachments. Populated only inside the agent
   * tool loop (`caller: "tool"`); `undefined` on every other surface.
   *
   * Lets an action consume a large pasted artifact BY REFERENCE (e.g.
   * `create-extension`'s `contentFromAttachment`) instead of forcing the model
   * to re-emit the whole file as a tool argument — which frequently gets cut
   * off mid-stream and triggers a continuation loop.
   */
  attachments?: AgentChatAttachment[];
  /**
   * Abort signal for the current agent run. Fires when the run is soft-timed
   * out, user-cancelled, or the server is shutting down. Well-behaved actions
   * can observe this signal to cancel in-flight work early instead of waiting
   * for the per-tool 60-second hard timeout.
   *
   * Populated only inside the agent tool loop (`caller: "tool"`); `undefined`
   * on every other surface. Never throws — checking `signal.aborted` or
   * attaching an `"abort"` listener is always safe.
   */
  signal?: AbortSignal;
  /**
   * Name of the action being invoked (the registry key, e.g.
   * `delete-recording`). Set at each dispatch site so cross-cutting concerns —
   * notably the audit log — can attribute the call. `undefined` for direct
   * programmatic `run()` calls that bypass the dispatcher.
   */
  actionName?: string;
  /**
   * Agent conversation thread + turn that triggered this call, populated only
   * inside the agent tool loop (`caller: "tool"`). Lets the audit log link a
   * mutation to the specific agent run/turn that caused it. `undefined` on
   * every human/programmatic surface.
   */
  threadId?: string;
  turnId?: string;
}

export interface AgentActionStopOptions {
  /** Optional stable code surfaced in run metadata and tests. */
  errorCode?: string;
  /** Optional short tool-result text. Defaults to the user-facing message. */
  toolResult?: string;
}

/**
 * Throw from an action when the agent should stop the current turn instead of
 * feeding the failure back to the model for another retry.
 */
export class AgentActionStopError extends Error {
  readonly agentNativeStop = true;
  readonly errorCode?: string;
  readonly toolResult?: string;

  constructor(message: string, options: AgentActionStopOptions = {}) {
    super(message);
    this.name = "AgentActionStopError";
    this.errorCode = options.errorCode;
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

/** HTTP exposure config for an action. */
export interface ActionHttpConfig {
  /** HTTP method. Default: "POST". Use "GET" for read-only actions. */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Override route path under /_agent-native/actions/. Default: action filename. */
  path?: string;
}

/** Explicit opt-in metadata for public agent protocols such as MCP or A2A. */
export interface PublicAgentActionConfig {
  expose: boolean;
  readOnly: boolean;
  requiresAuth?: boolean;
  isConsequential?: boolean;
  title?: string;
  description?: string;
}

/** A deep link an external agent (MCP / A2A) can surface to the user so they
 *  can open the produced/listed resource in the running app UI. */
export interface ActionDeepLink {
  /** App-relative path (e.g. `/_agent-native/open?app=mail&view=inbox&...`)
   *  or an absolute URL. The MCP layer prefixes the request origin when this
   *  is relative, and may rewrite it to the `agentnative://` desktop scheme. */
  url: string;
  /** Human-readable label, e.g. "Open draft in Mail". */
  label: string;
  /** Optional view hint (matches the `navigate` command `view`). */
  view?: string;
}

/** Builds a deep link from an action's args + result so external agents can
 *  surface an "Open in <app> →" link. MUST be pure and synchronous — no I/O,
 *  no awaits. Best-effort: a throw or null is swallowed and never fails the
 *  tool call. See the `external-agents` skill. */
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
  /**
   * Host-specific sandbox domain hint. Do not set this to the app's normal
   * production URL; app origins belong in CSP/open-link metadata. ChatGPT uses
   * the separate `openai/widgetDomain` compatibility field.
   */
  domain?: string;
  prefersBorder?: boolean;
}

export type ActionMcpAppHtmlBuilder = (ctx: {
  actionName: string;
  appId?: string;
  requestOrigin?: string;
}) => string;

export interface ActionMcpAppResourceConfig {
  /** `ui://` URI. Defaults to `ui://<app>/<action-name>`. */
  uri?: string;
  /** MCP resource name. Defaults to the action name. */
  name?: string;
  title?: string;
  description?: string;
  /**
   * HTML5 document content for the MCP App resource. Keep this self-contained
   * or declare any external origins in `csp`.
   */
  html: string | ActionMcpAppHtmlBuilder;
  /** Defaults to the MCP Apps HTML MIME type. */
  mimeType?: typeof MCP_APP_MIME_TYPE;
  /** Extra resource/content metadata. `ui` is merged with the fields below. */
  _meta?: Record<string, unknown>;
  csp?: ActionMcpAppCsp | ActionMcpAppCspBuilder;
  permissions?: ActionMcpAppPermissions;
  /**
   * Host-specific sandbox domain hint. Do not set this to the app's normal
   * production URL; app origins belong in CSP/open-link metadata. ChatGPT uses
   * the separate `openai/widgetDomain` compatibility field.
   */
  domain?: string;
  prefersBorder?: boolean;
}

export interface ActionMcpAppConfig {
  /**
   * Optional MCP Apps UI resource for hosts that render inline app iframes.
   * Required when the action should open an interactive app view. Omit when
   * you only need `compactCatalog: true` to keep a non-UI action visible in
   * the compact catalog (e.g. read/update actions that should be callable from
   * Claude.ai / ChatGPT without a dedicated iframe resource).
   */
  resource?: ActionMcpAppResourceConfig;
  /**
   * MCP Apps tool visibility. Defaults to model + app so the LLM can call the
   * action and the app iframe can call it back through the host bridge.
   */
  visibility?: Array<"model" | "app">;
  /**
   * Rare escape hatch for MCP Apps chat hosts. By default OAuth callers with
   * `mcp:apps` see the generic app tools (`open_app`, `list_apps`, etc.) so
   * hosts do not ingest every action-specific UI resource. Set this only when
   * this specific action must stay visible in that compact catalog.
   */
  compactCatalog?: boolean;
}

/** Schema definition for a single action parameter (legacy JSON schema style). */
export interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
}

/** Infer runtime parameter types from a legacy parameter schema map. */
type InferParams<T extends Record<string, ParameterSchema> | undefined> =
  T extends Record<string, ParameterSchema>
    ? { [K in keyof T]?: string }
    : Record<string, string>;

/**
 * What to do when an action's RETURN value fails `outputSchema` validation.
 *
 * - `"strict"` — throw a clear error so a buggy action surfaces loudly.
 * - `"warn"` (default) — `console.warn` the issues and return the ORIGINAL
 *   result unchanged. Non-breaking: behavior never changes unless the dev
 *   opts into `"strict"` or `"fallback"`.
 * - `"fallback"` — return `outputFallback` in place of the invalid result.
 *
 * Mirrors Mastra/Flue structured-output handling, kept on the action layer.
 */
export type ActionOutputErrorStrategy = "strict" | "warn" | "fallback";

// ---------------------------------------------------------------------------
// Schema-based action options (new: Zod / Valibot / ArkType via Standard Schema)
// ---------------------------------------------------------------------------

interface DefineActionWithSchema<
  TSchema extends StandardSchemaV1,
  TReturn = any,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  description: string;
  /** Standard Schema-compatible schema (Zod, Valibot, ArkType). Provides runtime
   *  validation and full TypeScript type inference for `run()` args. The schema is
   *  also converted to JSON Schema for the Claude API tool definition. */
  schema: TSchema;
  /** Legacy parameters — ignored when `schema` is provided. */
  parameters?: never;
  /** Optional Standard Schema-compatible schema (Zod, Valibot, ArkType) the
   *  action's RETURN value is validated against AFTER `run()` resolves. Borrowed
   *  from Mastra/Flue structured-output. When omitted, behavior is byte-for-byte
   *  unchanged. The mismatch handling is governed by `outputErrorStrategy`. */
  outputSchema?: TOutputSchema;
  /** What to do when the result fails `outputSchema`. Default: `"warn"`. */
  outputErrorStrategy?: ActionOutputErrorStrategy;
  /** Value returned in place of an invalid result when `outputErrorStrategy` is
   *  `"fallback"`. Ignored for the other strategies. */
  outputFallback?: TReturn;
  run: (
    args: StandardSchemaV1.InferOutput<TSchema>,
    ctx?: ActionRunContext,
  ) => Promise<TReturn> | TReturn;
  http?: ActionHttpConfig | false;
  /** Whether the HTTP/frontend action route must have an authenticated owner.
   *  Defaults to true. Set to false only for metadata/read actions that safely
   *  handle `ctx.userEmail` / `getRequestUserEmail()` being undefined. */
  requiresAuth?: boolean;
  /** Max HTTP request body in bytes. When set, the route 413s on the declared
   *  `Content-Length` before parsing. Use for public, no-auth POST actions;
   *  unset = no route-level cap. */
  maxBodyBytes?: number;
  /** Whether this action is exposed to the agent — the in-app assistant and the
   *  app's MCP/A2A tool surfaces — as a callable tool. **Default-allow opt-out**:
   *  `undefined` / `true` expose it; only an explicit `false` hides it from every
   *  agent tool list while keeping it callable from the frontend / HTTP
   *  (`useActionMutation`, `callAction`, `/_agent-native/actions/<name>`). Use
   *  this for UI-only or purely programmatic actions you want behind the
   *  framework's auth + action surface WITHOUT spending a slot in the model's
   *  tool list. Distinct from `toolCallable`, which only governs the sandboxed
   *  extension ("tools") iframe bridge. See `packages/core/docs/content/actions.mdx`. */
  agentTool?: boolean;
  /** If true, the framework will NOT emit a screen-refresh change event after a
   *  successful call. Auto-inferred as `true` when `http.method === "GET"`.
   *  Only set this manually when you need to override the inference — e.g. a
   *  POST action that only reads data but can't use GET for a protocol reason. */
  readOnly?: boolean;
  /** If true, the agent may execute this action concurrently with other
   *  read-only or parallel-safe tool calls emitted in the same model turn.
   *  Only set this for mutating actions that are internally concurrency-safe
   *  and order-independent for same-turn execution. */
  parallelSafe?: boolean;
  /** Whether this action may be invoked from the tools (Alpine iframe) bridge
   *  via `appAction(name, params)` — see `packages/core/docs/content/actions.mdx`
   *  ("Tools Callability"). **Default-allow opt-out**: undefined / `true` both
   *  allow tool-iframe calls; only an explicit `false` returns 403. Set to
   *  `false` for high-blast-radius admin operations (account deletion, org
   *  membership changes, anything that modifies auth state) — used by the
   *  framework's `share-resource`, `unshare-resource`, and
   *  `set-resource-visibility` for defense-in-depth. Regular UI/agent/CLI/MCP/A2A
   *  calls are unaffected. Enforced by the action HTTP route layer — see
   *  `packages/core/src/server/action-routes.ts`. Audit reference: H5 in
   *  `security-audit/05-tools-sandbox.md`. */
  toolCallable?: boolean;
  /** Explicit public-agent exposure metadata. Public web routes never imply
   *  public MCP/A2A/OpenAPI tool exposure. Actions must opt in here and public
   *  protocol mounts must still filter for safe, route-appropriate tools. */
  publicAgent?: PublicAgentActionConfig;
  /** Optional deep-link builder. When set, MCP/A2A surfaces append an
   *  "Open in <app> →" link built from the call's args + result so the
   *  external agent can drop the user into the running app at the right
   *  view/record. Pure + sync + best-effort. See the `external-agents` skill. */
  link?: ActionLinkBuilder;
  /** Optional MCP Apps UI resource for hosts that can render inline
   *  interactive app iframes. Text/deep-link tool results remain the fallback
   *  for CLI and non-UI hosts. */
  mcpApp?: ActionMcpAppConfig;
  /** Optional native Agent-Native chat renderer for this action's structured
   *  result. This is first-party React UI, not arbitrary HTML/JS. */
  chatUI?: ActionChatUIConfig;
  /**
   * Per-tool timeout override in milliseconds for agent-loop tool calls. Use
   * sparingly for actions that legitimately wait on slow provider work.
   */
  timeoutMs?: number;
  /** Per-tool result truncation override for agent-loop tool calls. */
  maxResultChars?: number;
  /**
   * Opt-in human-in-the-loop approval gate. **Default off** — the framework
   * intentionally keeps HITL approvals rare; almost every action should run
   * without one. Set this only for high-consequence, outward-facing,
   * hard-to-undo operations (the canonical example is actually sending an
   * email). When `needsApproval` resolves truthy and the agent calls this
   * action, the loop does NOT execute `run()`: it emits an `approval_required`
   * event and stops the turn, waiting for a human to approve. The action runs
   * only once the human re-issues the turn approving this specific call.
   *
   * - `true` — always require approval.
   * - `(args, ctx) => boolean | Promise<boolean>` — require approval only when
   *   the predicate returns true (e.g. only for external recipients, only
   *   above a dollar threshold). Keep it pure + fast; thrown errors are treated
   *   as "approval required" (fail closed).
   */
  needsApproval?:
    | boolean
    | ((
        args: StandardSchemaV1.InferOutput<TSchema>,
        ctx?: ActionRunContext,
      ) => boolean | Promise<boolean>);
  /**
   * Audit-log configuration. **Default-on for mutating actions** — you only
   * need this to tune capture: declare the mutated `target` (so the change
   * shows up in the owner's audit trail) and/or a `summary`, opt a read-only
   * action in via `onRead`, or opt a noisy action out via `enabled: false`.
   * See the `audit-log` skill.
   */
  audit?: ActionAuditConfig;
}

// ---------------------------------------------------------------------------
// Legacy parameter-based action options
// ---------------------------------------------------------------------------

interface DefineActionWithParams<
  TParams extends Record<string, ParameterSchema> | undefined =
    | Record<string, ParameterSchema>
    | undefined,
  TReturn = any,
> {
  description: string;
  /** Flat map of parameter names to their schema. Automatically wrapped in
   *  `{ type: "object", properties: ... }` for the Claude API. */
  parameters?: TParams;
  /** Standard Schema — not used in this overload. */
  schema?: never;
  /** Optional Standard Schema-compatible schema the action's RETURN value is
   *  validated against AFTER `run()` resolves. See the schema overload above.
   *  When omitted, behavior is byte-for-byte unchanged. */
  outputSchema?: StandardSchemaV1;
  /** What to do when the result fails `outputSchema`. Default: `"warn"`. */
  outputErrorStrategy?: ActionOutputErrorStrategy;
  /** Value returned in place of an invalid result when `outputErrorStrategy` is
   *  `"fallback"`. Ignored for the other strategies. */
  outputFallback?: TReturn;
  run: (
    args: InferParams<TParams>,
    ctx?: ActionRunContext,
  ) => Promise<TReturn> | TReturn;
  http?: ActionHttpConfig | false;
  /** Whether the HTTP/frontend action route must have an authenticated owner.
   *  Defaults to true. See the schema overload above. */
  requiresAuth?: boolean;
  /** Max HTTP request body in bytes; 413s on `Content-Length` before parsing.
   *  See the schema overload above. */
  maxBodyBytes?: number;
  /** Whether this action is exposed to the agent as a callable tool. Only an
   *  explicit `false` hides it from every agent tool list while keeping it
   *  frontend/HTTP-callable. See the schema overload above and actions.md. */
  agentTool?: boolean;
  /** If true, the framework will NOT emit a screen-refresh change event after a
   *  successful call. Auto-inferred as `true` when `http.method === "GET"`. */
  readOnly?: boolean;
  /** If true, the agent may execute this action concurrently with other
   *  read-only or parallel-safe tool calls emitted in the same model turn. */
  parallelSafe?: boolean;
  /** Whether this action may be invoked from the tools (Alpine iframe) bridge
   *  via `appAction(name, params)`. See the schema overload above for details
   *  and the `toolCallable` section in actions.md. */
  toolCallable?: boolean;
  /** Explicit public-agent exposure metadata. See schema overload above. */
  publicAgent?: PublicAgentActionConfig;
  /** Optional deep-link builder. See schema overload above. */
  link?: ActionLinkBuilder;
  /** Optional MCP Apps UI resource. See schema overload above. */
  mcpApp?: ActionMcpAppConfig;
  /** Optional native Agent-Native chat renderer. See schema overload above. */
  chatUI?: ActionChatUIConfig;
  /** Per-tool timeout override in milliseconds. See schema overload above. */
  timeoutMs?: number;
  /** Per-tool result truncation override. See schema overload above. */
  maxResultChars?: number;
  /** Opt-in human-in-the-loop approval gate (default off). See the schema
   *  overload above for full semantics. */
  needsApproval?:
    | boolean
    | ((
        args: InferParams<TParams>,
        ctx?: ActionRunContext,
      ) => boolean | Promise<boolean>);
  /** Audit-log configuration (default-on for mutations). See the schema
   *  overload above and the `audit-log` skill. */
  audit?: ActionAuditConfig;
}

// ---------------------------------------------------------------------------
// Return type — carries schema-inferred input + run return for client inference
// ---------------------------------------------------------------------------

/**
 * Opaque typed wrapper returned by `defineAction`. The type parameters carry
 * the schema-inferred input and the `run` return type so that:
 *
 * - The generated `.generated/action-types.d.ts` can extract them via
 *   `typeof import("../actions/my-action").default.run` and augment
 *   `ActionRegistry` with concrete param/result types.
 * - `useActionQuery` / `useActionMutation` / `callAction` in the client hooks
 *   flow the correct types end-to-end without manual generic annotations.
 *
 * Runtime shape is unchanged — this is a declaration-only wrapper.
 */
export interface ActionDefinition<TInput, TReturn> {
  /**
   * Typed run function — declaration only; infer input/return from this.
   * `TInput` is the schema's input type (optional defaults allowed at call
   * sites); `TReturn` is the awaited result type of the run callback.
   */
  readonly run: (
    args: TInput,
    ctx?: ActionRunContext,
  ) => Promise<TReturn> | TReturn;
  /** @internal Framework use only — do not call directly. */
  readonly tool: import("./agent/types.js").ActionTool;
  readonly http?: ActionHttpConfig | false;
  readonly requiresAuth?: boolean;
  readonly maxBodyBytes?: number;
  readonly agentTool?: boolean;
  readonly readOnly?: boolean;
  readonly parallelSafe?: boolean;
  readonly toolCallable?: boolean;
  readonly publicAgent?: PublicAgentActionConfig;
  readonly link?: ActionLinkBuilder;
  readonly mcpApp?: ActionMcpAppConfig;
  readonly chatUI?: ActionChatUIConfig;
  /** Per-tool timeout override in milliseconds for agent-loop tool calls. */
  readonly timeoutMs?: number;
  /** Per-tool result truncation override for agent-loop tool calls. */
  readonly maxResultChars?: number;
  /** Standard Schema the action's RETURN value is validated against after
   *  `run()` resolves. Present only when the caller passed `outputSchema`. */
  readonly outputSchema?: StandardSchemaV1;
  /** Resolved output-mismatch strategy. Present only when `outputSchema` is
   *  set; defaults to `"warn"`. */
  readonly outputErrorStrategy?: ActionOutputErrorStrategy;
  /** Value substituted for an invalid result under the `"fallback"` strategy. */
  readonly outputFallback?: TReturn;
  /** Opt-in human-in-the-loop approval gate (default off). When truthy, the
   *  agent loop emits `approval_required` and pauses instead of executing this
   *  action until a human approves the specific call. */
  readonly needsApproval?:
    | boolean
    | ((args: TInput, ctx?: ActionRunContext) => boolean | Promise<boolean>);
  /** Resolved audit-log configuration. Present only when the caller passed
   *  `audit`. The audit capture wrapper is baked into `run`; this field is for
   *  introspection. */
  readonly audit?: ActionAuditConfig;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Define an agent action. Place in `actions/` directory — auto-discovered by the framework.
 *
 * Supports two modes:
 *
 * **Schema mode (recommended)** — pass a Standard Schema-compatible schema (Zod, Valibot,
 * ArkType) for runtime validation and full type inference:
 *
 * ```ts
 * import { defineAction } from "@agent-native/core";
 * import { z } from "zod";
 *
 * export default defineAction({
 *   description: "Create a form",
 *   schema: z.object({
 *     title: z.string().describe("Form title"),
 *     status: z.enum(["draft", "published", "closed"]).default("draft"),
 *   }),
 *   run: async (args) => {
 *     // args is { title: string; status: "draft" | "published" | "closed" }
 *     // Already validated — invalid inputs never reach here
 *   },
 * });
 * ```
 *
 * **Parameters mode (legacy)** — pass raw JSON schema-like parameter definitions:
 *
 * ```ts
 * export default defineAction({
 *   description: "List events",
 *   parameters: {
 *     from: { type: "string", description: "Start date" },
 *   },
 *   run: async (args) => { ... },
 * });
 * ```
 */
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

  // Build tool definition for the Claude API
  let toolParameters: ActionTool["parameters"];
  if (hasSchema) {
    // Convert Standard Schema to JSON Schema for Claude
    toolParameters = schemaToJsonSchema(options.schema, options.description);
  } else if (options.parameters) {
    toolParameters = {
      type: "object" as const,
      properties: options.parameters,
    };
  }

  // Wrap run() with INPUT validation when schema is provided.
  // Pass toolParameters so the validation error can echo the expected signature
  // (required vs optional fields) and help the caller self-correct.
  const inputValidatedRun = hasSchema
    ? wrapWithValidation(options.schema, options.run, toolParameters)
    : options.run;

  // Then wrap with OUTPUT validation when an outputSchema is provided. This
  // composes AROUND the input-validated run so the order is: validate input →
  // run() → validate output. When no outputSchema is present, the run is passed
  // through untouched and behavior is byte-for-byte unchanged.
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

  // Auto-infer readOnly from http.method === "GET" unless explicitly set.
  // GET actions are idempotent reads; their completion should NOT trigger a
  // screen refresh. Everything else is assumed to mutate — the dispatcher
  // emits a change event on success so the UI auto-refetches its queries.
  const httpConfig = options.http as ActionHttpConfig | false | undefined;
  const inferredReadOnly =
    httpConfig !== false &&
    httpConfig !== undefined &&
    httpConfig.method === "GET";
  // Explicit `readOnly` (true OR false) wins. Otherwise infer from http.method.
  // We store the resolved boolean so downstream checks can trust entry.readOnly
  // without re-running method inference — including when a caller explicitly
  // passes readOnly:false to override a GET (rare but valid).
  const readOnly: boolean | undefined =
    typeof options.readOnly === "boolean"
      ? options.readOnly
      : inferredReadOnly
        ? true
        : undefined;

  // Audit: wrap the validated run so every mutating call records an audit
  // event (who/what/when/from-where, and for the agent which run). Default-on
  // for mutations; read-only actions opt in via `audit.onRead`. The wrapper
  // lazily imports the DB-touching recorder so `action.ts` keeps no static DB
  // dependency.
  const auditConfig = normalizeAuditConfig(options.audit);
  const finalRun = resolveAuditAttach(auditConfig, readOnly)
    ? wrapRunWithAudit(run, auditConfig)
    : run;

  // toolCallable: thread through whatever the caller declared. We DO NOT
  // default to `true` here — the absence of an explicit field is meaningful
  // to the tools bridge: it lets us emit a one-shot warning when an action
  // without a declared `toolCallable` flag is invoked from a tool, so the
  // ecosystem can migrate over time. The bridge treats `undefined` as
  // "implicit allow with a deprecation warning"; only an explicit `false`
  // refuses the call. See `extensions/routes.ts` and audit H5.
  const toolCallable: boolean | undefined =
    typeof options.toolCallable === "boolean"
      ? options.toolCallable
      : undefined;
  // agentTool: default-allow opt-out. Only an explicit `false` hides the action
  // from the agent tool surfaces; undefined is preserved (treated as exposed).
  const agentTool: boolean | undefined =
    typeof options.agentTool === "boolean" ? options.agentTool : undefined;
  const parallelSafe: boolean | undefined =
    typeof options.parallelSafe === "boolean"
      ? options.parallelSafe
      : undefined;
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
    // compactCatalog-only: no resource required; just keep the flag.
    if (options.mcpApp.compactCatalog === true && !options.mcpApp.resource) {
      return options.mcpApp as ActionMcpAppConfig;
    }
    // Full resource: validate html is present.
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
      description: options.description,
      parameters: toolParameters,
    },
    run: finalRun,
    ...(hasSchema ? { schema: options.schema } : {}),
    ...(options.http !== undefined ? { http: options.http } : {}),
    ...(typeof options.requiresAuth === "boolean"
      ? { requiresAuth: options.requiresAuth }
      : {}),
    ...(typeof options.maxBodyBytes === "number"
      ? { maxBodyBytes: options.maxBodyBytes }
      : {}),
    ...(typeof agentTool === "boolean" ? { agentTool } : {}),
    ...(typeof readOnly === "boolean" ? { readOnly } : {}),
    ...(typeof parallelSafe === "boolean" ? { parallelSafe } : {}),
    ...(typeof toolCallable === "boolean" ? { toolCallable } : {}),
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
    ...(auditConfig ? { audit: auditConfig } : {}),
  };
}

/**
 * Wrap an action's (already input/output-validated) run so each call records an
 * audit event after it resolves — on success and on error. Best-effort: the
 * recorder swallows its own failures and the original result/throw is always
 * preserved, so auditing can never change an action's behavior. The DB-touching
 * recorder is imported lazily so merely defining an action pulls in no DB code.
 */
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

// ---------------------------------------------------------------------------
// Schema → JSON Schema conversion
// ---------------------------------------------------------------------------

/**
 * Convert a Standard Schema to JSON Schema for the Claude API.
 * Tries vendor-specific toJSONSchema first (Zod v4), then falls back
 * to a basic introspection of the schema shape.
 */
function schemaToJsonSchema(
  schema: StandardSchemaV1,
  _description?: string,
): ActionTool["parameters"] {
  const s = schema as any;

  // Prefer Zod's own JSON Schema output — it handles descriptions,
  // enums, coerce, and all type wrappers correctly.
  if (s["~standard"]?.jsonSchema?.input) {
    try {
      const result = s["~standard"].jsonSchema.input({
        target: "draft-07",
      }) as any;
      // Strip $schema — the Claude API validates against draft 2020-12
      // and a mismatched $schema declaration can cause rejections.
      if (result && typeof result === "object") {
        delete result.$schema;
      }
      return result as ActionTool["parameters"];
    } catch {
      // Fall through to manual converter
    }
  }

  // Fallback: manual conversion from Zod v4 internal defs
  if (s._zod?.def) {
    return zodDefToJsonSchema(s._zod.def);
  }

  // Last resort: empty object schema
  return { type: "object" as const, properties: {} };
}

/**
 * Convert a Zod v4 internal def to JSON Schema.
 * Handles the common types used in action parameters.
 */
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
          // Zod v4 stores .describe() on the schema object, not in the def
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
    // Zod v4 stores enum entries as an object {a: "a", b: "b"};
    // JSON Schema requires an array.
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
      // Surface null as a valid value so the model knows it may pass null
      // (and doesn't treat the field as a non-nullable required string).
      return { anyOf: [inner, { type: "null" }] };
    }
  }

  if (type === "union") {
    if (def.options?.length) {
      // Check if it's a simple enum-like union of literals
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
          // Homogeneous literal union (e.g. all numbers) — derive the JSON
          // type instead of hardcoding "string", which would contradict the
          // enum values and make the model coerce/round-trip them wrongly.
          return { type: uniqueTypes[0], enum: values };
        }
        // Mixed literal types: emit anyOf so each branch stays self-consistent.
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

  // z.preprocess / z.pipe / .superRefine / .transform all produce a "pipe"
  // def with `in` (pre-transform) and `out` (post-transform). For JSON Schema
  // purposes, use `out` — it reflects the validated output shape the model
  // should populate.
  if (type === "pipe") {
    if (def.out?._zod?.def) {
      return zodDefToJsonSchema(def.out._zod.def);
    }
    if (def.in?._zod?.def) {
      return zodDefToJsonSchema(def.in._zod.def);
    }
  }

  // Fallback
  return { type: "string" };
}

// ---------------------------------------------------------------------------
// Runtime validation wrapper
// ---------------------------------------------------------------------------

const NO_COERCE = Symbol("no-coerce");

/**
 * Coerce a single stringified value to one of the JSON-schema types the field
 * expects. Returns NO_COERCE when nothing safe applies, so the caller leaves
 * the original value untouched and the normal validation error still surfaces.
 */
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

/**
 * Defensively coerce stringified action arguments to the types the schema
 * expects. Two callers depend on this:
 *
 *   1. Model gateways (notably Builder's Gemini-backed gateway) hand back
 *      structured tool-call arguments as JSON strings — an array param arrives
 *      as `"[{...}]"`, a boolean as `"true"`.
 *   2. GET actions called from the browser via `useActionQuery` / `callAction`.
 *      Those serialize params into the query string, where `URLSearchParams`
 *      stringifies everything — so `includeSeries: true` arrives as the string
 *      `"true"` and `limit: 5` as `"5"` (see `action-routes.ts`).
 *
 * In both cases Standard Schema (zod) `validate` does not coerce, so the call
 * fails validation ("expected boolean, received string") — the agent thrashes
 * retrying shapes and the frontend query errors. We only touch a string value
 * when the schema expects a non-string type and the string parses cleanly to
 * it; anything ambiguous (schema also allows string) or unparseable is left
 * as-is. Operates on top-level properties only — once an array/object param is
 * parsed, its nested members are already native and validate normally.
 *
 * Do NOT narrow this to "gateway-only": the GET query-string path relies on it
 * too, and `action-routes.spec.ts` guards that round-trip.
 */
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
    // No declared type, or the field legitimately accepts a string → leave it.
    if (types.length === 0 || types.includes("string")) continue;
    const coerced = coerceStringToSchemaType(raw, types);
    if (coerced === NO_COERCE) continue;
    if (!out) out = { ...(args as Record<string, unknown>) };
    out[key] = coerced;
  }
  return out ?? args;
}

/**
 * Wrap an action's run function with schema validation.
 * Invalid inputs get a clear error message (including what was actually passed)
 * so the agent can see its own mistake and correct it on the next turn.
 */
function wrapWithValidation(
  schema: StandardSchemaV1,
  run: Function,
  toolParameters?: ActionTool["parameters"],
): (args: any, ctx?: ActionRunContext) => any {
  return async (args: any, ctx?: ActionRunContext) => {
    args = coerceGatewayStringifiedArgs(args, toolParameters);
    const result = await schema["~standard"].validate(args);
    if (result.issues) {
      // Split issues into "missing required field" vs other validation errors
      // so the error message reads naturally rather than as "fieldName: Required".
      const missing: string[] = [];
      const other: string[] = [];
      for (const issue of result.issues) {
        const pathStr = issue.path
          ? issue.path.map((p) => (typeof p === "object" ? p.key : p)).join(".")
          : "";
        const msg = String(issue.message ?? "");
        // Zod emits "Required" for missing fields; other libraries may use
        // similar wording. Treat any variant as "missing".
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

      // Echo the args that were actually passed so the caller (usually an
      // agent) can see exactly what it sent and fix its next call.
      let received: string;
      try {
        received = JSON.stringify(args);
        if (received.length > 500) received = received.slice(0, 500) + "…";
      } catch {
        received = String(args);
      }

      // Also show the EXPECTED signature so the agent doesn't have to guess.
      // Format: `{ deckId*: string, content*: string, slideId?: string, ... }`
      // where `*` = required, `?` = optional.
      let expected = "";
      if (toolParameters?.properties) {
        const required = new Set(toolParameters.required ?? []);
        const sig = Object.entries(toolParameters.properties)
          .map(([k, v]) => {
            const mark = required.has(k) ? "*" : "?";
            const type = (v as { type?: string }).type ?? "any";
            return `${k}${mark}: ${type}`;
          })
          .join(", ");
        if (sig)
          expected = ` Expected: { ${sig} } (where * = required, ? = optional).`;
      }

      throw new Error(
        `Invalid action parameters — ${parts.join(". ")}. Received: ${received}.${expected}`,
      );
    }
    return run((result as StandardSchemaV1.SuccessResult<any>).value, ctx);
  };
}

/**
 * Wrap an action's run function with RETURN-value validation. Runs AFTER the
 * (already input-validated) `run` resolves and validates the result against
 * `outputSchema` using the Standard Schema `~standard.validate` contract.
 *
 * Behavior is governed by `strategy`:
 * - `"strict"`  — throw a clear error when the result doesn't match.
 * - `"warn"`    — `console.warn` the issues and return the ORIGINAL result
 *                 unchanged (default; never alters runtime behavior).
 * - `"fallback"`— return `fallback` in place of the invalid result.
 *
 * On success the validated value is returned (so schema-applied coercion /
 * defaults take effect, mirroring the input path).
 */
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
      // Return the validated value so coercion / defaults defined on the
      // outputSchema are applied, consistent with the input path.
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
    // "warn" (default): surface the mismatch but never change behavior.
    console.warn(summary);
    return output;
  };
}
