import {
  executeAction,
  isActionReadOnly,
  resolveActionHttpMethod,
  resolveActionHttpPath,
} from "./action.js";
import { ActionError } from "./errors.js";
import { createActionFetchHandler, stripBasePath } from "./http.js";
import { createMcpFetchHandler } from "./mcp.js";
import type {
  ActionAfterMutateInfo,
  ActionApprovalVerifier,
  ActionCaller,
  ActionContextInput,
  ActionErrorInfo,
  ActionHttpMethod,
  ActionMap,
  ActionMetadataSummary,
  ActionMiddleware,
  DefaultActionContext,
  InferActionInputFromDef,
  InferActionReturn,
} from "./types.js";

export interface ActionHttpHandlerOptions {
  /** Mount prefix stripped before resolving action names. Defaults to `"/api/agent-native/actions"`. */
  basePath?: string;
  /** Enforce same-origin check on cookie-authenticated mutations. Defaults to `true`. */
  csrfProtection?: boolean;
  /** Optional CORS configuration for cross-origin browser clients. */
  cors?:
    | boolean
    | {
        origin: string | readonly string[] | ((origin: string) => boolean);
        credentials?: boolean;
      };
}

export interface McpHandlerOptions {
  /** MCP server name announced during initialize. */
  name?: string;
  /** MCP server version announced during initialize. */
  version?: string;
  /** Server instructions shown to MCP hosts. */
  instructions?: string;
  /** Explicit allowlist of action names exposed over MCP. */
  include?: readonly string[];
  /** Action names excluded from MCP. */
  exclude?: readonly string[];
  /** Optional gate run before handling an incoming HTTP MCP request. Return false to reject with 401. */
  authenticate?: (request: Request) => boolean | Promise<boolean>;
}

export interface CombinedHandlerOptions {
  /** Base path for the combined catch-all handler. Defaults to `"/api/agent-native"`. */
  basePath?: string;
  /** Enable or configure Streamable HTTP MCP at `<basePath>/mcp`. Defaults to `true`. */
  mcp?: boolean | McpHandlerOptions;
  /** HTTP RPC handler options (CORS, CSRF). */
  http?: Omit<ActionHttpHandlerOptions, "basePath">;
}

export interface CreateActionsOptions<
  TActions extends ActionMap<TCtx>,
  TCtx = DefaultActionContext,
> {
  actions: TActions & ActionMap<TCtx>;
  /** Resolve the typed context passed as the 2nd argument to `authorize`, `needsApproval`, and `run`. */
  createContext?: (input: ActionContextInput) => TCtx | Promise<TCtx>;
  /** Middleware wrapping every action invocation across HTTP, MCP, CLI, server, and AI SDKs. */
  middleware?: readonly ActionMiddleware<NoInfer<TCtx>>[];
  /** Host verifier for `needsApproval` grants (e.g. signed token or DB approval lookup). */
  verifyApproval?: ActionApprovalVerifier<NoInfer<TCtx>>;
  /** Runs after a non-read-only action's `run()` and `outputSchema` succeed. */
  onAfterMutate?: (
    info: ActionAfterMutateInfo<NoInfer<TCtx>>,
  ) => void | Promise<void>;
  /** Structured error observer for logging / Sentry / OpenTelemetry. */
  onError?: (error: unknown, info: ActionErrorInfo<NoInfer<TCtx>>) => void;
  /** Default options for `actions.handler` and `actions.mcpHandler`. */
  http?: ActionHttpHandlerOptions;
  mcp?: McpHandlerOptions;
}

export interface ActionsRegistry<TCtx, TActions extends ActionMap<TCtx>> {
  readonly actions: TActions;
  readonly __contextType?: TCtx;
  /** List all registered action names. */
  list: () => Array<Extract<keyof TActions, string>>;
  /** Return static metadata for every registered action (safe for diagnostics / client method maps). */
  describe: () => ActionMetadataSummary[];
  /** Build a `{ [actionName]: "GET" | "POST" | ... }` map for typed clients. */
  httpMethodMap: () => Record<string, ActionHttpMethod>;
  /** Resolve an incoming relative HTTP path to an action name and method. */
  resolveHttpAction: (relativePath: string) => {
    name: Extract<keyof TActions, string>;
    method: ActionHttpMethod;
  } | null;
  /**
   * Call a registered action directly with full schema validation, `authorize`,
   * `needsApproval`, middleware, and `outputSchema` enforcement.
   */
  call: <TName extends Extract<keyof TActions, string>>(
    name: TName,
    input: InferActionInputFromDef<TActions[TName]>,
    options?: {
      ctx?: TCtx;
      caller?: ActionCaller;
      request?: Request;
      headers?: HeadersInit;
      signal?: AbortSignal;
      platform?: unknown;
      approvalToken?: string;
      approved?: boolean;
    },
  ) => Promise<InferActionReturn<TActions[TName]>>;
  /** Internal / adapter entry point using an incoming Web Standard Request to build context. */
  invokeFromRequest: (
    name: string,
    rawInput: unknown,
    options: {
      caller: ActionCaller;
      request: Request;
      platform?: unknown;
      approvalToken?: string;
    },
  ) => Promise<unknown>;
  /** Internal / CLI / stdio MCP entry point using local env to build context. */
  invokeFromCliOrStdio: (
    name: string,
    rawInput: unknown,
    options: {
      caller: ActionCaller;
      approved?: boolean;
      approvalToken?: string;
    },
  ) => Promise<unknown>;
  /** Internal / AI SDK entry point with an explicit pre-resolved context. */
  invokeWithContext: (
    name: string,
    rawInput: unknown,
    ctx: TCtx,
    options: {
      caller: ActionCaller;
      approvalToken?: string;
      approved?: boolean;
    },
  ) => Promise<unknown>;
  /** Web Fetch handler for HTTP action RPC only (`/actions/:name`). */
  fetchHandler: (
    request: Request,
    override?: { actionPath?: string; platform?: unknown },
  ) => Promise<Response>;
  /** Web Fetch handler for Streamable HTTP MCP only (`/mcp`). */
  mcpHandler: (
    request: Request,
    override?: { platform?: unknown },
  ) => Promise<Response>;
  /** Single catch-all Web Fetch handler routing `/actions/*` and `/mcp` under one prefix. */
  handler: (
    request: Request,
    override?: { pathSegments?: readonly string[]; platform?: unknown },
  ) => Promise<Response>;
  /** Build a customized catch-all Web Fetch handler (e.g. custom `basePath` or MCP config). */
  createHandler: (
    options?: CombinedHandlerOptions,
  ) => (
    request: Request,
    override?: { pathSegments?: readonly string[]; platform?: unknown },
  ) => Promise<Response>;
}

function readRuntimeEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" ? process.env : {};
}

function defaultContext(input: ActionContextInput): DefaultActionContext {
  return {
    caller: input.caller,
    source: input.source,
    headers: input.headers,
    ...(input.request ? { request: input.request } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.actionName ? { actionName: input.actionName } : {}),
  };
}

export function createActions<
  TCtx = DefaultActionContext,
  TActions extends ActionMap<TCtx> = ActionMap<TCtx>,
>(
  options: CreateActionsOptions<TActions, TCtx>,
): ActionsRegistry<TCtx, TActions> {
  const { actions } = options;

  const httpRouteIndex = new Map<
    string,
    { name: Extract<keyof TActions, string>; method: ActionHttpMethod }
  >();

  for (const [name, action] of Object.entries(actions)) {
    const method = resolveActionHttpMethod(action);
    const routePath = resolveActionHttpPath(name, action);
    if (method && routePath) {
      if (httpRouteIndex.has(routePath)) {
        throw new Error(
          `Duplicate HTTP action route "${routePath}" in createActions().`,
        );
      }
      httpRouteIndex.set(routePath, {
        name: name as Extract<keyof TActions, string>,
        method,
      });
    }
  }

  const resolveContext = async (input: ActionContextInput): Promise<TCtx> => {
    if (options.createContext) {
      return options.createContext(input);
    }
    return defaultContext(input) as TCtx;
  };

  const invokeWithContext = async (
    name: string,
    rawInput: unknown,
    ctx: TCtx,
    callOpts: {
      caller: ActionCaller;
      approvalToken?: string;
      approved?: boolean;
    },
  ): Promise<unknown> => {
    const action = actions[name];
    if (!action) {
      throw new ActionError(`Action "${name}" not found.`, {
        statusCode: 404,
        errorCode: "not_found",
      });
    }

    return executeAction({
      name,
      action,
      rawInput,
      ctx,
      caller: callOpts.caller,
      ...(callOpts.approvalToken !== undefined
        ? { approvalToken: callOpts.approvalToken }
        : {}),
      ...(callOpts.approved !== undefined
        ? { approved: callOpts.approved }
        : {}),
      ...(options.verifyApproval
        ? { verifyApproval: options.verifyApproval }
        : {}),
      ...(options.middleware ? { middleware: options.middleware } : {}),
      ...(options.onAfterMutate
        ? { onAfterMutate: options.onAfterMutate }
        : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    });
  };

  const invokeFromRequest: ActionsRegistry<
    TCtx,
    TActions
  >["invokeFromRequest"] = async (name, rawInput, reqOpts) => {
    const ctx = await resolveContext({
      caller: reqOpts.caller,
      source: reqOpts.caller,
      actionName: name,
      request: reqOpts.request,
      headers: reqOpts.request.headers,
      signal: reqOpts.request.signal,
      env: readRuntimeEnv(),
      ...(reqOpts.platform !== undefined ? { platform: reqOpts.platform } : {}),
    });
    return invokeWithContext(name, rawInput, ctx, {
      caller: reqOpts.caller,
      ...(reqOpts.approvalToken !== undefined
        ? { approvalToken: reqOpts.approvalToken }
        : {}),
    });
  };

  const invokeFromCliOrStdio: ActionsRegistry<
    TCtx,
    TActions
  >["invokeFromCliOrStdio"] = async (name, rawInput, cliOpts) => {
    const ctx = await resolveContext({
      caller: cliOpts.caller,
      source: cliOpts.caller,
      actionName: name,
      headers: new Headers(),
      env: readRuntimeEnv(),
    });
    return invokeWithContext(name, rawInput, ctx, {
      caller: cliOpts.caller,
      ...(cliOpts.approved !== undefined ? { approved: cliOpts.approved } : {}),
      ...(cliOpts.approvalToken !== undefined
        ? { approvalToken: cliOpts.approvalToken }
        : {}),
    });
  };

  const registry: ActionsRegistry<TCtx, TActions> = {
    actions,
    list: () => Object.keys(actions) as Array<Extract<keyof TActions, string>>,
    describe: () =>
      Object.entries(actions).map(([name, action]) => ({
        name,
        ...(action.title ? { title: action.title } : {}),
        description: action.description,
        httpMethod: resolveActionHttpMethod(action),
        httpPath: resolveActionHttpPath(name, action),
        readOnly: isActionReadOnly(action),
        destructive: Boolean(action.destructive),
        retrySafe: Boolean(action.retrySafe),
        mcpExposed: action.agentTool !== false && action.mcpTool !== false,
        agentExposed: action.agentTool !== false,
        hasInputSchema: Boolean(action.schema),
        hasOutputSchema: Boolean(action.outputSchema),
      })),
    httpMethodMap: () => {
      const map: Record<string, ActionHttpMethod> = {};
      for (const [name, action] of Object.entries(actions)) {
        const method = resolveActionHttpMethod(action);
        if (method) map[name] = method;
      }
      return map;
    },
    resolveHttpAction: (relativePath) =>
      httpRouteIndex.get(relativePath) ?? null,
    call: async (name, input, callOpts = {}) => {
      const caller = callOpts.caller ?? "server";
      const ctx =
        callOpts.ctx !== undefined
          ? callOpts.ctx
          : await resolveContext({
              caller,
              source: caller,
              actionName: name,
              ...(callOpts.request ? { request: callOpts.request } : {}),
              headers: new Headers(
                callOpts.headers ?? callOpts.request?.headers,
              ),
              ...(callOpts.signal
                ? { signal: callOpts.signal }
                : callOpts.request
                  ? { signal: callOpts.request.signal }
                  : {}),
              env: readRuntimeEnv(),
              ...(callOpts.platform !== undefined
                ? { platform: callOpts.platform }
                : {}),
            });

      return (await invokeWithContext(name, input, ctx, {
        caller,
        ...(callOpts.approvalToken !== undefined
          ? { approvalToken: callOpts.approvalToken }
          : {}),
        ...(callOpts.approved !== undefined
          ? { approved: callOpts.approved }
          : {}),
      })) as InferActionReturn<TActions[typeof name]>;
    },
    invokeFromRequest,
    invokeFromCliOrStdio,
    invokeWithContext,
    fetchHandler: async () => new Response("Not initialized", { status: 500 }),
    mcpHandler: async () => new Response("Not initialized", { status: 500 }),
    handler: async () => new Response("Not initialized", { status: 500 }),
    createHandler: (combinedOptions = {}) => {
      const basePath = combinedOptions.basePath ?? "/api/agent-native";
      const actionBasePath = `${basePath.replace(/\/+$/, "")}/actions`;
      const actionFetch = createActionFetchHandler(registry, {
        ...options.http,
        ...combinedOptions.http,
        basePath: actionBasePath,
      });
      const mcpEnabled = combinedOptions.mcp !== false;
      const mcpOpts: McpHandlerOptions =
        typeof combinedOptions.mcp === "object"
          ? { ...options.mcp, ...combinedOptions.mcp }
          : { ...options.mcp };
      const mcpFetch = mcpEnabled
        ? createMcpFetchHandler(registry, mcpOpts)
        : null;

      return async (request, override) => {
        const url = new URL(request.url);
        const rel =
          override?.pathSegments !== undefined
            ? override.pathSegments.join("/")
            : stripBasePath(url.pathname, basePath);

        if (rel === "mcp" || rel.startsWith("mcp/")) {
          if (!mcpFetch) {
            return new Response(
              JSON.stringify({
                error: "MCP endpoint is disabled.",
                errorCode: "not_found",
              }),
              {
                status: 404,
                headers: { "Content-Type": "application/json; charset=utf-8" },
              },
            );
          }
          return mcpFetch(
            request,
            override?.platform !== undefined
              ? { platform: override.platform }
              : undefined,
          );
        }

        if (rel === "actions" || rel.startsWith("actions/")) {
          const actionPath =
            rel === "actions" ? "" : rel.slice("actions/".length);
          return actionFetch(request, {
            actionPath,
            ...(override?.platform !== undefined
              ? { platform: override.platform }
              : {}),
          });
        }

        return new Response(
          JSON.stringify({
            error: `Unknown route "${rel}". Expected /actions/<name> or /mcp.`,
            errorCode: "not_found",
          }),
          {
            status: 404,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          },
        );
      };
    },
  };

  registry.fetchHandler = createActionFetchHandler(registry, options.http);
  registry.mcpHandler = createMcpFetchHandler(registry, options.mcp);
  registry.handler = registry.createHandler();

  return registry;
}
