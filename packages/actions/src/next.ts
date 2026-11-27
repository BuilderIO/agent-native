import type {
  ActionHttpHandlerOptions,
  ActionsRegistry,
  CombinedHandlerOptions,
  McpHandlerOptions,
} from "./registry.js";
import type { ActionMap } from "./types.js";

export interface NextRouteContext {
  params:
    | Promise<{ path?: string[]; action?: string[] }>
    | { path?: string[]; action?: string[] };
}

export type NextRouteHandler = (
  request: Request,
  context?: NextRouteContext,
) => Promise<Response>;

export interface NextRouteHandlerExports {
  GET: NextRouteHandler;
  POST: NextRouteHandler;
  PUT: NextRouteHandler;
  PATCH: NextRouteHandler;
  DELETE: NextRouteHandler;
  OPTIONS: NextRouteHandler;
}

async function resolvePathSegments(
  context?: NextRouteContext,
): Promise<readonly string[] | undefined> {
  if (!context?.params) return undefined;
  const resolved = await context.params;
  if (Array.isArray(resolved.path)) return resolved.path;
  if (Array.isArray(resolved.action)) return resolved.action;
  return undefined;
}

/**
 * Create Next.js App Router catch-all handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`)
 * serving both `/actions/:name` and `/mcp` under one route file:
 * `app/api/agent-native/[...path]/route.ts`.
 */
export function createNextHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: CombinedHandlerOptions = {},
): NextRouteHandlerExports {
  const combined = registry.createHandler(options);

  const handle: NextRouteHandler = async (request, context) => {
    const pathSegments = await resolvePathSegments(context);
    return combined(
      request,
      pathSegments !== undefined ? { pathSegments } : undefined,
    );
  };

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
    OPTIONS: handle,
  };
}

/**
 * Split transport helper: Next.js App Router handler for HTTP actions only
 * (`app/api/actions/[...action]/route.ts`).
 */
export function createNextActionHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: ActionHttpHandlerOptions = {},
): NextRouteHandlerExports {
  const basePath = options.basePath ?? "/api/actions";
  const handle: NextRouteHandler = async (request, context) => {
    const segments = await resolvePathSegments(context);
    const actionFetch = registry.createHandler({
      basePath,
      mcp: false,
      http: options,
    });
    return actionFetch(
      request,
      segments !== undefined
        ? { pathSegments: ["actions", ...segments] }
        : undefined,
    );
  };

  return {
    GET: handle,
    POST: handle,
    PUT: handle,
    PATCH: handle,
    DELETE: handle,
    OPTIONS: handle,
  };
}

/**
 * Split transport helper: Next.js App Router handler for Streamable HTTP MCP only
 * (`app/api/mcp/route.ts`).
 */
export function createNextMcpHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: McpHandlerOptions = {},
): Pick<NextRouteHandlerExports, "GET" | "POST" | "DELETE" | "OPTIONS"> {
  const mcpHandler = registry.createHandler({
    basePath: "/api",
    mcp: options,
  });

  const handle: NextRouteHandler = async (request) =>
    mcpHandler(request, { pathSegments: ["mcp"] });

  return {
    GET: handle,
    POST: handle,
    DELETE: handle,
    OPTIONS: handle,
  };
}
