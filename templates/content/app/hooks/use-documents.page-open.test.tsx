// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement, useLayoutEffect } from "react";
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
    getBrowserTabId: () => "tab-1",
    useDbSync: vi.fn(),
    // Mirrors core: the options run around the action call.
    useActionMutation: (name: string, options: object = {}) =>
      useMutation({
        ...options,
        mutationFn: (params: unknown) => callAction(name, params),
      }),
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
import { contentSyncInvalidatePredicate } from "./use-db-sync";
import {
  ensurePreviewDocumentDraftRead,
  startPageOpenDocumentReads,
  usePageOpenDocument,
  useUpdateDocument,
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

// Delivers peer sync events the way core's db sync does: one invalidation
// with Content's predicate, without cancelling in-flight reads.
function deliverSyncEvents(
  queryClient: QueryClient,
  pathname: string,
  keys: string[],
) {
  const predicate = contentSyncInvalidatePredicate(queryClient, pathname);
  const events = keys.map((key) => ({ source: "action", key }));
  return queryClient.invalidateQueries(
    { predicate: (query) => predicate(query, events) },
    { cancelRefetch: false },
  );
}

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

  it("does not show an early read after a peer changed the page before it mounted", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    await act(async () => {});
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? { id: params.id, title: "Edited by the agent", canEdit: true }
          : { editable: true, draft: null },
      );

    await deliverSyncEvents(queryClient, "/home", ["edit-document"]);
    await mount();

    expect(seen[0].fetchedForThisOpen).toBe(false);
    await vi.waitFor(() =>
      expect(seen[seen.length - 1]).toEqual({
        fetchedForThisOpen: true,
        title: "Edited by the agent",
      }),
    );
    expect(reads("get-document")).toBe(2);
  });

  it("drops an early read that a peer change overtook while it was in flight", async () => {
    const first = deferred<unknown>();
    server.respond = (name) =>
      name === "get-document"
        ? first.promise
        : Promise.resolve({ editable: true, draft: null });
    startPageOpenDocumentReads(queryClient, "doc-1");
    await deliverSyncEvents(queryClient, "/home", ["update-document"]);
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? { id: params.id, title: "After the change", canEdit: true }
          : { editable: true, draft: null },
      );

    await mount();
    first.resolve({ id: "doc-1", title: "Before the change", canEdit: true });

    await vi.waitFor(() =>
      expect(seen[seen.length - 1]).toEqual({
        fetchedForThisOpen: true,
        title: "After the change",
      }),
    );
    expect(reads("get-document")).toBe(2);
  });

  it("keeps an early read through changes that cannot affect the page", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    await act(async () => {});

    await deliverSyncEvents(queryClient, "/home", [
      "update-content-database-personal-view",
    ]);
    await mount();

    expect(seen[0]).toEqual({ fetchedForThisOpen: true, title: "Plan" });
    expect(reads("get-document")).toBe(1);
  });

  it("does not show a spoiled early read that a later page-open start restarted", async () => {
    // The /home hint read is in flight when a peer edit spoils it, and the
    // layout's pending navigation then starts the page's reads again.
    const first = deferred<unknown>();
    server.respond = (name) =>
      name === "get-document"
        ? first.promise
        : Promise.resolve({ editable: true, draft: null });
    startPageOpenDocumentReads(queryClient, "doc-1");
    await deliverSyncEvents(queryClient, "/home", ["edit-document"]);
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? { id: params.id, title: "After the change", canEdit: true }
          : { editable: true, draft: null },
      );
    startPageOpenDocumentReads(queryClient, "doc-1");
    first.resolve({ id: "doc-1", title: "Before the change", canEdit: true });

    await mount();

    await vi.waitFor(() =>
      expect(seen[seen.length - 1]).toEqual({
        fetchedForThisOpen: true,
        title: "After the change",
      }),
    );
    expect(seen.some((entry) => entry.title === "Before the change")).toBe(
      false,
    );
  });

  it("refetches when a peer change lands between adoption and subscription", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    await act(async () => {});
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? { id: params.id, title: "Edited by the agent", canEdit: true }
          : { editable: true, draft: null },
      );
    let delivered = false;
    // Layout effects run after the render that adopts the read and before
    // the query subscribes.
    function PageWithSyncInGap() {
      const { query, fetchedForThisOpen } = usePageOpenDocument("doc-1", {});
      useLayoutEffect(() => {
        if (delivered) return;
        delivered = true;
        void deliverSyncEvents(queryClient, "/home", ["edit-document"]);
      }, []);
      seen.push({
        fetchedForThisOpen,
        title: (query.data as Document | undefined)?.title,
      });
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PageWithSyncInGap),
        ),
      );
    });

    await vi.waitFor(() =>
      expect(seen[seen.length - 1]?.title).toBe("Edited by the agent"),
    );
    expect(reads("get-document")).toBe(2);
  });

  describe("while this tab saves the page", () => {
    let saveRoot: Root;
    let saveContainer: HTMLDivElement;
    let save: ReturnType<typeof useUpdateDocument>["mutateAsync"];
    let saved = deferred<unknown>();

    function Saver() {
      save = useUpdateDocument().mutateAsync;
      return null;
    }

    beforeEach(async () => {
      saved = deferred<unknown>();
      saveContainer = document.createElement("div");
      document.body.append(saveContainer);
      saveRoot = createRoot(saveContainer);
      await act(async () => {
        saveRoot.render(
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(Saver),
          ),
        );
      });
      server.respond = (name, params) =>
        name === "update-document"
          ? saved.promise
          : Promise.resolve(
              name === "get-document"
                ? { id: params.id, title: "Before the save", canEdit: true }
                : { editable: true, draft: null },
            );
    });

    afterEach(() => {
      act(() => saveRoot.unmount());
      saveContainer.remove();
    });

    const savedPage = {
      id: "doc-1",
      title: "After the save",
      content: "Saved words",
      updatedAt: "v2",
      revision: "r2",
      canEdit: true,
      softDeletedDatabaseIds: [],
    };
    const afterSave = (name: string, params: any) =>
      name === "update-document"
        ? saved.promise
        : Promise.resolve(
            name === "get-document"
              ? { id: params.id, title: "After the save", canEdit: true }
              : { editable: true, draft: null },
          );

    it("does not adopt a read served before a save that was already under way", async () => {
      const saving = save({ id: "doc-1", content: "Saved words" });
      startPageOpenDocumentReads(queryClient, "doc-1");
      await vi.waitFor(() => expect(reads("get-document")).toBe(1));
      await act(async () => {
        saved.resolve(savedPage);
        await saving;
      });
      server.respond = afterSave;

      await mount();

      expect(seen[0].fetchedForThisOpen).toBe(false);
      await vi.waitFor(() =>
        expect(seen[seen.length - 1]).toEqual({
          fetchedForThisOpen: true,
          title: "After the save",
        }),
      );
      expect(reads("get-document")).toBe(2);
    });

    it("does not adopt a read that a save started after", async () => {
      startPageOpenDocumentReads(queryClient, "doc-1");
      await vi.waitFor(() => expect(reads("get-document")).toBe(1));
      await act(async () => {});
      server.respond = afterSave;
      const saving = save({ id: "doc-1", content: "Saved words" });

      await mount();

      expect(seen[0].fetchedForThisOpen).toBe(false);
      await vi.waitFor(() => expect(reads("get-document")).toBe(2));
      await act(async () => {
        saved.resolve(savedPage);
        await saving;
      });
    });
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

  it("reads again when another tab wrote a draft after the early read", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryState([
          "action",
          "get-preview-document-draft",
          { documentId: "doc-1" },
        ])?.status,
      ).toBe("success"),
    );

    await deliverSyncEvents(queryClient, "/home", [
      "update-preview-document-draft",
    ]);
    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(2);
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
