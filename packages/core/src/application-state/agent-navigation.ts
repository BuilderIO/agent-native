import { z } from "zod";

import { isAgentCaller } from "../action-caller.js";
import {
  currentActionNavigationIntent,
  currentActionOriginCaller,
} from "../action-frame.js";
import type { ActionRunContext } from "../action.js";
import {
  AgentNavigationRefusedError,
  NAVIGATION_OPEN_INTENT,
  buildAgentNavigationKeptResult,
  evaluateAgentNavigationPolicy,
  isAgentNavigationKeptResult,
  isAgentNavigationRefusedError,
  isDefaultDetailNavigation,
  withAuthorizedAgentNavigation,
  type AgentNavigationKeptReason,
  type AgentNavigationKeptResult,
  type AgentNavigationRefusal,
  type AgentNavigationRefusalReason,
  type DetailViewPredicate,
  type NavigationIntent,
} from "./navigate-write-guard.js";
import {
  resolveCurrentRequestStateTab,
  writeAppStateForCurrentTab,
} from "./script-helpers.js";

export {
  AgentNavigationRefusedError,
  NAVIGATION_OPEN_INTENT,
  buildAgentNavigationKeptResult,
  isAgentNavigationKeptResult,
  isAgentNavigationRefusedError,
  isDefaultDetailNavigation,
  withAuthorizedAgentNavigation,
  type AgentNavigationKeptReason,
  type AgentNavigationKeptResult,
  type AgentNavigationRefusal,
  type AgentNavigationRefusalReason,
  type DetailViewPredicate,
  type NavigationIntent,
};

export const navigationIntentSchema = z
  .literal(NAVIGATION_OPEN_INTENT)
  .optional()
  .describe('Pass "open" only when the user asked to open or show an item.');

function agentCallRunning(ctx?: Pick<ActionRunContext, "caller">): boolean {
  return isAgentCaller(currentActionOriginCaller() ?? ctx?.caller);
}

/**
 * Evaluates whether an agent navigation would move the user off their current
 * view without `intent: "open"`. Returns `null` when navigation is allowed or
 * the typed refusal otherwise.
 */
export function evaluateAgentNavigation(
  navigation: Record<string, unknown>,
  options: {
    ctx?: Pick<ActionRunContext, "caller"> | undefined;
    intent?: string | undefined;
    isDetailView?: DetailViewPredicate | undefined;
    isNavigateAction?: boolean | undefined;
  } = {},
): AgentNavigationRefusal | null {
  return evaluateAgentNavigationPolicy(navigation, {
    caller: options.ctx?.caller,
    intent: options.intent,
    isDetailView: options.isDetailView,
    isNavigateAction: options.isNavigateAction,
  });
}

/**
 * Refuses an agent navigation that would move the user off their current view
 * without `intent: "open"`:
 * - Read-only actions never navigate.
 * - Writes/edits never navigate without `intent: "open"`.
 * - Detail opens (`isDetailView`, defaulting to `isDefaultDetailNavigation`)
 *   require `intent: "open"`.
 * Navigation outside those cases, and every call a person makes from the UI,
 * passes.
 */
export function assertAgentNavigationAllowed(
  navigation: Record<string, unknown>,
  options: {
    ctx?: Pick<ActionRunContext, "caller"> | undefined;
    intent?: string | undefined;
    isDetailView?: DetailViewPredicate | undefined;
  } = {},
): void {
  const refusal = evaluateAgentNavigation(navigation, options);
  if (!refusal) return;
  throw new AgentNavigationRefusedError(refusal.message, {
    reason: refusal.reason,
  });
}

export type NavigateAfterWriteResult =
  | { navigated: true }
  | { navigated: false; reason: "agent-keeps-view" | "no-tab" };

/**
 * For a write action that follows its result in the UI (say, opening a new
 * item). A person's call navigates; an agent's call navigates only with
 * `intent: "open"`, so writes leave the user where they are.
 */
export async function navigateAfterWrite(
  navigation: Record<string, unknown>,
  options: {
    ctx?: Pick<ActionRunContext, "caller"> | undefined;
    intent?: string | undefined;
  } = {},
): Promise<NavigateAfterWriteResult> {
  const intent = options.intent ?? currentActionNavigationIntent();
  if (agentCallRunning(options.ctx) && intent !== NAVIGATION_OPEN_INTENT) {
    return { navigated: false, reason: "agent-keeps-view" };
  }
  const tab = await resolveCurrentRequestStateTab();
  if (tab.unavailable || !tab.tabId) {
    return { navigated: false, reason: "no-tab" };
  }
  await withAuthorizedAgentNavigation(() =>
    writeAppStateForCurrentTab("navigate", {
      ...navigation,
      _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
  );
  return { navigated: true };
}
