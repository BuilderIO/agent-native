// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNotebookTableQuery } from "./useNotebookTableQuery";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const observedCalls: Array<{
  target: Node;
  options: MutationObserverInit | undefined;
}> = [];
const originalObserve = MutationObserver.prototype.observe;

afterEach(() => {
  MutationObserver.prototype.observe = originalObserve;
  observedCalls.length = 0;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function stubTableQueryFetch(addedCellId: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("get-notebook-snapshot")) {
        return new Response(
          JSON.stringify({
            status: "accepted",
            snapshot: {
              workspaceId: "ws-1",
              projectId: "proj-1",
              head: { versionId: "v1", revision: "1" },
              eventSeq: "1",
            },
            metadata: { title: "Notebook", description: "", statusId: null },
            resources: {
              orderRevision: "1",
              metadataRevision: "0",
              inputRevision: "0",
              layoutRevision: "0",
            },
            cells: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("get-notebook-table-reference")) {
        return new Response(
          JSON.stringify({
            connectionId: "conn-1",
            tableId: "tbl-1",
            catalogGeneration: "1",
            authorityGeneration: "1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("query-notebook-table")) {
        return new Response(
          JSON.stringify({
            cellId: addedCellId,
            run: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

describe("useNotebookTableQuery MutationObserver scoping", () => {
  it("scopes MutationObserver off document.body and focuses the newly mounted cell", async () => {
    MutationObserver.prototype.observe = function (
      this: MutationObserver,
      target: Node,
      options?: MutationObserverInit,
    ) {
      observedCalls.push({ target, options });
      return originalObserve.call(this, target, options);
    };

    const addedCellId = "cell-added-1";
    stubTableQueryFetch(addedCellId);

    const nbRoot = document.createElement("div");
    nbRoot.className = "nb-root";
    const nbBody = document.createElement("div");
    nbBody.className = "nb-body";
    const panelHost = document.createElement("div");
    nbRoot.append(nbBody, panelHost);
    document.body.append(nbRoot);

    let triggerQuery:
      | ((table: { connectionId: string; tableId: string }) => void)
      | undefined;

    function Harness() {
      const { query } = useNotebookTableQuery(
        "proj-1",
        () => undefined,
        undefined,
        null,
      );
      triggerQuery = query;
      return null;
    }

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const root = createRoot(panelHost);

    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <Harness />
          </QueryClientProvider>,
        );
      });

      await act(async () => {
        triggerQuery?.({ connectionId: "conn-1", tableId: "tbl-1" });
      });

      await vi.waitFor(() => {
        expect(observedCalls.length).toBeGreaterThan(0);
      });

      const bodySubtreeCalls = observedCalls.filter(
        ({ target, options }) => target === document.body && options?.subtree,
      );
      expect(bodySubtreeCalls).toEqual([]);
      expect(observedCalls.some(({ target }) => target === document.body)).toBe(
        false,
      );

      const newCell = document.createElement("article");
      newCell.setAttribute("data-notebook-cell", addedCellId);
      newCell.tabIndex = -1;
      newCell.scrollIntoView = vi.fn();
      nbBody.append(newCell);

      await vi.waitFor(() => {
        expect(document.activeElement).toBe(newCell);
      });
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  });
});
