// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { VisualizationDrillPanel } from "./VisualizationDrillPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("VisualizationDrillPanel focus return", () => {
  it("focuses the drill heading on mount and restores focus to the opener on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "empty",
              columns: [],
              rows: [],
              filters: [],
              page: 1,
              totalRows: 0,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const opener = document.createElement("button");
    opener.textContent = "Inspect data";
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <VisualizationDrillPanel
              request={{
                projectId: "proj-1",
                cellId: "cell-1",
                visualizationResultId: "res-1",
                selectionId: "sel-1",
                mode: "view-data",
                requestId: "req-1",
              }}
              onClose={vi.fn()}
            />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });

    const heading = container.querySelector("h3");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);

    await act(async () => {
      root.unmount();
    });
    client.clear();

    expect(document.activeElement).toBe(opener);
  });
});
