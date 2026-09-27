// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown }>,
  respond: (name: string, params: any): Promise<unknown> =>
    Promise.resolve(
      name === "get-document"
        ? { id: params.id, title: "Plan", canEdit: true }
        : { editable: true, draft: null },
    ),
}));

vi.mock("@agent-native/core/client/hooks", () => {
  const callAction = (name: string, params: unknown) => {
    server.calls.push({ name, params });
    return server.respond(name, params);
  };
  return {
    callAction,
    useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    // Mirrors core: the action name and params are the query key.
    useActionQuery: (name: string, params: unknown, options: object) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => callAction(name, params),
        ...options,
      }),
  };
});
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { markDocumentCreationPending } from "../lib/optimistic-document";
import {
  ensurePreviewDocumentDraftRead,
  startPageOpenDocumentReads,
  usePageOpenDocument,
} from "./use-documents";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const reads = (name: string) =>
  server.calls.filter((call) => call.name === name).length;

describe("page open document reads", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  const seen: Array<{ fetchedForThisOpen: boolean; title?: string }> = [];

  function Page({ id }: { id: string }) {
    const { query, fetchedForThisOpen } = usePageOpenDocument(id, {});
    seen.push({
      fetchedForThisOpen,
      title: (query.data as Document | undefined)?.title,
    });
    return null;
  }

  const mount = async (id = "doc-1") => {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Page, { id }),
        ),
      );
    });
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.calls = [];
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? { id: params.id, title: "Plan", canEdit: true }
          : { editable: true, draft: null },
      );
    seen.length = 0;
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("shows a read made for this open without reading the page again", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    await act(async () => {});

    await mount();

    expect(seen[0]).toEqual({ fetchedForThisOpen: true, title: "Plan" });
    expect(reads("get-document")).toBe(1);
    expect(reads("get-preview-document-draft")).toBe(1);
  });

  it("joins a read that is still in flight when the page mounts", async () => {
    const response = deferred<unknown>();
    server.respond = (name, params) =>
      name === "get-document"
        ? response.promise
        : Promise.resolve({ editable: true, draft: null });
    startPageOpenDocumentReads(queryClient, "doc-1");

    await mount();
    expect(seen[seen.length - 1]?.fetchedForThisOpen).toBe(false);
    await act(async () => {
      response.resolve({ id: "doc-1", title: "Plan", canEdit: true });
    });

    await vi.waitFor(() =>
      expect(seen[seen.length - 1]).toEqual({
        fetchedForThisOpen: true,
        title: "Plan",
      }),
    );
    expect(reads("get-document")).toBe(1);
  });

  it("reads again when the page mounts a second time", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    await act(async () => {});
    await mount();
    act(() => root.unmount());
    root = createRoot(container);
    seen.length = 0;

    await mount();

    expect(seen[0].fetchedForThisOpen).toBe(false);
    await vi.waitFor(() => expect(reads("get-document")).toBe(2));
    await vi.waitFor(() =>
      expect(seen[seen.length - 1]?.fetchedForThisOpen).toBe(true),
    );
  });

  it("does not show a read made before a change to the page", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    await act(async () => {});
    await queryClient.invalidateQueries({
      queryKey: ["action", "get-document"],
    });

    await mount();

    expect(seen[0].fetchedForThisOpen).toBe(false);
    await vi.waitFor(() => expect(reads("get-document")).toBe(2));
  });

  it("does not read a page whose creation has not committed", () => {
    queryClient.setQueryData(
      ["action", "get-document", { id: "new-page" }],
      markDocumentCreationPending({ id: "new-page", title: "" } as Document),
    );
    startPageOpenDocumentReads(queryClient, "new-page");

    expect(server.calls).toEqual([]);
  });

  it("reads the page in the collection its URL names", () => {
    startPageOpenDocumentReads(queryClient, "known-page", {
      databaseId: "db-1",
    });

    expect(server.calls.map((call) => call.params)).toEqual([
      { id: "known-page", databaseId: "db-1" },
      { documentId: "known-page" },
    ]);
  });
});

describe("draft recovery read", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    server.calls = [];
    server.respond = () => Promise.resolve({ editable: true, draft: null });
    queryClient = new QueryClient();
  });

  it("verifies against the draft read made alongside the page read", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-preview-document-draft")).toBe(1));
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState([
          "action",
          "get-preview-document-draft",
          { documentId: "doc-1" },
        ])?.status,
      ).toBe("success"),
    );

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(1);
  });

  it("reads once when no read was made for this open", async () => {
    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");
    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(2);
  });

  it("fails verification when the reader can no longer edit the page", async () => {
    server.respond = () => Promise.resolve({ editable: false, draft: null });

    await expect(
      ensurePreviewDocumentDraftRead(queryClient, "doc-1"),
    ).rejects.toThrow("no longer editable");
  });
});
