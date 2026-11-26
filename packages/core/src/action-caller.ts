import type { ActionCaller, ActionRunContext } from "./action.js";

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

const AGENT_CALLERS: ReadonlySet<string> = new Set<ActionCaller | "agent">([
  "agent",
  "tool",
  "mcp",
  "webmcp",
  "a2a",
]);

/**
 * Whether an agent made this call: the app's own chat, an external agent over
 * MCP or WebMCP, or a peer over A2A. Behavior meant for "the agent" keys off
 * this, never off `caller === "tool"`, which is only the built-in chat.
 */
export function isAgentCaller(ctx: unknown): boolean {
  const caller =
    typeof ctx === "string"
      ? ctx
      : (ctx as { caller?: unknown } | null | undefined)?.caller;
  return typeof caller === "string" && AGENT_CALLERS.has(caller);
}
