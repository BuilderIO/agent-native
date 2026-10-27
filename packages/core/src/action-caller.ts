import type { ActionRunContext } from "./action.js";

/** Classify provenance for approval policy; this does not authenticate a caller. */
export function isOutsideAgentCall(
  ctx?: Pick<ActionRunContext, "caller" | "networkProtocol" | "automation">,
): boolean {
  // CLI defaults to outside because coding agents drive it; Alice's decision is pending.
  // Automation has no trusted origin in ctx yet; #8070's mcpManaged is job frontmatter.
  return (
    ctx?.networkProtocol !== undefined ||
    ctx?.automation !== undefined ||
    (ctx?.caller !== "frontend" && ctx?.caller !== "tool")
  );
}
