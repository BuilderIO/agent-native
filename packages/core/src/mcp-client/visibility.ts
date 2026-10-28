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
 * SECURITY: when there is no request context (CLI scripts, MCP server
 * endpoint without `runWithRequestContext`, etc.) we DENY by default in
 * production — the runtime gate elsewhere is not a safe substitute when
 * the gate runs without a context either. In development we still allow
 * for ergonomics (tool enumeration at startup, ad-hoc CLI runs).
 *
 * See finding #5 in /tmp/security-audit/12-mcp-a2a-agent.md.
 */
export function isMcpToolAllowedForRequest(toolName: string): boolean {
  const parsed = parseMergedKey(toolName);
  if (!parsed) return true;
  const email = getRequestUserEmail();
  const orgId = getRequestOrgId();
  const inProduction = process.env.NODE_ENV === "production";
  if (parsed.scope === "user") {
    if (!email) {
      return !inProduction;
    }
    return hashEmail(email) === parsed.owner;
  }
  if (!orgId) {
    return !inProduction;
  }
  return orgId.toLowerCase().replace(/[^a-z0-9-]/g, "-") === parsed.owner;
}
