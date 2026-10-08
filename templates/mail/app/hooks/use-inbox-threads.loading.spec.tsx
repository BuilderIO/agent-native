// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callActionWithRetry: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callActionWithRetry: mocks.callActionWithRetry,
}));

vi.mock("@agent-native/core/client/host", () => ({
  agentNativeApiDisabledReason: () => undefined,
}));

import { useInboxThreads } from "./use-inbox-threads";

afterEach(() => {
  cleanup();
  mocks.callActionWithRetry.mockReset();
});

describe("useInboxThreads initial failures", () => {
  it("bounds the first inbox request and exposes a 504 as a query error", async () => {
    const gatewayTimeout = Object.assign(new Error("Gateway timeout"), {
      status: 504,
    });
    mocks.callActionWithRetry.mockRejectedValue(gatewayTimeout);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const input = { tab: "important", limit: 100, offset: 0 };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useInboxThreads(input), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mocks.callActionWithRetry).toHaveBeenCalledWith(
      "list-inbox-threads",
      input,
      expect.objectContaining({ method: "GET", timeoutMs: 15_000 }),
    );
    expect(result.current.error).toMatchObject({ status: 504 });
    expect(result.current.isLoading).toBe(false);

    unmount();
    queryClient.clear();
  });
});
