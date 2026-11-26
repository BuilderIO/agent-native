import { AsyncLocalStorage } from "node:async_hooks";

import { parseServiceIdentityEmail } from "../org/service-identity.js";
import { getRequestContext } from "../server/request-context.js";
import type { MCPCallerIdentity } from "./build-server.js";
import {
  isAgentRunContext,
  isAgentTurnGrantContext,
} from "./turn-grant-scope.js";

const calls = new AsyncLocalStorage<
  { owner: string; active: boolean } | undefined
>();

export function mcpChatTurnOwner(): string | undefined {
  const call = calls.getStore();
  return call?.active &&
    !isAgentRunContext() &&
    getRequestContext()?.a2aIdentityAssurance === undefined
    ? call.owner
    : undefined;
}

export async function runWithMcpChatTurnCall<T>(
  identity: MCPCallerIdentity | undefined,
  toolName: string,
  excluded: boolean,
  work: () => Promise<T>,
): Promise<T> {
  if (
    excluded ||
    !["ask_app", "ask-agent"].includes(toolName) ||
    identity?.identityAssurance !== "user" ||
    !identity.userEmail?.trim() ||
    parseServiceIdentityEmail(identity.userEmail) ||
    isAgentTurnGrantContext()
  )
    return calls.run(undefined, work);
  const call = { owner: identity.userEmail.trim().toLowerCase(), active: true };
  return calls.run(call, async () => {
    try {
      return await work();
    } finally {
      call.active = false;
    }
  });
}
