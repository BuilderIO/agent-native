// @vitest-environment happy-dom

import {
  SURFACE_HIDDEN_FLAG,
  SURFACE_VISIBILITY_EVENT,
} from "@agent-native/core/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarConnectionAccount } from "@/lib/calendar-connection";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  invalidateQueries: vi.fn(),
  startCalendarOAuth: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mocks.callAction(...args),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/calendar-oauth", () => ({
  startCalendarOAuth: (...args: unknown[]) => mocks.startCalendarOAuth(...args),
}));

import { PopupBlockedError } from "@/lib/popup-blocked";

import { useCalendarConnect } from "./use-calendar-connect";

const stale = { id: "cal-1", status: "needs-reauth" };
const reconnected = { id: "cal-1", status: "connected" };
const ACCOUNTS_KEY = ["action", "list-calendar-accounts"];
const MEETINGS_KEY = ["action", "list-meetings"];
const CALENDARS_KEY = ["action", "list-calendars"];

let container: HTMLDivElement;
let root: Root;
let connect: (expectedAccountId?: string) => void;
let isConnecting = false;

function Probe({ accounts }: { accounts: CalendarConnectionAccount[] }) {
  const state = useCalendarConnect(accounts);
  connect = state.connect;
  isConnecting = state.isConnecting;
  return null;
}

function setHostSurfaceHidden(hidden: boolean) {
  (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG] = hidden;
  window.dispatchEvent(new Event(SURFACE_VISIBILITY_EVENT));
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

function invalidations(queryKey: string[]) {
  return mocks.invalidateQueries.mock.calls.filter(
    ([filters]) =>
      JSON.stringify((filters as { queryKey: unknown }).queryKey) ===
      JSON.stringify(queryKey),
  ).length;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  mocks.invalidateQueries.mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<Probe accounts={[stale]} />));
});

afterEach(() => {
  act(() => root.unmount());
  delete (window as unknown as Record<string, unknown>)[SURFACE_HIDDEN_FLAG];
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCalendarConnect", () => {
  it("refreshes after a reconnect the popup never reported", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [reconnected] });

    act(() => connect("cal-1"));
    await flush();

    expect(mocks.startCalendarOAuth).toHaveBeenCalledWith("cal-1");
    expect(mocks.callAction).toHaveBeenCalledWith(
      "list-calendar-accounts",
      {},
      { method: "GET" },
    );
    expect(invalidations(ACCOUNTS_KEY)).toBe(1);
    expect(invalidations(MEETINGS_KEY)).toBe(1);
    expect(invalidations(CALENDARS_KEY)).toBe(1);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );
    expect(isConnecting).toBe(false);
  });

  it("refreshes quietly when the popup was cancelled", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [stale] });

    act(() => connect("cal-1"));
    await flush();

    expect(invalidations(ACCOUNTS_KEY)).toBe(1);
    expect(invalidations(MEETINGS_KEY)).toBe(1);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(isConnecting).toBe(false);
  });

  it("catches a reconnect that finishes after the popup reads as closed", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [stale] });

    act(() => connect("cal-1"));
    await flush();
    expect(mocks.toast.success).not.toHaveBeenCalled();

    mocks.callAction.mockResolvedValue({ accounts: [reconnected] });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(invalidations(ACCOUNTS_KEY)).toBe(2);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
  });

  it("checks again when a focus lands during a late-reconnect read", async () => {
    let finishRead: (value: {
      accounts: CalendarConnectionAccount[];
    }) => void = () => {};
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction
      .mockResolvedValueOnce({ accounts: [stale] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishRead = resolve;
        }),
      )
      .mockResolvedValue({ accounts: [reconnected] });

    act(() => connect("cal-1"));
    await flush();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(2);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(2);

    finishRead({ accounts: [stale] });
    await flush();

    expect(mocks.callAction).toHaveBeenCalledTimes(3);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );
  });

  it("re-checks on its own soon after the popup ends without reporting", async () => {
    vi.useFakeTimers();
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [stale] });

    act(() => connect("cal-1"));
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    mocks.callAction.mockResolvedValue({ accounts: [reconnected] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await flush();

    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );
  });

  it("stops watching for a late reconnect after five minutes", async () => {
    vi.useFakeTimers();
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [stale] });

    act(() => connect("cal-1"));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    const reads = mocks.callAction.mock.calls.length;
    expect(reads).toBeGreaterThan(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(reads);
  });

  it("waits for a reported account to read as connected", async () => {
    vi.useFakeTimers();
    mocks.startCalendarOAuth.mockResolvedValue({ accountId: "cal-1" });
    mocks.callAction
      .mockResolvedValueOnce({ accounts: [stale] })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ accounts: [reconnected] });

    act(() => connect("cal-1"));
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await flush();

    expect(mocks.callAction).toHaveBeenCalledTimes(3);
    expect(invalidations(ACCOUNTS_KEY)).toBe(1);
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );
  });

  it("stops reading a reported account once the caller unmounts", async () => {
    vi.useFakeTimers();
    mocks.startCalendarOAuth.mockResolvedValue({ accountId: "cal-1" });
    mocks.callAction.mockResolvedValue({ accounts: [stale] });

    act(() => connect("cal-1"));
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    act(() => root.render(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("holds the refresh until a hidden page is visible again", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [reconnected] });
    setDocumentHidden(true);

    act(() => connect("cal-1"));
    await flush();

    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(isConnecting).toBe(true);

    act(() => setDocumentHidden(false));
    await flush();

    expect(invalidations(ACCOUNTS_KEY)).toBe(1);
    expect(invalidations(MEETINGS_KEY)).toBe(1);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );
    expect(isConnecting).toBe(false);
  });

  it("refreshes again when the page hides during the refresh", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [reconnected] });
    let hid = false;
    mocks.invalidateQueries.mockImplementation(
      async ({ queryKey }: { queryKey: string[] }) => {
        if (hid || queryKey[1] !== "list-calendar-accounts") return;
        hid = true;
        setHostSurfaceHidden(true);
      },
    );

    act(() => connect("cal-1"));
    await flush();

    expect(invalidations(ACCOUNTS_KEY)).toBe(1);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(isConnecting).toBe(true);

    act(() => setHostSurfaceHidden(false));
    await flush();

    expect(invalidations(ACCOUNTS_KEY)).toBe(2);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "meetingsRoute.calendarConnected",
    );
    expect(isConnecting).toBe(false);
  });

  it("drops the attempt when the caller unmounts while the page is hidden", async () => {
    mocks.startCalendarOAuth.mockResolvedValue(null);
    mocks.callAction.mockResolvedValue({ accounts: [reconnected] });
    setHostSurfaceHidden(true);

    act(() => connect("cal-1"));
    await flush();
    act(() => root.render(null));
    act(() => setHostSurfaceHidden(false));
    await flush();

    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("reports a blocked popup without refreshing", async () => {
    mocks.startCalendarOAuth.mockRejectedValue(new PopupBlockedError());

    act(() => connect());
    await flush();

    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "clipsSettings.popupBlocked",
    );
  });

  it("ignores a second connect while one is running", async () => {
    let finish: (value: null) => void = () => {};
    mocks.startCalendarOAuth.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.callAction.mockResolvedValue({ accounts: [stale] });

    act(() => connect());
    act(() => connect());
    expect(mocks.startCalendarOAuth).toHaveBeenCalledTimes(1);

    finish(null);
    await flush();
    expect(isConnecting).toBe(false);
  });
});
