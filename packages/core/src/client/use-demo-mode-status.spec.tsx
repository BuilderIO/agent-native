// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ version: 0 }));

vi.mock("./use-change-version.js", () => ({
  useChangeVersion: () => mocks.version,
}));

import { useDemoModeStatus } from "./use-demo-mode-status.js";

function DemoModeStatusProbe() {
  const { enabled, forced, isLoading } = useDemoModeStatus();
  return (
    <output>
      {isLoading
        ? "loading"
        : `${enabled ? "enabled" : "disabled"} ${
            forced ? "forced" : "optional"
          }`}
    </output>
  );
}

describe("useDemoModeStatus", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.version = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderProbe() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DemoModeStatusProbe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(container.textContent).not.toBe("loading");
      });
    });
  }

  it("reads the effective status with same-origin credentials", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ enabled: true, forced: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderProbe();

    expect(fetchMock).toHaveBeenCalledWith("/_agent-native/demo/status", {
      credentials: "same-origin",
    });
    expect(container.textContent).toBe("enabled forced");
  });

  it("refetches when the Demo mode change version advances", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ enabled: false, forced: false }))
      .mockResolvedValueOnce(Response.json({ enabled: true, forced: false }));
    vi.stubGlobal("fetch", fetchMock);

    await renderProbe();
    expect(container.textContent).toBe("disabled optional");

    mocks.version = 1;
    await renderProbe();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("enabled optional");
  });

  it("returns null status for an unavailable endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not found", { status: 404 })),
    );

    await renderProbe();

    expect(container.textContent).toBe("disabled optional");
  });
});
