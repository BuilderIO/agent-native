import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  addSurfaceVisibilityListener,
  isSurfaceHidden,
} from "@agent-native/core/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type CalendarConnectionAccount,
  findUnreportedCalendarConnection,
  isCalendarConnectionComplete,
} from "@/lib/calendar-connection";
import { startCalendarOAuth } from "@/lib/calendar-oauth";
import { PopupBlockedError } from "@/lib/popup-blocked";

const REPORTED_CONNECTION_CHECKS = 10;
const REPORTED_CONNECTION_CHECK_INTERVAL_MS = 500;
const LATE_CONNECTION_WATCH_MS = 5 * 60 * 1000;
const LATE_CONNECTION_RECHECKS_MS = [
  2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 240_000,
];
const CALENDAR_ACCOUNTS_QUERY_KEY = ["action", "list-calendar-accounts"];
const MEETINGS_QUERY_KEY = ["action", "list-meetings"];
const CALENDARS_QUERY_KEY = ["action", "list-calendars"];

async function readCalendarAccounts(): Promise<
  CalendarConnectionAccount[] | null
> {
  try {
    const result = await callAction<{ accounts: CalendarConnectionAccount[] }>(
      "list-calendar-accounts",
      {},
      { method: "GET" },
    );
    return result.accounts;
  } catch {
    // coercion-ok: null means "not confirmed yet"; the query refresh that follows shows a load error
    return null;
  }
}

async function waitForReportedConnection(
  completedAccountId: string,
  expectedAccountId: string | undefined,
  signal: AbortSignal,
): Promise<boolean> {
  for (let check = 0; check < REPORTED_CONNECTION_CHECKS; check += 1) {
    if (check > 0) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, REPORTED_CONNECTION_CHECK_INTERVAL_MS),
      );
    }
    if (signal.aborted) return false;
    const accounts = await readCalendarAccounts();
    if (
      accounts &&
      isCalendarConnectionComplete(
        accounts,
        completedAccountId,
        expectedAccountId,
      )
    ) {
      return true;
    }
  }
  return false;
}

async function hasUnreportedConnection(
  previousAccounts: CalendarConnectionAccount[],
  expectedAccountId: string | undefined,
): Promise<boolean> {
  const accounts = await readCalendarAccounts();
  return (
    accounts !== null &&
    findUnreportedCalendarConnection(
      previousAccounts,
      accounts,
      expectedAccountId,
    ) !== null
  );
}

function waitForVisibleSurface(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const isReady = () => signal.aborted || !isSurfaceHidden();
    if (isReady()) {
      resolve();
      return;
    }
    const settle = () => {
      if (!isReady()) return;
      stopListening();
      signal.removeEventListener("abort", settle);
      resolve();
    };
    const stopListening = addSurfaceVisibilityListener(settle);
    signal.addEventListener("abort", settle);
  });
}

function trackSurfaceHidden() {
  let hidden = isSurfaceHidden();
  const stop = addSurfaceVisibilityListener(() => {
    if (isSurfaceHidden()) hidden = true;
  });
  return { wasHidden: () => hidden, stop };
}

async function refreshWhileVisible(
  queryClient: QueryClient,
  queryKey: string[],
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    await waitForVisibleSurface(signal);
    if (signal.aborted) return;
    const surface = trackSurfaceHidden();
    try {
      await queryClient.invalidateQueries({ queryKey });
    } finally {
      surface.stop();
    }
    if (!surface.wasHidden()) return;
  }
}

function watchForLateConnection(
  check: () => Promise<boolean>,
  onConnected: () => void,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  let checking = false;
  let checkAgain = false;
  let stopped = false;
  const checkWhenVisible = () => {
    if (stopped || isSurfaceHidden()) return;
    if (checking) {
      checkAgain = true;
      return;
    }
    checking = true;
    checkAgain = false;
    void check().then((connected) => {
      checking = false;
      if (connected) {
        stop();
        onConnected();
      } else if (checkAgain) {
        checkWhenVisible();
      }
    });
  };
  const stopListening = addSurfaceVisibilityListener(checkWhenVisible);
  window.addEventListener("focus", checkWhenVisible);
  const rechecks = LATE_CONNECTION_RECHECKS_MS.map((delay) =>
    window.setTimeout(checkWhenVisible, delay),
  );
  const deadline = window.setTimeout(() => stop(), LATE_CONNECTION_WATCH_MS);
  const stop = () => {
    stopped = true;
    rechecks.forEach((recheck) => window.clearTimeout(recheck));
    window.clearTimeout(deadline);
    window.removeEventListener("focus", checkWhenVisible);
    stopListening();
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop);
}

export function useCalendarConnect(accounts: CalendarConnectionAccount[]) {
  const t = useT();
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const inFlightRef = useRef(false);
  const attemptRef = useRef<AbortController | null>(null);

  useEffect(() => () => attemptRef.current?.abort(), []);

  const connect = useCallback(
    (expectedAccountId?: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsConnecting(true);
      attemptRef.current?.abort();
      const attempt = new AbortController();
      attemptRef.current = attempt;
      const { signal } = attempt;
      const previousAccounts = accounts;

      const refresh = async (connected: boolean) => {
        void refreshWhileVisible(queryClient, MEETINGS_QUERY_KEY, signal);
        void refreshWhileVisible(queryClient, CALENDARS_QUERY_KEY, signal);
        await refreshWhileVisible(
          queryClient,
          CALENDAR_ACCOUNTS_QUERY_KEY,
          signal,
        );
        if (connected && !signal.aborted) {
          toast.success(t("meetingsRoute.calendarConnected"));
        }
      };
      const checkUnreported = async () => {
        await waitForVisibleSurface(signal);
        if (signal.aborted) return false;
        return hasUnreportedConnection(previousAccounts, expectedAccountId);
      };

      void (async () => {
        try {
          const result = await startCalendarOAuth(expectedAccountId);
          if (signal.aborted) return;
          if (result) {
            await refresh(
              await waitForReportedConnection(
                result.accountId,
                expectedAccountId,
                signal,
              ),
            );
            return;
          }
          const connected = await checkUnreported();
          await refresh(connected);
          if (!connected) {
            watchForLateConnection(
              checkUnreported,
              () => void refresh(true),
              signal,
            );
          }
        } catch (err) {
          toast.error(
            err instanceof PopupBlockedError
              ? t("clipsSettings.popupBlocked")
              : err instanceof Error
                ? err.message
                : "Couldn't connect your calendar",
          );
        } finally {
          inFlightRef.current = false;
          setIsConnecting(false);
        }
      })();
    },
    [accounts, queryClient, t],
  );

  return { connect, isConnecting };
}
