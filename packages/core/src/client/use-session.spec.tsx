// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  setSentryUser: vi.fn(),
  trackSessionStatus: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

import { useSession } from "./use-session.js";

let container: HTMLDivElement;
let root: Root;
let now = 0;

function SessionConsumer({ label }: { label: string }) {
  const { session, isLoading } = useSession();
  return (
    <div data-testid={label}>
      {isLoading ? "loading" : (session?.email ?? "signed-out")}
    </div>
  );
}

function SessionConsumers({ labels }: { labels: string[] }) {
  return labels.map((label) => <SessionConsumer key={label} label={label} />);
}

async function renderConsumers(labels: string[]) {
  await act(async () => {
    root.render(<SessionConsumers labels={labels} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  now += 60_001;
  vi.spyOn(Date, "now").mockReturnValue(now);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useSession", () => {
  it("shares one in-flight session request across mounted consumers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            userId: "user-1",
            email: "person@example.com",
            name: "Person",
            orgId: "org-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first", "second"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("person@example.comperson@example.com");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(true);
  });

  it("keeps loading and retries after a non-OK response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: "user-2",
            email: "recovered@example.com",
            name: "Recovered",
            orgId: "org-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SessionConsumers labels={["first"]} />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");
    expect(analyticsMocks.trackSessionStatus).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("recovered@example.com");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(true);
  });

  it("keeps loading and retries after a thrown fetch", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: "user-3",
            email: "retry@example.com",
            name: "Retry",
            orgId: "org-3",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SessionConsumers labels={["first"]} />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("retry@example.com");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(true);
  });

  it("caches a definitive unauthenticated response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Not authenticated" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    await renderConsumers(["first", "second"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("signed-outsigned-out");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(false);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
