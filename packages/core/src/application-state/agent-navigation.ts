import { z } from "zod";

import { isAgentCaller } from "../action-caller.js";
import {
  currentActionNavigationIntent,
  currentActionOriginCaller,
  hasObservedWriteInActionChain,
  insideParentWriteAction,
  insideReadOnlyAction,
} from "../action-frame.js";
import type { ActionRunContext } from "../action.js";
import {
  AgentNavigationRefusedError,
  NAVIGATION_OPEN_INTENT,
  isDefaultDetailNavigation,
  withAuthorizedAgentNavigation,
  type NavigationIntent,
} from "./navigate-write-guard.js";
import {
  resolveCurrentRequestStateTab,
  writeAppStateForCurrentTab,
} from "./script-helpers.js";

export {
  AgentNavigationRefusedError,
  NAVIGATION_OPEN_INTENT,
  isDefaultDetailNavigation,
  withAuthorizedAgentNavigation,
  type NavigationIntent,
};

export const navigationIntentSchema = z
  .literal(NAVIGATION_OPEN_INTENT)
  .optional()
  .describe(
    'Set to "open" only when the user asked to open or show this item. Leave it out otherwise; the user\'s current view stays put.',
  );

export type DetailViewPredicate = (
  navigation: Record<string, unknown>,
) => boolean;

function agentCallRunning(ctx?: Pick<ActionRunContext, "caller">): boolean {
  return isAgentCaller(currentActionOriginCaller() ?? ctx?.caller);
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
  if (!agentCallRunning(options.ctx)) return;
  if (insideReadOnlyAction()) {
    throw new AgentNavigationRefusedError(
      'Refused: a read-only action cannot move the user\'s view. Read the data and answer; call navigate with intent: "open" only if the user asked to see it.',
    );
  }
  const intent = options.intent ?? currentActionNavigationIntent();
  if (intent === NAVIGATION_OPEN_INTENT) return;
  if (insideParentWriteAction() || hasObservedWriteInActionChain()) {
    throw new AgentNavigationRefusedError(
      'Refused: a write action cannot move the user\'s view unless intent: "open" is set. Keep the user on their current view, or use navigateAfterWrite() so agent writes stay put.',
    );
  }
  const isDetailView = options.isDetailView ?? isDefaultDetailNavigation;
  if (!isDetailView(navigation)) return;
  throw new AgentNavigationRefusedError(
    'Refused: opening this item would move the user off their current view. Call again with intent: "open" only if the user asked to open or show it; otherwise answer without navigating.',
  );
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
