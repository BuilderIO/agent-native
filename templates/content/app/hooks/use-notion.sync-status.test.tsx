// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startup = vi.hoisted(() => ({ settled: false }));

vi.mock(
  "@agent-native/core/client/use-after-paint",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/use-after-paint")
    >()),
    useAfterStartup: () => startup.settled,
  }),
);

import { useDocumentSyncStatus } from "./use-notion";

const OPENED_AT = "2026-11-01T10:00:00.000Z";
const EDITED_AT = "2026-11-01T10:00:02.000Z";
const documentKey = ["action", "get-document", { id: "doc-1" }];

function Probe() {
  useDocumentSyncStatus("doc-1");
  return null;
}

// The sync status waits for the page load to settle. An edit made while it
// waits moves the cached document past the last push, and the answer must not
// then refetch the document over that edit.
describe("useDocumentSyncStatus after an edit made while it waits", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  let statusCalls: number;

  function stubStatus(lastPushedLocalUpdatedAt: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("refresh-notion-sync-status")) {
          statusCalls += 1;
          return new Response(
            JSON.stringify({
              connected: true,
              pageId: "notion-page-1",
              state: "idle",
              hasConflict: false,
              lastSyncedAt: OPENED_AT,
              lastPushedLocalUpdatedAt,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  }

  async function openEditThenSettle() {
    queryClient.setQueryData(documentKey, {
      id: "doc-1",
      title: "Roadmap",
      updatedAt: OPENED_AT,
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    expect(statusCalls).toBe(0);

    // The edit saves while the status call is still held back.
    queryClient.setQueryData(documentKey, {
      id: "doc-1",
      title: "Roadmap, edited",
      updatedAt: EDITED_AT,
    });

    startup.settled = true;
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(statusCalls).toBe(1);
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    startup.settled = false;
    statusCalls = 0;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the edited document when the last push predates the edit", async () => {
    stubStatus(OPENED_AT);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await openEditThenSettle();

    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(documentKey)).toMatchObject({
      title: "Roadmap, edited",
      updatedAt: EDITED_AT,
    });
  });

  it("still refetches the document when Notion holds a newer push", async () => {
    stubStatus("2026-11-01T10:00:05.000Z");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await openEditThenSettle();

    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["action", "get-document"] }),
    );
  });
});
