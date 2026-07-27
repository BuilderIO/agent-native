// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useUserPref } from "./use-user-pref";

describe("useUserPref", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    callAction.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps a failed read unavailable instead of exposing an empty preference", async () => {
    callAction.mockRejectedValue(new Error("temporary read failure"));

    function Probe() {
      const pref = useUserPref<{ filters: Record<string, string> }>("filters");
      return (
        <div>
          {pref.isError ? "error" : pref.isSuccess ? "ready" : "loading"}
        </div>
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("error");
  });
});
