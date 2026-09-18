// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  query: {
    data: {
      designSystems: [
        {
          id: "system-1",
          title: "Brand",
          description: null,
          data: "{}",
          isDefault: true,
          createdAt: "2026-09-18T00:00:00.000Z",
          indexingStatus: "indexing" as "indexing" | "ready" | "unavailable",
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useActionQuery: () => mocks.query,
}));

import { useDesignSystems } from "./use-design-systems";

let latest: ReturnType<typeof useDesignSystems> | null = null;

function Probe() {
  latest = useDesignSystems();
  return null;
}

describe("useDesignSystems", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.callAction.mockReset();
    mocks.callAction.mockResolvedValue({ updated: false });
    mocks.query.refetch.mockReset();
    latest = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rechecks indexing systems until a refresh reports a change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<Probe />));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(2);

    mocks.callAction.mockResolvedValueOnce({ updated: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
    expect(latest?.designSystems[0]?.indexingStatus).toBe("indexing");

    await act(async () => root.unmount());
    container.remove();
  });

  it("stops polling when the list reports a terminal status", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<Probe />));
    mocks.query.data = {
      designSystems: [
        {
          ...mocks.query.data.designSystems[0],
          indexingStatus: "ready",
        },
      ],
    };
    await act(async () => root.render(<Probe />));
    const callCount = mocks.callAction.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(callCount);

    await act(async () => root.unmount());
    container.remove();
  });
});
