import type { IncomingMessage, ServerResponse } from "node:http";

import { toNodeHandler } from "./http.js";
import type { ActionsRegistry, CombinedHandlerOptions } from "./registry.js";
import type { ActionMap } from "./types.js";

/**
 * Create a Next.js Pages Router API handler for `pages/api/agent-native/[...path].ts`.
 */
export function createPagesHandler<TCtx, TActions extends ActionMap<TCtx>>(
  registry: ActionsRegistry<TCtx, TActions>,
  options: CombinedHandlerOptions = {},
): (
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) => Promise<void> {
  return toNodeHandler(registry.createHandler(options));
}
