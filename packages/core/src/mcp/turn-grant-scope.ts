import { AsyncLocalStorage } from "node:async_hooks";

import { actionExecutionStorage } from "../action-frame.js";
import type { ActionUserTurn } from "../action.js";
import {
  getRequestContext,
  getRequestRunContext,
} from "../server/request-context.js";

/** The tool-listing key an MCP client reads to learn which tools take a turn grant. */
export const MCP_USER_TURN_META_KEY = "agent-native/userTurn";

/** The request header that carries a page-minted turn grant id. */
export const MCP_TURN_GRANT_HEADER = "x-agent-native-turn-grant";

/** The action's declared turn-grant kind; anything but a known value is no grant. */
export function actionUserTurn(
  entry: { userTurn?: unknown } | undefined,
): ActionUserTurn | undefined {
  return entry?.userTurn === "read" ||
    entry?.userTurn === "approval" ||
    entry?.userTurn === "direct"
    ? entry.userTurn
    : undefined;
}

/** True when any action declares `userTurn`, which opts the app in to turn grants. */
export function hasUserTurnActions(
  actions: Record<string, { userTurn?: unknown }>,
): boolean {
  return Object.values(actions).some((entry) => actionUserTurn(entry));
}

type TurnScope = {
  actionName: string;
  userTurn: ActionUserTurn;
  expiresAt: number;
  active: boolean;
};
const turnScope = new AsyncLocalStorage<TurnScope | undefined>();

/** An agent run, an A2A call or a nested action never carries the person's turn. */
/**
 * True inside an agent run (it has a run or thread). An MCP tool call also
 * carries a run context, for its browser-tab target, and is still the user's
 * own call.
 */
export function isAgentRunContext(): boolean {
  const run = getRequestRunContext();
  return run?.runId !== undefined || run?.threadId !== undefined;
}

export function isAgentTurnGrantContext(): boolean {
  return (
    isAgentRunContext() ||
    getRequestContext()?.a2aIdentityAssurance !== undefined ||
    actionExecutionStorage?.getStore()?.frame !== undefined
  );
}

export function isMcpTurnGrantAction(actionName: string | undefined): boolean {
  const scope = turnScope.getStore();
  return (
    scope !== undefined &&
    scope.active &&
    scope.actionName === actionName &&
    Date.now() < scope.expiresAt
  );
}

/**
 * True when a call under this grant that needs approval gets it on the app's
 * review page only. A direct write that reaches approval was not cleared by
 * its predicate, so it is reviewed like an approval write.
 */
export function requiresTurnGrantPageApproval(actionName: string): boolean {
  const userTurn = turnScope.getStore()?.userTurn;
  return (
    isMcpTurnGrantAction(actionName) &&
    (userTurn === "approval" || userTurn === "direct")
  );
}

export async function runWithMcpTurnGrantScope<T>(
  actionName: string,
  userTurn: ActionUserTurn,
  expiresAt: number,
  work: () => Promise<T>,
): Promise<T> {
  const scope: TurnScope = { actionName, userTurn, expiresAt, active: true };
  return turnScope.run(scope, async () => {
    try {
      return await work();
    } finally {
      // Work the call left running must not keep the grant.
      scope.active = false;
    }
  });
}

export function runWithoutMcpTurnGrantScope<T>(
  work: () => Promise<T>,
): Promise<T> {
  return turnScope.run(undefined, work);
}
