import { z } from "zod";

import { isAgentCaller } from "../action-caller.js";
import {
  currentActionNavigationIntent,
  currentActionOriginCaller,
} from "../action-frame.js";
import type { ActionRunContext } from "../action.js";
import type { NavigationMode } from "../manifest/index.js";
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
  appStateKeyForBrowserTab,
  resolveSessionId,
  readAppState,
} from "./script-helpers.js";
import { appStatePut } from "./store.js";

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

export interface NavigationResult {
  navigated: boolean;
  kept: boolean;
  resolvedUrl: string;
  tabId: string | null;
  reason?: string;
  writeId?: string;
}

export type NavigateAfterWriteResult = NavigationResult;

type NavigationOptions = {
  ctx?: Pick<ActionRunContext, "caller"> | undefined;
  navigationMode?: NavigationMode | undefined;
  intent?: string | undefined;
  isDetailView?: DetailViewPredicate | undefined;
  isNavigateAction?: boolean;
  stateKey?: string;
};

export async function writeNavigationCommand(
  navigation: Record<string, unknown>,
  options: NavigationOptions = {},
): Promise<NavigationResult> {
  const tab = await resolveCurrentRequestStateTab();
  const resolvedUrl =
    typeof navigation.path === "string"
      ? navigation.path
      : typeof navigation.url === "string"
        ? navigation.url
        : "";
  const base = { resolvedUrl, tabId: tab.tabId };
  const kept = (reason: string): NavigationResult => ({
    ...base,
    navigated: false,
    kept: true,
    reason,
  });
  const mode =
    options.navigationMode ?? options.intent ?? currentActionNavigationIntent();
  const refusal = evaluateAgentNavigation(navigation, {
    ...options,
    intent: mode,
  });
  if (refusal) {
    if (refusal.reason === "read-only-action") {
      throw new AgentNavigationRefusedError(refusal.message, {
        reason: refusal.reason,
      });
    }
    const currentView = await readAppState("navigation");
    return {
      ...buildAgentNavigationKeptResult(refusal.reason, currentView),
      ...kept(refusal.reason),
    };
  }
  if (!tab.tabId) return kept("no-tab");
  const writeId = globalThis.crypto.randomUUID();
  const key = appStateKeyForBrowserTab(
    options.stateKey ?? "navigate",
    tab.tabId,
  );
  try {
    const sessionId = await resolveSessionId();
    await withAuthorizedAgentNavigation(() =>
      appStatePut(
        sessionId,
        key,
        { ...navigation, _writeId: writeId },
        { requestSource: "agent" },
      ),
    );
  } catch (error) {
    if (isAgentNavigationRefusedError(error)) return kept(error.reason);
    throw error;
  }
  return { ...base, navigated: true, kept: false, writeId };
}

/** Show the result of a write when the caller requested open or reveal. */
export async function navigateAfterWrite(
  navigation: Record<string, unknown>,
  options: NavigationOptions = {},
): Promise<NavigateAfterWriteResult> {
  const mode =
    options.navigationMode ?? options.intent ?? currentActionNavigationIntent();
  return writeNavigationCommand(navigation, {
    ...options,
    navigationMode:
      mode === "open" || mode === "reveal" || mode === "keep"
        ? mode
        : agentCallRunning(options.ctx)
          ? "keep"
          : undefined,
  });
}
