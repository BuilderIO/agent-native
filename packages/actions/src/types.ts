import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ActionCaller = "http" | "mcp" | "cli" | "server" | "agent";

export type ActionHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ActionHttpConfig =
  | false
  | {
      method?: ActionHttpMethod;
      path?: string;
    };

export type JsonSchemaObject = Record<string, unknown>;

export interface ActionContextInput {
  /** Which surface invoked this action. */
  caller: ActionCaller;
  /** Alias for `caller` for ergonomic destructuring. */
  source: ActionCaller;
  /** Name of the action being invoked, if resolved. */
  actionName?: string;
  /** Incoming Web Standard Request when called via HTTP or Streamable HTTP MCP. */
  request?: Request;
  /** Canonical Headers view available across HTTP, MCP, RSC, and server adapters. */
  headers: Headers;
  /** AbortSignal tied to the incoming request or caller cancellation. */
  signal?: AbortSignal;
  /** Runtime environment variables (defaults to process.env in Node). */
  env: Record<string, string | undefined>;
  /** Optional host-specific event, bindings (e.g. Cloudflare Workers env), or framework context. */
  platform?: unknown;
}

export interface DefaultActionContext {
  caller: ActionCaller;
  source: ActionCaller;
  headers: Headers;
  request?: Request;
  signal?: AbortSignal;
  actionName?: string;
}

export interface ActionApprovalRequest<TInput = unknown, TCtx = unknown> {
  actionName: string;
  input: TInput;
  ctx: TCtx;
  caller: ActionCaller;
  approvalToken?: string;
}

export type ActionApprovalVerifier<TCtx = unknown> = (
  request: ActionApprovalRequest<unknown, TCtx>,
) => boolean | Promise<boolean>;

export interface ActionDefinition<
  TSchema extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
  TOutputSchema extends StandardSchemaV1 | undefined =
    | StandardSchemaV1
    | undefined,
  TReturn = unknown,
  TCtx = DefaultActionContext,
> {
  /** Concise one-line description shown to agents, MCP clients, and CLI `--help`. */
  description: string;
  /** Optional human-readable title for MCP / UI listings. */
  title?: string;
  /** Standard Schema validator (Zod, Valibot, ArkType, etc.) for action inputs. */
  schema?: TSchema;
  /** Optional Standard Schema validator for action outputs. */
  outputSchema?: TOutputSchema;
  /** Explicit JSON Schema override for MCP/AI SDK tools when a Standard Schema lacks JSON Schema conversion. */
  toolSchema?: JsonSchemaObject;
  /** HTTP exposure and verb. Omit for POST; set `{ method: "GET" }` for queries; `false` disables HTTP. */
  http?: ActionHttpConfig;
  /** Marks the action as read-only (maps to MCP `readOnlyHint` and query eligibility). */
  readOnly?: boolean;
  /** Marks the action as destructive (maps to MCP `destructiveHint`). */
  destructive?: boolean;
  /** Marks the action as genuinely idempotent across repeated identical calls (maps to MCP `idempotentHint`). */
  retrySafe?: boolean;
  /** Set `false` to exclude from MCP listings and calls (still callable from UI/HTTP/CLI). */
  mcpTool?: boolean;
  /** Set `false` to exclude from AI SDK tool exports and MCP (UI/HTTP/CLI only). */
  agentTool?: boolean;
  /** Publish `outputSchema` to MCP clients when supported (defaults to true when `outputSchema` is provided). */
  mcpOutputSchema?: boolean;
  /** Gate who may call this action. Runs after input validation and before `needsApproval` / `run`. */
  authorize?(
    input: InferActionOutput<TSchema>,
    ctx: TCtx,
  ): boolean | Promise<boolean>;
  /** Require an approved execution grant before `run` executes. */
  needsApproval?:
    | boolean
    | {
        (
          input: InferActionOutput<TSchema>,
          ctx: TCtx,
        ): boolean | Promise<boolean>;
      };
  /** Core implementation receiving validated input and resolved context. */
  run(input: InferActionOutput<TSchema>, ctx: TCtx): Promise<TReturn> | TReturn;
}

export type InferActionInput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<T>
  : Record<string, never>;

export type InferActionOutput<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : Record<string, never>;

export type InferActionReturn<TAction> = TAction extends {
  outputSchema?: infer TOutSchema;
  run(input: never, ctx: never): infer TReturn;
}
  ? TOutSchema extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<TOutSchema>
    : Awaited<TReturn>
  : unknown;

export type InferActionInputFromDef<TAction> = TAction extends {
  schema?: infer TSchema;
}
  ? TSchema extends StandardSchemaV1
    ? StandardSchemaV1.InferInput<TSchema>
    : Record<string, never>
  : Record<string, unknown>;

export interface DefinedAction<
  TSchema extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
  TOutputSchema extends StandardSchemaV1 | undefined =
    | StandardSchemaV1
    | undefined,
  TReturn = unknown,
  TCtx = DefaultActionContext,
> extends ActionDefinition<TSchema, TOutputSchema, TReturn, TCtx> {
  readonly __agentNativeAction: true;
}

export interface ActionMapEntry<TCtx = DefaultActionContext> {
  description: string;
  title?: string | undefined;
  schema?: StandardSchemaV1 | undefined;
  outputSchema?: StandardSchemaV1 | undefined;
  toolSchema?: JsonSchemaObject | undefined;
  http?: ActionHttpConfig | undefined;
  readOnly?: boolean | undefined;
  destructive?: boolean | undefined;
  retrySafe?: boolean | undefined;
  mcpTool?: boolean | undefined;
  agentTool?: boolean | undefined;
  mcpOutputSchema?: boolean | undefined;
  authorize?(input: never, ctx: TCtx): boolean | Promise<boolean>;
  needsApproval?:
    | boolean
    | ((input: never, ctx: TCtx) => boolean | Promise<boolean>)
    | undefined;
  run(input: never, ctx: TCtx): Promise<unknown> | unknown;
}

export type AnyDefinedAction<TCtx = never> = ActionMapEntry<TCtx>;

export type ActionMap<TCtx = DefaultActionContext> = Record<
  string,
  ActionMapEntry<TCtx>
>;

export interface ActionMiddlewareParams<TCtx = unknown> {
  name: string;
  input: unknown;
  ctx: TCtx;
  caller: ActionCaller;
  next: () => Promise<unknown>;
}

export type ActionMiddleware<TCtx = unknown> = (
  params: ActionMiddlewareParams<TCtx>,
) => Promise<unknown>;

export interface ActionAfterMutateInfo<TCtx = unknown> {
  name: string;
  input: unknown;
  result: unknown;
  ctx: TCtx;
  caller: ActionCaller;
}

export interface ActionErrorInfo<TCtx = unknown> {
  name: string;
  caller: ActionCaller;
  ctx?: TCtx;
  committed: boolean;
}

export interface ActionMetadataSummary {
  name: string;
  title?: string;
  description: string;
  httpMethod: ActionHttpMethod | null;
  httpPath: string | null;
  readOnly: boolean;
  destructive: boolean;
  retrySafe: boolean;
  mcpExposed: boolean;
  agentExposed: boolean;
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
}
