import { getDbExec } from "../db/client.js";
import {
  hasVerifiedMcpUserIdentity,
  type MCPCallerIdentity,
} from "../mcp/build-server.js";
import { getRequestContext } from "../server/request-context.js";
import { getUserLabState } from "./store.js";

/** Caller identity is supplied by the verified MCP transport, never tool arguments. */
export async function getMcpSkillLabEnabled(
  identity: MCPCallerIdentity | undefined,
  lab: string,
): Promise<boolean> {
  const context = getRequestContext();
  if (
    !hasVerifiedMcpUserIdentity(identity) ||
    !context?.userEmail ||
    context.userEmail !== identity.userEmail ||
    (identity.orgId !== null &&
      (typeof identity.orgId !== "string" ||
        !identity.orgId.trim() ||
        context.orgId !== identity.orgId ||
        context.orgScope === "personal")) ||
    (identity.orgId === null &&
      (context.orgScope !== "personal" || !!context.orgId))
  ) {
    throw new Error("Verified MCP user context required");
  }
  const state = await getUserLabState(identity.userEmail, lab, {
    orgId: context.orgScope === "personal" ? null : (context.orgId ?? null),
    transaction: getDbExec(),
  });
  return state.enabled;
}
