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
const OLD = {
  rows: [{ value: "old" }],
  cached: true,
  fetchedAt: "2026-11-23T10:00:00.000Z",
};
const NEW = {
  rows: [{ value: "new" }],
  cached: true,
  fetchedAt: "2026-11-23T10:05:00.000Z",
};

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
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const settle = (calls: number) =>
    act(async () => {
      await vi.waitFor(() => {
        expect(mocks.callAction).toHaveBeenCalledTimes(calls);
        expect(queryClient.isFetching()).toBe(0);
      });
    });
  const shown = (name: string) =>
    container.querySelector(`[data-${name}]`)?.textContent;
  const forced = () =>
    mocks.callAction.mock.calls.map(([, args]) => args.forceRefresh === true);

  it("reads again until the queued run's rows arrive, then confirms the refresh", async () => {
    answers.push(OLD);
    await render(0);
    await settle(1);
    expect(shown("rows")).toBe("old");

    answers.push(
      { ...OLD, refreshPending: true },
      { ...OLD, refreshPending: true },
      NEW,
    );
    await render(1);
    await settle(2);
    expect(forced()).toEqual([false, true]);
    expect(shown("rows")).toBe("old");
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS);
    await settle(3);
    expect(forced()).toEqual([false, true, false]);
    expect(shown("rows")).toBe("old");
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS);
    await settle(4);
    expect(forced()).toEqual([false, true, false, false]);
    expect(shown("rows")).toBe("new");
    expect(shown("completed")).toBe("1");

    await advance(REFRESH_PENDING_POLL_MS * 4);
    expect(mocks.callAction).toHaveBeenCalledTimes(4);
  });

  it("stops reading without confirming when the queued run leaves only the old rows", async () => {
    answers.push(OLD);
    await render(0);
    await settle(1);

    answers.push({ ...OLD, refreshPending: true }, OLD);
    await render(1);
    await settle(2);
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS);
    await settle(3);
    expect(forced()).toEqual([false, true, false]);
    expect(shown("rows")).toBe("old");
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS * 4);
    expect(mocks.callAction).toHaveBeenCalledTimes(3);
  });

  it("stops reading when a read fails while a run is pending", async () => {
    answers.push(OLD);
    await render(0);
    await settle(1);

    answers.push({ ...OLD, refreshPending: true });
    await render(1);
    await settle(2);

    await advance(REFRESH_PENDING_POLL_MS);
    await settle(3);
    expect(shown("rows")).toBe("old");
    expect(shown("completed")).toBe("undefined");

    await advance(REFRESH_PENDING_POLL_MS * 4);
    expect(mocks.callAction).toHaveBeenCalledTimes(3);
  });

  it("doesn't read again when no run is pending", async () => {
    answers.push(OLD);
    await render(0);
    await settle(1);

    await advance(REFRESH_PENDING_POLL_MS * 4);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });
});
