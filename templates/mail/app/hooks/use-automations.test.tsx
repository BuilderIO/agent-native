// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  getBrowserTabId: () => "test-tab",
}));

import { useCreateAutomation, useUpdateAutomation } from "./use-automations";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCreateAutomation", () => {
  it("refreshes saved pins when a rule is created or changed to Filtered", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const settingsQuery = vi
      .fn()
      .mockResolvedValueOnce({ pinnedLabels: [] })
      .mockResolvedValue({
        pinnedLabels: ["important", "agent-native-filtered"],
      });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        const settings = useQuery({
          queryKey: ["settings"],
          queryFn: settingsQuery,
          staleTime: Infinity,
        });
        const create = useCreateAutomation();
        const update = useUpdateAutomation();
        return { create, settings, update };
      },
      { wrapper },
    );
    mocks.callAction.mockResolvedValue({ id: "filtered-rule" });
    await waitFor(() => expect(settingsQuery).toHaveBeenCalledOnce());

    await act(async () => {
      await result.current.create.mutateAsync({
        name: "AI filter: cold sales",
        condition: "Cold sales messages from senders I have not replied to",
        actions: [
          { type: "label", labelName: "agent-native-filtered" },
          { type: "archive" },
        ],
        kind: "ai-filter",
        domain: "mail",
      });
    });

    expect(settingsQuery).toHaveBeenCalledTimes(2);
    expect(result.current.settings.data?.pinnedLabels).toEqual([
      "important",
      "agent-native-filtered",
    ]);

    await act(async () => {
      await result.current.update.mutateAsync({
        id: "existing-rule",
        actions: [
          { type: "label", labelName: "agent-native-filtered" },
          { type: "archive" },
        ],
      });
    });
    expect(settingsQuery).toHaveBeenCalledTimes(3);
  });
});
