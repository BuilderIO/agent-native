import type { ActionRunContext } from "../../action.js";
import { resolveMcpClientHostId } from "../../shared/mcp-connect-content.js";
import type { SuggestionAuthorSource } from "./types.js";

export function suggestionActorKind(
  ctx: unknown,
): "agent" | "human" | "system" {
  const agentCallers = new Set(["agent", "tool", "mcp", "webmcp", "a2a"]);
  const caller = (ctx as { caller?: unknown })?.caller;
  if (agentCallers.has(caller as string)) return "agent";
  return (ctx as { userEmail?: unknown })?.userEmail ? "human" : "system";
}

/** How an agent's call arrived, or null for a person's. */
export function suggestionAuthorSource(
  ctx: unknown,
): SuggestionAuthorSource | null {
  const caller = (ctx as { caller?: unknown } | undefined)?.caller;
  if (caller === "mcp" || caller === "webmcp") return "mcp";
  if (caller === "a2a") return "a2a";
  if (caller === "agent" || caller === "tool") return "agent";
  return null;
}

/** The MCP host an MCP call's client said it was, such as `claude-code`. */
export function suggestionAuthorClient(ctx: unknown): string | null {
  if (suggestionAuthorSource(ctx) !== "mcp") return null;
  // An MCP caller means ctx is a context object.
  const client = (ctx as Pick<ActionRunContext, "mcpClient">).mcpClient;
  return resolveMcpClientHostId(client) ?? null;
}

export const LEGACY_SUGGESTION_RECEIPT_VERSION = 1;

export function suggestionActorKindMatchesReceipt(
  receiptActorKind: string | null | undefined,
  actorKind: string,
  receiptVersion: number | null | undefined,
): boolean {
  if (receiptActorKind === actorKind) return true;
  const legacy = (receiptVersion ?? 1) < 2;
  return legacy && receiptActorKind === "human" && actorKind === "agent";
}
