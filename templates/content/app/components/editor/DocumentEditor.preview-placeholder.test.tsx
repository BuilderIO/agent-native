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
const read = vi.hoisted(() => ({
  failure: null as null | { error: unknown; refetch: () => Promise<unknown> },
}));

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: embedHost.isEmbedMcpChatBridgeActive,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  usePageOpenDocument: () => ({
    query: read.failure
      ? {
          isFetching: false,
          isError: true,
          error: read.failure.error,
          errorUpdateCount: 1,
          errorUpdatedAt: 1,
          dataUpdatedAt: 0,
          refetch: read.failure.refetch,
        }
      : { isFetching: true, isError: false, dataUpdatedAt: 0 },
    fetchedForThisOpen: !!read.failure,
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
import { present } from "./page-editor-test-utils";

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
    read.failure = null;
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

  async function render(row: DatabaseItemPreviewRow | undefined = previewRow) {
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
              previewRow: row,
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

describe("a page whose read fails", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    read.failure = null;
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function fail(error: unknown) {
    let answer!: () => void;
    const refetch = vi.fn(
      () => new Promise<void>((resolve) => (answer = resolve)),
    );
    read.failure = { error, refetch };
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
            }),
          ),
        ),
      );
    });
    return { refetch, answer: () => act(async () => answer()) };
  }

  const retry = () =>
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "database.retry",
    );

  it("reads the page again on Retry, holding the button until the read answers", async () => {
    const { refetch, answer } = await fail({ status: 500 });
    expect(retry()?.disabled).toBe(false);

    await act(async () => present(retry()).click());
    expect(refetch).toHaveBeenCalledOnce();
    expect(retry()?.disabled).toBe(true);

    await answer();
    expect(retry()?.disabled).toBe(false);
  });

  it("offers no retry for a page this reader can't open", async () => {
    await fail({ status: 403 });
    expect(retry()).toBeUndefined();
    expect(container.textContent).not.toBe("");
  });
});
