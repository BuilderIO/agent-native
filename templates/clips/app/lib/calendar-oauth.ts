import { agentNativePath } from "@agent-native/core/client/api-path";

import { PopupBlockedError } from "./popup-blocked";

export interface CalendarOAuthResult {
  accountId: string;
}

/**
 * Opens Google Calendar OAuth in a popup and resolves with the connected
 * account id, or null when the popup closes (or times out) without one.
 */
export async function startCalendarOAuth(
  expectedAccountId?: string,
): Promise<CalendarOAuthResult | null> {
  const flowId = window.crypto.randomUUID();
  const actionUrl = new URL(
    agentNativePath("/_agent-native/actions/connect-calendar"),
    window.location.origin,
  );
  actionUrl.searchParams.set("provider", "google");
  actionUrl.searchParams.set("flowId", flowId);
  if (expectedAccountId) {
    actionUrl.searchParams.set("calendarAccountId", expectedAccountId);
  }
  const r = await fetch(actionUrl);
  const text = await r.text();
  let data: {
    url?: string;
    error?: string;
    result?: { url?: string };
  } = {};
  try {
    data = JSON.parse(text);
    // coercion-ok: a body that isn't JSON still throws below, as "Failed (status)" or "No OAuth URL returned".
  } catch {
    // Keep the fallback below.
  }
  if (!r.ok) throw new Error(data.error || `Failed (${r.status})`);
  const url = data.result?.url ?? data.url;
  if (!url) throw new Error("No OAuth URL returned");
  const authUrl = new URL(url, window.location.origin);
  const popupUrl = authUrl.toString();
  const popup = window.open(
    popupUrl,
    "clips-calendar-oauth",
    "width=600,height=700",
  );
  if (!popup) throw new PopupBlockedError();
  return await new Promise<CalendarOAuthResult | null>((resolve) => {
    let settled = false;
    const finish = (result: CalendarOAuthResult | null) => {
      if (settled) return;
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const interval = window.setInterval(() => {
      if (popup.closed) finish(null);
    }, 500);
    // Some browsers (COOP) never report popup.closed; also resolve when the
    // user returns to this tab, and give up after 5 minutes regardless so the
    // connect flow can't hang forever.
    const onFocus = () => {
      if (popup.closed) finish(null);
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== popup ||
        event.origin !== window.location.origin ||
        !event.data ||
        typeof event.data !== "object" ||
        event.data.type !== "agent-native:calendar-connected" ||
        event.data.flowId !== flowId ||
        typeof event.data.accountId !== "string"
      ) {
        return;
      }
      finish({ accountId: event.data.accountId });
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("message", onMessage);
    const timeout = window.setTimeout(() => finish(null), 5 * 60 * 1000);
  });
}
