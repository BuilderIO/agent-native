import { isAgentCaller } from "../action-caller.js";
import {
  currentActionAllowsAgentNavigation,
  currentActionNavigationIntent,
  currentActionOriginCaller,
  hasObservedWriteInActionChain,
  insideParentWriteAction,
  insideReadOnlyAction,
  insideWriteAction,
  isStandaloneNavigateAction,
} from "../action-frame.js";
import { getAppConfig } from "../app-config/index.js";
import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";
import type { ViewportMode } from "../shared/viewport-mode.js";

let viewportModeProbe: (() => ViewportMode | undefined) | undefined;

/** Registers a runtime probe that reports the current request's viewport mode without importing server modules into browser bundles. */
export function registerViewportModeProbe(
  probe: () => ViewportMode | undefined,
): void {
  viewportModeProbe = probe;
}

/**
 * The one intent that lets an agent open a view: the user asked to see it.
 * Agents (built-in chat, MCP, WebMCP, A2A) leave the user's view alone
 * otherwise, so "mark X done" or "what's in my inbox" never opens items.
 */
export const NAVIGATION_OPEN_INTENT = "open" as const;
export type NavigationIntent = typeof NAVIGATION_OPEN_INTENT;

export type AgentNavigationKeptReason =
  | "detail-requires-open-intent"
  | "write-keeps-view"
  | "navigation-mode-keep"
  | "background-viewport-locked";

export type AgentNavigationRefusalReason =
  | "read-only-action"
  | AgentNavigationKeptReason;

export interface AgentNavigationKeptResult {
  kept: true;
  navigated: false;
  reason: AgentNavigationKeptReason;
  currentView: Record<string, unknown> | null;
  message: string;
}

export interface AgentNavigationRefusal {
  reason: AgentNavigationRefusalReason;
  message: string;
}

export type DetailViewPredicate = (
  navigation: Record<string, unknown>,
) => boolean;

export class AgentNavigationRefusedError extends Error {
  readonly code = "agent_navigation_refused";
  readonly reason: AgentNavigationRefusalReason;
  readonly currentView: Record<string, unknown> | null;
  constructor(
    message: string,
    options?: {
      reason?: AgentNavigationRefusalReason;
      currentView?: Record<string, unknown> | null;
    },
  ) {
    super(message);
    this.name = "AgentNavigationRefusedError";
    this.reason = options?.reason ?? "detail-requires-open-intent";
    this.currentView = options?.currentView ?? null;
  }
}

export function isAgentNavigationRefusedError(
  error: unknown,
): error is AgentNavigationRefusedError {
  return (
    error instanceof AgentNavigationRefusedError ||
    (Boolean(error) &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "agent_navigation_refused" &&
      typeof (error as { reason?: unknown }).reason === "string")
  );
}

export function isAgentNavigationKeptResult(
  value: unknown,
): value is AgentNavigationKeptResult {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kept?: unknown }).kept === true &&
    (value as { navigated?: unknown }).navigated === false &&
    typeof (value as { reason?: unknown }).reason === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function describeCurrentView(
  currentView: Record<string, unknown> | null,
): string | null {
  if (!currentView) return null;
  const mode = nonEmptyString(currentView.calendarViewMode);
  const view =
    nonEmptyString(currentView.view) ?? nonEmptyString(currentView.screen);
  if (view && mode) return `${view} (${mode})`;
  return mode ?? view ?? nonEmptyString(currentView.path);
}

export function buildAgentNavigationKeptResult(
  reason: AgentNavigationKeptReason,
  currentView: Record<string, unknown> | null = null,
): AgentNavigationKeptResult {
  const viewLabel = describeCurrentView(currentView);
  const keptClause = viewLabel
    ? `Kept the user on ${viewLabel}`
    : "Kept the user's current view";
  const detailClause =
    reason === "write-keeps-view"
      ? "after agent writes"
      : reason === "background-viewport-locked"
        ? "during a background viewport request"
        : "instead of opening the item";
  return {
    kept: true,
    navigated: false,
    reason,
    currentView,
    message: `${keptClause} (${detailClause}). Pass intent: "open" only if the user asked to open or switch to it.`,
  };
}

const AsyncLocalStorageCtor = getAsyncLocalStorageCtor();
const authorizedAgentNavigation = AsyncLocalStorageCtor
  ? new AsyncLocalStorageCtor<boolean>()
  : undefined;
const authorizedFrameworkUrlTool = AsyncLocalStorageCtor
  ? new AsyncLocalStorageCtor<boolean>()
  : undefined;

/**
 * Marks a navigate write as explicitly approved by a navigate action's own
 * policy check or by an intentional UI-opening write helper. Read-only actions
 * are still refused regardless.
 */
export function withAuthorizedAgentNavigation<T>(fn: () => T): T {
  if (!authorizedAgentNavigation) return fn();
  return authorizedAgentNavigation.run(true, fn);
}

export function isAgentNavigationAuthorized(): boolean {
  return authorizedAgentNavigation?.getStore() === true;
}

/**
 * Marks a `__set_url__` write from the framework's built-in URL tools
 * (`set-search-params`, `set-url-path`, `open-settings-page`).
 */
export function withAuthorizedFrameworkUrlTool<T>(fn: () => T): T {
  if (!authorizedFrameworkUrlTool) return fn();
  return authorizedFrameworkUrlTool.run(true, fn);
}

function isFrameworkUrlToolAuthorized(): boolean {
  return authorizedFrameworkUrlTool?.getStore() === true;
}

function isDetailKey(key: string): boolean {
  if (!key || key.startsWith("_")) return false;
  return (
    key === "id" ||
    (key.length > 2 && (key.endsWith("Id") || key.endsWith("_id")))
  );
}

function hasNonEmptyIdValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "number" && Number.isFinite(value);
}

function matchesDetailRoutePattern(
  segments: readonly string[],
  pattern: string,
): boolean {
  const patternSegments = pattern.trim().split("/").filter(Boolean);
  if (patternSegments.length === 0) return false;
  for (let i = 0; i < patternSegments.length; i += 1) {
    const part = patternSegments[i];
    if (!part) return false;
    if (part === "*") {
      return true;
    }
    if (i >= segments.length) return false;
    if (part.startsWith(":")) {
      if (!segments[i]) return false;
      continue;
    }
    if (segments[i] !== part) return false;
  }
  return segments.length === patternSegments.length;
}

function isDetailPath(path: string, detailRoutes?: readonly string[]): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  const hashIdx = trimmed.indexOf("#");
  const withoutHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
  const queryIdx = withoutHash.indexOf("?");
  const pathname = queryIdx >= 0 ? withoutHash.slice(0, queryIdx) : withoutHash;
  const query = queryIdx >= 0 ? withoutHash.slice(queryIdx + 1) : "";
  if (query) {
    for (const [k, v] of new URLSearchParams(query).entries()) {
      if (isDetailKey(k) && v.trim().length > 0) return true;
    }
  }
  const segments = pathname.split("/").filter(Boolean);
  const configuredRoutes = detailRoutes ?? getAppConfig().agent.detailRoutes;
  if (configuredRoutes !== undefined) {
    return configuredRoutes.some((pattern) =>
      matchesDetailRoutePattern(segments, pattern),
    );
  }
  if (segments.length < 2) return false;
  const [first] = segments;
  if (!first || first === "settings" || first.startsWith("_")) return false;
  return true;
}

/**
 * Default detail-view detector for navigate payloads: true when the command
 * targets a specific item (`id`, `*Id`, `*_id`, a detail query param, a route
 * matching the app's declared `agent.detailRoutes`, or—when none are declared—
 * a nested `/<section>/<item>` path outside `/settings`).
 */
export function isDefaultDetailNavigation(
  navigation: Record<string, unknown>,
  options?: { detailRoutes?: readonly string[] },
): boolean {
  for (const [key, val] of Object.entries(navigation)) {
    if (isDetailKey(key) && hasNonEmptyIdValue(val)) return true;
  }
  return (
    typeof navigation.path === "string" &&
    isDetailPath(navigation.path, options?.detailRoutes)
  );
}

function isNavigateKey(key: string): boolean {
  return key === "navigate" || key.startsWith("navigate:");
}

function isSetUrlKey(key: string): boolean {
  return key === "__set_url__" || key.startsWith("__set_url__:");
}

/** Maps a `navigate` or `__set_url__` command key to its matching `navigation` key. */
export function navigationKeyForCommandKey(key: string): string | null {
  if (key === "navigate" || key === "__set_url__") return "navigation";
  if (key.startsWith("navigate:")) {
    return `navigation:${key.slice("navigate:".length)}`;
  }
  if (key.startsWith("__set_url__:")) {
    return `navigation:${key.slice("__set_url__:".length)}`;
  }
  return null;
}

const BACKGROUND_VIEWPORT_REFUSAL: AgentNavigationRefusal = {
  reason: "background-viewport-locked",
  message:
    "Refused: background viewport requests cannot navigate the foreground app view.",
};

const READ_ONLY_REFUSAL: AgentNavigationRefusal = {
  reason: "read-only-action",
  message:
    'Refused: a read-only action cannot move the user\'s view. Read the data and answer; call navigate with intent: "open" only if the user asked to see it.',
};

const WRITE_KEEPS_VIEW_REFUSAL: AgentNavigationRefusal = {
  reason: "write-keeps-view",
  message:
    'Refused: a write action cannot move the user\'s view unless intent: "open" is set. Keep the user on their current view, or use navigateAfterWrite() so agent writes stay put.',
};

const DETAIL_REQUIRES_OPEN_REFUSAL: AgentNavigationRefusal = {
  reason: "detail-requires-open-intent",
  message:
    'Refused: opening this item would move the user off their current view. Call again with intent: "open" only if the user asked to open or show it; otherwise answer without navigating.',
};

/**
 * Shared keep-view policy for both the application-state store boundary and
 * `createNavigateAction()`:
 * - Reads never move the user's view.
 * - `intent: "open"`, `allowsAgentNavigation: true`, and explicit
 *   `withAuthorizedAgentNavigation` always allow navigation.
 * - Non-navigate write actions and nested calls inside a write action never
 *   move the user's view.
 * - Standalone `navigate` actions require `intent: "open"` for detail opens
 *   and after an observed write.
 */
export function evaluateAgentNavigationPolicy(
  navigation: Record<string, unknown> | undefined,
  options: {
    caller?: string | undefined;
    intent?: string | undefined;
    isDetailView?: DetailViewPredicate | undefined;
    isNavigateAction?: boolean | undefined;
    isSetUrl?: boolean | undefined;
  } = {},
): AgentNavigationRefusal | null {
  if (viewportModeProbe?.() === "background") {
    return BACKGROUND_VIEWPORT_REFUSAL;
  }
  const originCaller = currentActionOriginCaller() ?? options.caller;
  const mode =
    options.intent ??
    navigation?.navigationMode ??
    currentActionNavigationIntent();
  if (options.isSetUrl && isFrameworkUrlToolAuthorized() && mode !== "keep")
    return null;
  if (isAgentCaller(originCaller) && insideReadOnlyAction())
    return READ_ONLY_REFUSAL;
  if (mode === "keep") {
    return {
      reason: "navigation-mode-keep",
      message: "Kept the current view as requested.",
    };
  }
  if (!isAgentCaller(originCaller)) return null;

  if (
    isAgentNavigationAuthorized() ||
    currentActionAllowsAgentNavigation() ||
    mode === NAVIGATION_OPEN_INTENT ||
    mode === "reveal"
  ) {
    return null;
  }
  const standaloneNavigate =
    !insideParentWriteAction() &&
    (options.isNavigateAction === true || isStandaloneNavigateAction());
  if (
    insideParentWriteAction() ||
    (insideWriteAction() && !standaloneNavigate)
  ) {
    return WRITE_KEEPS_VIEW_REFUSAL;
  }
  const detailPayload =
    options.isSetUrl && navigation && typeof navigation.pathname === "string"
      ? { path: navigation.pathname }
      : navigation;
  const isDetailView = options.isDetailView ?? isDefaultDetailNavigation;
  if (detailPayload && isDetailView(detailPayload)) {
    return DETAIL_REQUIRES_OPEN_REFUSAL;
  }
  if (hasObservedWriteInActionChain()) {
    return WRITE_KEEPS_VIEW_REFUSAL;
  }
  return null;
}

/**
 * Evaluates whether a `navigate` or `__set_url__` command write is allowed at
 * the application-state store boundary. Returns `null` when allowed or the
 * typed refusal otherwise.
 */
export function evaluateNavigateWrite(
  key: string,
  value?: Record<string, unknown>,
): AgentNavigationRefusal | null {
  const isSetUrl = isSetUrlKey(key);
  if (!isNavigateKey(key) && !isSetUrl) return null;
  return evaluateAgentNavigationPolicy(value, { isSetUrl });
}

/**
 * Guards every `navigate` and `__set_url__` command write (account-wide or
 * tab-scoped) at the application-state store boundary so no helper or
 * hand-written navigate action can bypass the keep-view contract during an
 * agent call.
 */
export function assertNavigateWriteAllowed(
  key: string,
  value?: Record<string, unknown>,
): void {
  const refusal = evaluateNavigateWrite(key, value);
  if (!refusal) return;
  throw new AgentNavigationRefusedError(refusal.message, {
    reason: refusal.reason,
  });
}
