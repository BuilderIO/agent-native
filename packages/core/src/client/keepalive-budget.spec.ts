import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./analytics.js", () => ({ trackEvent: vi.fn() }));
vi.mock("./use-session.js", () => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));

import {
  ACTION_KEEPALIVE_BODY_BUDGET_BYTES,
  KEEPALIVE_PAGE_LIMIT_BYTES,
} from "./keepalive-budget.js";

const APP_STATE_ROOM =
  KEEPALIVE_PAGE_LIMIT_BYTES - ACTION_KEEPALIVE_BODY_BUDGET_BYTES;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("keepalive budget", () => {
  async function freshBudget() {
    vi.resetModules();
    return import("./keepalive-budget.js");
  }

  it("keeps room for an action body of the largest size", async () => {
    const budget = await freshBudget();
    expect(budget.availableKeepaliveBytes("app-state")).toBe(APP_STATE_ROOM);
    expect(budget.availableKeepaliveBytes("action")).toBe(
      ACTION_KEEPALIVE_BODY_BUDGET_BYTES,
    );

    const appState = budget.reserveKeepaliveBytes("app-state", APP_STATE_ROOM);
    expect(appState).toBeDefined();
    expect(budget.reserveKeepaliveBytes("app-state", 1)).toBeUndefined();
    const action = budget.reserveKeepaliveBytes(
      "action",
      ACTION_KEEPALIVE_BODY_BUDGET_BYTES,
    );
    expect(action).toBeDefined();
    expect(budget.availableKeepaliveBytes("action")).toBe(0);
  });

  it("gives application state the room an action in flight leaves", async () => {
    const budget = await freshBudget();
    const action = budget.reserveKeepaliveBytes("action", 40_000);
    // The action can still grow to its cap, and application state gets what
    // is left of the page's allowance after that.
    expect(budget.availableKeepaliveBytes("action")).toBe(8_000);
    expect(budget.availableKeepaliveBytes("app-state")).toBe(APP_STATE_ROOM);
    action?.();
    action?.();
    expect(budget.availableKeepaliveBytes("action")).toBe(
      ACTION_KEEPALIVE_BODY_BUDGET_BYTES,
    );
  });
});

describe("a page that hides with application state and a document save to send", () => {
  // A browser refuses a keepalive request once the keepalive bodies in flight
  // from the page pass 64 KiB.
  function browserLikeFetch() {
    let inFlight = 0;
    const refused: string[] = [];
    const finishers: Array<() => void> = [];
    const fetchMock = vi.fn(
      (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const bytes = init?.keepalive
          ? new TextEncoder().encode(String(init.body ?? "")).length
          : 0;
        if (inFlight + bytes > KEEPALIVE_PAGE_LIMIT_BYTES) {
          refused.push(String(url));
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        inFlight += bytes;
        // Every request stays open until the test finishes it, like a page
        // whose requests are still on the wire as it goes away.
        return new Promise<Response>((resolve) => {
          finishers.push(() => {
            inFlight -= bytes;
            resolve(
              new Response(String(init?.body ?? "null"), {
                headers: { "Content-Type": "application/json" },
              }),
            );
          });
        });
      },
    );
    const finishAll = () => {
      for (const finish of finishers.splice(0)) finish();
    };
    return { fetchMock, refused, finishAll };
  }

  async function hidingPage() {
    vi.resetModules();
    const listeners: Record<string, Array<() => void>> = {};
    const listen = (type: string, listener: () => void) => {
      (listeners[type] ??= []).push(listener);
    };
    vi.stubGlobal("window", {
      location: { pathname: "/" },
      addEventListener: listen,
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: listen,
    });
    const browser = browserLikeFetch();
    vi.stubGlobal("fetch", browser.fetchMock);
    const appState = await import("./application-state.js");
    const actions = await import("./use-action.js");
    const hide = () => {
      for (const listener of listeners.pagehide ?? []) listener();
    };
    return { appState, actions, hide, ...browser };
  }

  const keepaliveOf = (
    fetchMock: ReturnType<typeof vi.fn>,
    match: (url: string) => boolean,
  ) =>
    fetchMock.mock.calls
      .filter(([url]) => match(String(url)))
      .map(([, init]) => (init as RequestInit | undefined)?.keepalive);

  it("sends the document save when application state hides first", async () => {
    const { appState, actions, hide, fetchMock, refused, finishAll } =
      await hidingPage();
    const state = appState.writeClientAppState("draft", "s".repeat(40_000));
    hide();
    const save = actions.tryCallActionKeepalive("update-document", {
      content: "d".repeat(40_000),
    });

    expect(save.accepted).toBe(true);
    expect(refused).toEqual([]);
    expect(
      keepaliveOf(fetchMock, (url) => url.endsWith("/update-document")),
    ).toEqual([true]);
    // Application state's write didn't fit beside room for the save, so it
    // went as an ordinary request.
    expect(
      keepaliveOf(fetchMock, (url) => url.includes("/application-state")),
    ).toEqual([false]);
    finishAll();
    await state;
    if (save.accepted) await save.completion;
  });

  it("keeps application state's flush out of the room a save in flight needs", async () => {
    const { appState, actions, hide, fetchMock, refused, finishAll } =
      await hidingPage();
    const save = actions.tryCallActionKeepalive("update-document", {
      content: "d".repeat(40_000),
    });
    const large = appState.writeClientAppState("draft", "s".repeat(40_000));
    const small = appState.writeClientAppState("selection", "x".repeat(2_000));
    hide();

    expect(save.accepted).toBe(true);
    expect(refused).toEqual([]);
    const stateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/application-state"),
    );
    // The small write still survives the page; the large one doesn't fit.
    expect(
      stateCalls.map(([url, init]) => [
        String(url).split("/").pop(),
        (init as RequestInit).keepalive,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["draft", false],
        ["selection", true],
      ]),
    );
    finishAll();
    await Promise.all([large, small]);
    if (save.accepted) await save.completion;
  });
});
