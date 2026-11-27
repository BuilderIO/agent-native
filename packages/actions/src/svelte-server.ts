import type { ActionsRegistry, CombinedHandlerOptions } from "./registry.js";
import type {
  ActionMap,
  InferActionInputFromDef,
  InferActionReturn,
} from "./types.js";

export interface SvelteKitEventLike {
  request: Request;
  params?: { path?: string };
  platform?: unknown;
}

export type SvelteKitRequestHandler = (
  event: SvelteKitEventLike,
) => Promise<Response>;

/**
 * Create SvelteKit `+server.ts` exports (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`)
 * for `src/routes/api/agent-native/[...path]/+server.ts`.
 */
export function createSvelteKitHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: CombinedHandlerOptions = {},
): Record<
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS",
  SvelteKitRequestHandler
> {
  const combined = registry.createHandler(options);

  const handle: SvelteKitRequestHandler = async (event) => {
    const pathParam = event.params?.path;
    const pathSegments = pathParam
      ? pathParam.split("/").filter(Boolean)
      : undefined;
    return combined(event.request, {
      ...(pathSegments !== undefined ? { pathSegments } : {}),
      ...(event.platform !== undefined ? { platform: event.platform } : {}),
    });
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
 * Call an action directly from a SvelteKit `+page.server.ts` `load` function
 * or form action with zero HTTP hop.
 */
export async function callSvelteKitAction<
  TCtx,
  TActions extends ActionMap<TCtx>,
  TName extends Extract<keyof TActions, string>,
>(
  registry: ActionsRegistry<TCtx, TActions>,
  name: TName,
  input: InferActionInputFromDef<TActions[TName]>,
  event: SvelteKitEventLike,
): Promise<InferActionReturn<TActions[TName]>> {
  return registry.call(name, input, {
    caller: "server",
    request: event.request,
    headers: event.request.headers,
    ...(event.platform !== undefined ? { platform: event.platform } : {}),
  });
}
