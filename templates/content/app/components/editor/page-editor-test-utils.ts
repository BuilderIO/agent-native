import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";

import type { ContentLayout } from "@/components/layout/content-layout";
import { ContentLayoutContext } from "@/components/layout/use-content-layout";
import { TooltipProvider } from "@/components/ui/tooltip";

export function createPageEditorMount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return {
    queryClient,
    container,
    root,
    render(
      editors: ReactNode[],
      {
        location = "/",
        layout = null,
      }: { location?: string; layout?: ContentLayout | null } = {},
    ) {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            { initialEntries: [location] },
            createElement(
              ContentLayoutContext.Provider,
              { value: layout },
              createElement(TooltipProvider, null, ...editors),
            ),
          ),
        ),
      );
    },
    async unmount() {
      await act(async () => root.unmount());
    },
    discard() {
      queryClient.clear();
      container.remove();
    },
  };
}

export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected the rendered fixture to hold this value.");
  return value;
}
