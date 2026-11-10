import {
  findLastUsedBrowserTab,
  LAST_USED_BROWSER_TAB_MAX_AGE_MS,
} from "../application-state/last-used-tab.js";
import {
  getRequestUserEmail,
  type BrowserTabTarget,
  type BrowserTabTargetSlot,
} from "../server/request-context.js";

/**
 * An MCP tool call comes from no browser tab, so tab-scoped app state
 * (navigation, navigate commands, selection) would otherwise fall back to
 * account-wide rows no tab keeps current. This slot points the call at the
 * tab of this app the user used last. The lookup runs only when the call
 * first reads or writes tab-scoped state.
 */
export function createBrowserTabTargetSlot(): BrowserTabTargetSlot {
  let pending: Promise<BrowserTabTarget> | undefined;
  const slot: BrowserTabTargetSlot = {
    resolve() {
      pending ??= (async () => {
        const userEmail = getRequestUserEmail();
        const target: BrowserTabTarget = userEmail
          ? await findLastUsedBrowserTab(userEmail)
          : { kind: "unavailable" };
        slot.resolved = target;
        return target;
      })();
      return pending;
    },
  };
  return slot;
}

function usedAgo(usedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - usedAt) / 60_000);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/**
 * Tells the calling agent which tab a call's tab-scoped reads and writes
 * reached, since nothing in the call itself says so.
 */
export function browserTabTargetNote(
  target: BrowserTabTarget,
  now = Date.now(),
): string {
  if (target.kind === "last-used") {
    return `Browser tab: this call used the user's most recently used tab of this app (last used ${usedAgo(target.usedAt, now)}). A navigate command reaches that tab only while it stays open, and this result doesn't confirm that it moved.`;
  }
  const hours = Math.round(LAST_USED_BROWSER_TAB_MAX_AGE_MS / 3_600_000);
  return `Browser tab: no tab of this app was used in the last ${hours} hours, so there was no on-screen state to read and a navigate command won't move any tab. Ask the user to open the app in a browser tab, then retry.`;
}

/** Adds the tab note to a successful tool result that used tab-scoped state. */
export function withBrowserTabTargetNote<T>(
  result: T,
  slot: BrowserTabTargetSlot | undefined,
): T {
  const target = slot?.resolved;
  if (!target || !result || typeof result !== "object") return result;
  const { content, isError } = result as {
    content?: unknown;
    isError?: unknown;
  };
  if (isError === true || !Array.isArray(content)) return result;
  return {
    ...result,
    content: [...content, { type: "text", text: browserTabTargetNote(target) }],
  };
}
