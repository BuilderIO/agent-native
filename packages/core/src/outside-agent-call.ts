import type { ActionRunContext } from "./action.js";

/** Classify provenance for approval policy; this does not authenticate a caller. */
export function isOutsideAgentCall(ctx?: ActionRunContext): boolean {
  return (
    ctx?.networkProtocol !== undefined ||
    ctx?.automation !== undefined ||
    (ctx?.caller !== "frontend" && ctx?.caller !== "tool")
  );
}
