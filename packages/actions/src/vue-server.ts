import type { IncomingMessage, ServerResponse } from "node:http";

import { toNodeHandler } from "./http.js";
import type { ActionsRegistry, CombinedHandlerOptions } from "./registry.js";
import type { ActionMap } from "./types.js";

export interface NitroEventLike {
  node?: {
    req: IncomingMessage & { body?: unknown };
    res: ServerResponse;
  };
  req?: Request;
}

/**
 * Create a Nuxt / Nitro catch-all server handler for
 * `server/api/agent-native/[...path].ts`.
 */
export function createNitroHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: CombinedHandlerOptions = {},
): (event: NitroEventLike) => Promise<Response | undefined> {
  const fetchHandler = registry.createHandler(options);
  const nodeHandler = toNodeHandler(fetchHandler);

  return async (event) => {
    if (event.req instanceof Request) {
      return fetchHandler(event.req);
    }
    if (event.node) {
      await nodeHandler(event.node.req, event.node.res);
      return undefined;
    }
    throw new Error(
      "createNitroHandler expected a Nitro/H3 event with `event.req` (Web Request) or `event.node.{req,res}`.",
    );
  };
}
