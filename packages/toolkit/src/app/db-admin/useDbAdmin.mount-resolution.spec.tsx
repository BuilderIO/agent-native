// @vitest-environment happy-dom

import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiPath = vi.hoisted(() => ({
  resolve: vi.fn((path: string) => {
    throw new Error(`Workspace mount unavailable for ${path}`);
  }),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: apiPath.resolve,
}));

import { useOverview } from "./useDbAdmin.js";

function OverviewHarness() {
  const { error } = useOverview();
  return <span>{error?.message ?? "Loading"}</span>;
}

describe("useOverview mount resolution", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onlineManager.setOnline(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports a mount-resolution failure through query state instead of render", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OverviewHarness />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(queryClient.getQueryCache().getAll()[0]?.state.error?.message).toBe(
      "Workspace mount unavailable for /_agent-native/db-admin",
    );
  });
});
