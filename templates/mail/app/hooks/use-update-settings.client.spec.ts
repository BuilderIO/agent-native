// @vitest-environment happy-dom

import type { UserSettings } from "@shared/types";
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

const inboxSettingPatches: Array<[string, Partial<UserSettings>]> = [
  ["pinnedLabels", { pinnedLabels: ["important"] }],
  ["combineInbox", { combineInbox: true }],
  ["showAllTab", { showAllTab: false }],
  [
    "savedFilters",
    { savedFilters: [{ id: "urgent", name: "Urgent", query: "is:unread" }] },
  ],
  ["labelAliases", { labelAliases: { important: "Priority" } }],
];

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

  it.each(inboxSettingPatches)(
    "invalidates inbox reads when %s changes without refetching sync",
    async (_field, patch) => {
      mocks.callAction.mockResolvedValue({
        email: "mail-test@example.test",
        pinnedLabels: [],
        savedFilters: [],
        labelAliases: {},
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      queryClient.setQueryData<UserSettings>(["settings"], {
        name: "Mail test",
        email: "mail-test@example.test",
        theme: "system",
        density: "comfortable",
        previewPane: "right",
        sendAndArchive: false,
        undoSendDelay: 0,
        pinnedLabels: [],
        combineInbox: false,
        showAllTab: true,
        savedFilters: [],
        labelAliases: {},
      });
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
      const wrapper = ({ children }: PropsWithChildren) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
      const hook = renderHook(() => useUpdateSettings(), { wrapper });

      await act(async () => {
        await hook.result.current.mutateAsync(patch);
      });

      const invalidatedKeys = invalidateQueries.mock.calls.map(
        ([filters]) => filters?.queryKey,
      );
      expect(invalidatedKeys).toContainEqual(["action", "list-inbox-threads"]);
      expect(invalidatedKeys).toContainEqual(["mail-inbox-overview"]);
      expect(invalidatedKeys).not.toContainEqual(["mail-inbox-sync"]);
      hook.unmount();
      queryClient.clear();
    },
  );

  it("does not invalidate inbox reads for unrelated preferences", async () => {
    mocks.callAction.mockResolvedValue({ email: "mail-test@example.test" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["settings"], {
      email: "mail-test@example.test",
      pinnedLabels: [],
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const hook = renderHook(() => useUpdateSettings(), { wrapper });

    await act(async () => {
      await hook.result.current.mutateAsync({ imagePolicy: "show" });
    });

    expect(
      invalidateQueries.mock.calls.map(([filters]) => filters?.queryKey),
    ).toEqual([["settings"]]);
    hook.unmount();
    queryClient.clear();
  });
});
