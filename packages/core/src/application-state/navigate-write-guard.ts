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
import { getAsyncLocalStorageCtor } from "../shared/optional-node-builtins.js";

/**
 * The one intent that lets an agent open a view: the user asked to see it.
 * Agents (built-in chat, MCP, WebMCP, A2A) leave the user's view alone
 * otherwise, so "mark X done" or "what's in my inbox" never opens items.
 */
export const NAVIGATION_OPEN_INTENT = "open" as const;
export type NavigationIntent = typeof NAVIGATION_OPEN_INTENT;

export class AgentNavigationRefusedError extends Error {
  readonly code = "agent_navigation_refused";
  constructor(message: string) {
    super(message);
    this.name = "AgentNavigationRefusedError";
  }
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

function isDetailPath(path: string): boolean {
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
  if (segments.length < 2) return false;
  const [first, second] = segments;
  if (!first || first === "settings" || first.startsWith("_")) return false;
  if (first === "admin") {
    return segments.length >= 3 && second !== "integrations";
  }
  return true;
}

/**
 * Default detail-view detector for navigate payloads: true when the command
 * targets a specific item (`id`, `*Id`, `*_id`, a detail query param, a nested
 * `/<section>/<item>` path outside `/settings`, or a nested item path under
 * `/admin/<section>/<id>` outside `/admin/integrations`).
 */
export function isDefaultDetailNavigation(
  navigation: Record<string, unknown>,
): boolean {
  for (const [key, val] of Object.entries(navigation)) {
    if (isDetailKey(key) && hasNonEmptyIdValue(val)) return true;
  }
  return typeof navigation.path === "string" && isDetailPath(navigation.path);
}

function isNavigateKey(key: string): boolean {
  return key === "navigate" || key.startsWith("navigate:");
}

function isSetUrlKey(key: string): boolean {
  return key === "__set_url__" || key.startsWith("__set_url__:");
}

/**
 * Guards every `navigate` and `__set_url__` command write (account-wide or
 * tab-scoped) at the application-state store boundary so no helper or
 * hand-written navigate action can bypass the keep-view contract during an
 * agent call:
 * - Reads never move the user's view.
 * - Edits/writes never move the user's view unless `intent: "open"` is set.
 * - Detail opens require `intent: "open"`.
 */
export function assertNavigateWriteAllowed(
  key: string,
  value?: Record<string, unknown>,
): void {
  const isSetUrl = isSetUrlKey(key);
  if (!isNavigateKey(key) && !isSetUrl) return;
  if (!isAgentCaller(currentActionOriginCaller())) return;
  if (isSetUrl && isFrameworkUrlToolAuthorized()) return;
  if (insideReadOnlyAction()) {
    throw new AgentNavigationRefusedError(
      'Refused: a read-only action cannot move the user\'s view. Read the data and answer; call navigate with intent: "open" only if the user asked to see it.',
    );
  }
  if (
    isAgentNavigationAuthorized() ||
    currentActionAllowsAgentNavigation() ||
    currentActionNavigationIntent() === NAVIGATION_OPEN_INTENT
  ) {
    return;
  }
  if (
    insideParentWriteAction() ||
    hasObservedWriteInActionChain() ||
    (insideWriteAction() && !isStandaloneNavigateAction())
  ) {
    throw new AgentNavigationRefusedError(
      'Refused: a write action cannot move the user\'s view unless intent: "open" is set. Keep the user on their current view, or use navigateAfterWrite() so agent writes stay put.',
    );
  }
  const detailPayload =
    isSetUrl && value && typeof value.pathname === "string"
      ? { path: value.pathname }
      : value;
  if (detailPayload && isDefaultDetailNavigation(detailPayload)) {
    throw new AgentNavigationRefusedError(
      'Refused: opening this item would move the user off their current view. Call again with intent: "open" only if the user asked to open or show it; otherwise answer without navigating.',
    );
  }
}
