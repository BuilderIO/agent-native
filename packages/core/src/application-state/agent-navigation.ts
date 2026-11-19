import { z } from "zod";

import { isAgentCaller } from "../action-caller.js";
import {
  currentActionOriginCaller,
  currentActionReadOnly,
} from "../action-frame.js";
import type { ActionRunContext } from "../action.js";
import { writeAppStateForCurrentTab } from "./script-helpers.js";

/**
 * The one intent that lets an agent open a view: the user asked to see it.
 * Agents (built-in chat, MCP, WebMCP, A2A) leave the user's view alone
 * otherwise, so "mark X done" or "what's in my inbox" never opens items.
 */
export const NAVIGATION_OPEN_INTENT = "open" as const;
export type NavigationIntent = typeof NAVIGATION_OPEN_INTENT;

export const navigationIntentSchema = z
  .literal(NAVIGATION_OPEN_INTENT)
  .optional()
  .describe(
    'Set to "open" only when the user asked to open or show this item. Leave it out otherwise; the user\'s current view stays put.',
  );

export type DetailViewPredicate = (
  navigation: Record<string, unknown>,
) => boolean;

export class AgentNavigationRefusedError extends Error {
  readonly code = "agent_navigation_refused";
  constructor(message: string) {
    super(message);
    this.name = "AgentNavigationRefusedError";
  }
}

function agentCallRunning(ctx?: Pick<ActionRunContext, "caller">): boolean {
  return isAgentCaller(currentActionOriginCaller() ?? ctx?.caller);
}

/**
 * Refuses an agent navigation that would open a detail view without
 * `intent: "open"`. Navigation outside a detail view, and every call a person
 * makes from the UI, passes.
 */
export function assertAgentNavigationAllowed(
  navigation: Record<string, unknown>,
  options: {
    ctx?: Pick<ActionRunContext, "caller"> | undefined;
    intent?: string | undefined;
    isDetailView?: DetailViewPredicate | undefined;
  },
): void {
  if (!agentCallRunning(options.ctx)) return;
  if (options.intent === NAVIGATION_OPEN_INTENT) return;
  if (!options.isDetailView?.(navigation)) return;
  throw new AgentNavigationRefusedError(
    'Refused: opening this item would move the user off their current view. Call again with intent: "open" only if the user asked to open or show it; otherwise answer without navigating.',
  );
}

/**
 * Refuses a navigate command written by a read-only action during an agent
 * call. Reading data never moves the user's view.
 */
export function assertNavigateWriteAllowed(key: string): void {
  if (key !== "navigate" || !currentActionReadOnly()) return;
  if (!agentCallRunning()) return;
  throw new AgentNavigationRefusedError(
    'Refused: a read-only action cannot move the user\'s view. Read the data and answer; call navigate with intent: "open" only if the user asked to see it.',
  );
}

export type NavigateAfterWriteResult =
  | { navigated: true }
  | { navigated: false; reason: "agent-keeps-view" };

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
  if (
    agentCallRunning(options.ctx) &&
    options.intent !== NAVIGATION_OPEN_INTENT
  ) {
    return { navigated: false, reason: "agent-keeps-view" };
  }
  await writeAppStateForCurrentTab("navigate", {
    ...navigation,
    _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { navigated: true };
}
