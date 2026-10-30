// @vitest-environment jsdom

import type { PublicReaderContext } from "@shared/public-reader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { ReadOnlyMarkdownContent } from "../routes/p.$id";

describe("public page blocks", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function render(pageLinks: PublicReaderContext["pageLinks"]) {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          TooltipProvider,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(ReadOnlyMarkdownContent, {
              documentId: "doc-1",
              content: 'Intro\n<page id="plots">Untitled</page>',
              clipsAppUrl: null,
              pageLinks,
              basePath: "",
            }),
          ),
        ),
      ),
    );
  }

  const pageBlock = () =>
    container.querySelector(
      ".content-page-reference__button",
    ) as HTMLButtonElement | null;

  it("follows the page's targets when its data changes", async () => {
    await act(async () =>
      render({ plots: { id: "plots", title: "Plot assignments", icon: null } }),
    );
    expect(pageBlock()?.textContent).toContain("Plot assignments");
    expect(pageBlock()?.disabled).toBe(false);

    // The target went private: the block keeps its stored label and is inert.
    await act(async () => render({}));
    expect(pageBlock()?.textContent).toContain("Untitled");
    expect(pageBlock()?.textContent).not.toContain("Plot assignments");
    expect(pageBlock()?.disabled).toBe(true);

    await act(async () =>
      render({ plots: { id: "plots", title: "Plots, 2027", icon: null } }),
    );
    expect(pageBlock()?.textContent).toContain("Plots, 2027");

    // A reader without an account can't look targets up, so nothing tries.
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes("resolve-content-links"))).toEqual(
      [],
    );
  });
});
