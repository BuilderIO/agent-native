/**
 * Per-request visibility gate for MCP tools.
 *
 * In a shared-process deployment (one Nitro server handling multiple users)
 * every user's personal MCP servers are registered in the same manager. We
 * want the LLM and the tool-call path to behave as if each user only has
 * their own — no cross-user credential use, no tools from other orgs.
 *
 * Separated from `./index.ts` (which imports `ActionEntry` from
 * `production-agent.js`) so `production-agent.js` can pull in this filter
 * without a circular import.
 */
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import { parseMergedKey, hashEmail } from "./remote-store.js";

/**
 * Guard MCP tools against cross-user access in shared-process deployments.
 *
 * - Tools with no merged-key prefix (e.g. `mcp__claude-in-chrome__navigate`
 *   from a file-based stdio config) are visible to everyone — those are
 *   process-wide by design.
 * - User-scope tools are only visible to the user whose email hashes to the
 *   tool's owner component.
 * - Org-scope tools are only visible to requests whose active org matches.
 *
 * Falls back to "visible" when there is no request context (CLI scripts,
 * startup-time tool enumeration) — the runtime gate in `mcpToolToActionEntry`
 * still prevents execution from a mismatched request.
 */
export function isMcpToolAllowedForRequest(toolName: string): boolean {
  const parsed = parseMergedKey(toolName);
  if (!parsed) return true;
  const email = getRequestUserEmail();
  const orgId = getRequestOrgId();
  if (parsed.scope === "user") {
    if (!email) return true; // no context → leave the runtime gate to block
    return hashEmail(email) === parsed.owner;
  }
  // scope === "org"
  if (!orgId) return true;
  return orgId.toLowerCase().replace(/[^a-z0-9-]/g, "-") === parsed.owner;
}
