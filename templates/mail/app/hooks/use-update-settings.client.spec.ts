// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  getBrowserTabId: () => "tab-1",
  useActionQuery: vi.fn(),
}));

import { TAB_ID } from "@/lib/tab-id";

import { useUpdateSettings } from "./use-emails";

afterEach(() => {
  cleanup();
  mocks.callAction.mockReset().mockResolvedValue({
    email: "mail-test@example.test",
    pinnedLabels: [],
  });
});

describe("useUpdateSettings request source", () => {
  it("sends the tab id in the request header for preference updates", async () => {
    mocks.callAction.mockResolvedValue({
      email: "mail-test@example.test",
      pinnedLabels: [],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["settings"], {
      email: "mail-test@example.test",
      pinnedLabels: [],
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => useUpdateSettings(), { wrapper });

    expect(
      mocks.callAction.mock.calls.some(
        ([action]) => action === "update-mail-preferences",
      ),
    ).toBe(false);

    await act(async () => {
      await hook.result.current.mutateAsync({ imagePolicy: "show" });
    });

    const updateCall = mocks.callAction.mock.calls.find(
      ([action]) => action === "update-mail-preferences",
    );
    expect(updateCall?.[1].requestSource).toBe(TAB_ID);
    expect(updateCall?.[2]).toEqual({
      method: "PUT",
      headers: { "X-Request-Source": TAB_ID },
    });
    hook.unmount();
    queryClient.clear();
  });
});
