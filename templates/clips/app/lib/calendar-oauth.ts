import { callAction } from "@agent-native/core/client/hooks";

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
  // Open the popup on the click itself: browsers drop the click's user
  // activation while the OAuth URL request is in flight, and would then block
  // a popup opened after it.
  const popup = window.open(
    "about:blank",
    "clips-calendar-oauth",
    "width=600,height=700",
  );
  if (!popup) throw new PopupBlockedError();
  let url: string;
  const flowId = window.crypto.randomUUID();
  try {
    url = await fetchCalendarOAuthUrl(flowId, expectedAccountId);
  } catch (error) {
    popup.close();
    throw error;
  }
  // Closed while the URL was loading: an ordinary cancel, not an error.
  if (popup.closed) return null;
  popup.location.href = new URL(url, window.location.origin).toString();
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

async function fetchCalendarOAuthUrl(
  flowId: string,
  expectedAccountId: string | undefined,
): Promise<string> {
  const result = await callAction<{ url?: string }>(
    "connect-calendar",
    {
      provider: "google",
      flowId,
      ...(expectedAccountId ? { calendarAccountId: expectedAccountId } : {}),
    },
    { method: "GET" },
  );
  if (!result?.url) throw new Error("No OAuth URL returned");
  return result.url;
}
