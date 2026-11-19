// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseItemPreviewRow } from "./DatabaseItemPreviewPlaceholder";

const embedHost = vi.hoisted(() => ({
  isEmbedMcpChatBridgeActive: vi.fn(() => false),
}));

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: embedHost.isEmbedMcpChatBridgeActive,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
// The page's read never answers, so the surface stays on its loading view.
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  usePageOpenDocument: () => ({
    query: { isFetching: true, isError: false, dataUpdatedAt: 0 },
    fetchedForThisOpen: false,
    readsStartedEarly: true,
  }),
}));
vi.mock("./DatabaseItemPreviewPlaceholder", () => ({
  DatabaseItemPreviewPlaceholder: () =>
    createElement("div", { "data-testid": "row-placeholder" }),
}));
vi.mock("./DocumentEditorSkeleton", () => ({
  DocumentEditorSkeleton: ({ stalledLoad }: { stalledLoad?: object }) =>
    createElement("div", {
      "data-testid": "page-skeleton",
      "data-stall-message": stalledLoad ? "yes" : "no",
    }),
}));

import { PageEditorSurface } from "./DocumentEditor";

const previewRow = {
  item: { id: "row-1" },
  collectionEditable: true,
} as unknown as DatabaseItemPreviewRow;

describe("a row's panel while its page is read", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    embedHost.isEmbedMcpChatBridgeActive.mockReturnValue(false);
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MemoryRouter,
            null,
            createElement(PageEditorSurface, {
              documentId: "row-1",
              host: "preview",
              previewRow,
            }),
          ),
        ),
      );
    });
  }

  it("draws the row's placeholder", async () => {
    await render();

    expect(
      container.querySelector('[data-testid="row-placeholder"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="page-skeleton"]')).toBeNull();
  });

  it("keeps the page skeleton, with its stall message, in an embedded widget", async () => {
    embedHost.isEmbedMcpChatBridgeActive.mockReturnValue(true);

    await render();

    expect(
      container.querySelector('[data-testid="row-placeholder"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="page-skeleton"]')
        ?.getAttribute("data-stall-message"),
    ).toBe("yes");
  });
});
