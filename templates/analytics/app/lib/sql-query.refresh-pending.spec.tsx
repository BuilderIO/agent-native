// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => ({
    session: { email: "a@example.com", userId: "user-a", orgId: "org-1" },
    status: "authenticated",
  }),
}));

vi.mock("./cost-tracker", () => ({
  addBytesProcessed: vi.fn(),
  recordQueryCost: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { REFRESH_PENDING_POLL_MS, useSqlQuery } from "./sql-query";

const DESCRIPTOR = JSON.stringify({ programId: "dp_collector" });

function Probe({ refreshToken }: { refreshToken: number }) {
  const query = useSqlQuery(["sql", DESCRIPTOR], DESCRIPTOR, "program", {
    refreshToken,
  });
  return (
    <div>
      <span data-rows>{String(query.data?.rows[0]?.value)}</span>
      <span data-completed>{String(query.completedManualRefreshToken)}</span>
    </div>
  );
}

describe("useSqlQuery with a data program refresh still running", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let answers: Record<string, unknown>[];

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient();
    answers = [];
    mocks.callAction.mockReset();
    mocks.callAction.mockImplementation(async () => {
      const answer = answers.shift();
      if (!answer) throw new Error("no answer queued");
      return { schema: [], fetchedAt: new Date().toISOString(), ...answer };
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const render = (refreshToken: number) =>
    act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe refreshToken={refreshToken} />
        </QueryClientProvider>,
      );
      await vi.advanceTimersByTimeAsync(5);
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const shown = (name: string) =>
    container.querySelector(`[data-${name}]`)?.textContent;
  const forced = () =>
    mocks.callAction.mock.calls.map(([, args]) => args.forceRefresh === true);

  it("reads again until the queued run's rows arrive, then confirms the refresh", async () => {
    answers.push({ rows: [{ value: "old" }], cached: true });
    await render(0);
    expect(shown("rows")).toBe("old");

    answers.push(
      { rows: [{ value: "old" }], cached: true, refreshPending: true },
      { rows: [{ value: "old" }], cached: true, refreshPending: true },
      { rows: [{ value: "new" }], cached: true },
    );
    await render(1);
    expect(forced()).toEqual([false, true]);
    expect(shown("rows")).toBe("old");
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS);
    expect(forced()).toEqual([false, true, false]);
    expect(shown("rows")).toBe("old");
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS);
    expect(forced()).toEqual([false, true, false, false]);
    expect(shown("rows")).toBe("new");
    expect(shown("completed")).toBe("1");

    await advance(REFRESH_PENDING_POLL_MS * 4);
    expect(mocks.callAction).toHaveBeenCalledTimes(4);
  });

  it("doesn't read again when no run is pending", async () => {
    answers.push({ rows: [{ value: "old" }], cached: true });
    await render(0);

    await advance(REFRESH_PENDING_POLL_MS * 4);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });
});
