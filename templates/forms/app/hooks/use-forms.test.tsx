// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { useDeleteForm } from "./use-forms";

type FormListItem = { id: string; title: string };

function Probe({ onReady }: { onReady: (mutation: any) => void }) {
  onReady(useDeleteForm());
  return null;
}

describe("useDeleteForm", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  function renderProbe(
    queryClient: QueryClient,
    onReady: (mutation: any) => void,
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Probe onReady={onReady} />
        </QueryClientProvider>,
      );
    });
  }

  function seedLists(queryClient: QueryClient) {
    const active: FormListItem[] = [
      { id: "form-1", title: "First" },
      { id: "form-2", title: "Second" },
    ];
    const archived: FormListItem[] = [{ id: "form-3", title: "Archived" }];
    queryClient.setQueryData(["action", "list-forms", {}], active);
    queryClient.setQueryData(
      ["action", "list-forms", { archived: true }],
      archived,
    );
    return { active, archived };
  }

  it("removes an active form before the archive action resolves", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { archived } = seedLists(queryClient);
    let mutation: any;
    renderProbe(queryClient, (value) => {
      mutation = value;
    });

    let result: Promise<unknown> | undefined;
    await act(async () => {
      result = mutation.mutateAsync({ id: "form-1" });
    });
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(["action", "list-forms", {}])).toEqual([
        { id: "form-2", title: "Second" },
      ]);
    });
    expect(
      queryClient.getQueryData(["action", "list-forms", { archived: true }]),
    ).toEqual(archived);

    await act(async () => {
      resolveFetch?.(
        new Response(JSON.stringify({ success: true, purged: false }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await result;
    });
  });

  it("restores the active form when archiving fails", async () => {
    let rejectFetch: ((error: Error) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { active } = seedLists(queryClient);
    let mutation: any;
    renderProbe(queryClient, (value) => {
      mutation = value;
    });

    const result = mutation.mutateAsync({ id: "form-1" });
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(["action", "list-forms", {}])).toEqual([
        { id: "form-2", title: "Second" },
      ]);
    });

    rejectFetch?.(new Error("network failure"));
    await expect(result).rejects.toThrow();
    expect(queryClient.getQueryData(["action", "list-forms", {}])).toEqual(
      active,
    );
  });
});
