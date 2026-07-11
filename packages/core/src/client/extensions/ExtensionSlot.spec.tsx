// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtensionSlot } from "./ExtensionSlot.js";

vi.mock("./EmbeddedExtension.js", () => ({
  EmbeddedExtension: ({ extensionId }: { extensionId: string }) => (
    <div>Embedded {extensionId}</div>
  ),
}));

describe("ExtensionSlot", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows a retry state instead of hiding installed widgets on load failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        Response.json([
          {
            installId: "install-1",
            extensionId: "extension-1",
            name: "Status",
            description: "Status widget",
            icon: null,
            updatedAt: "2026-07-11T00:00:00.000Z",
            position: 0,
            config: null,
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ExtensionSlot id="test.sidebar.bottom" />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Couldn't load widgets.");
    });
    expect(container.textContent).not.toContain("Embedded extension-1");

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Retry"),
    );
    expect(retry).toBeTruthy();

    await act(async () => {
      retry?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Embedded extension-1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
