// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { act, createElement, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAiHost = vi.hoisted(() => ({
  isOpenAiMcpAppHost: vi.fn(() => false),
}));
const embedHost = vi.hoisted(() => ({
  isEmbedMcpChatBridgeActive: vi.fn(() => false),
}));

const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: unknown }>,
  respond: (name: string, params: any): Promise<unknown> =>
    Promise.resolve(pageOrDraft(name, params)),
}));

vi.mock("@agent-native/core/client/agent-chat", () => openAiHost);
vi.mock("@agent-native/core/client/host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/host")>();
  return { ...actual, ...embedHost };
});

// Mirrors the server: a page read asked for the draft carries its answer.
function pageOrDraft(name: string, params: any) {
  if (name !== "get-document") return { editable: true, draft: null };
  return {
    id: params.id,
    title: "Plan",
    canEdit: true,
    ...(params.includePreviewDraft
      ? { previewDraft: { editable: true, draft: null } }
      : {}),
  };
}

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
import { PAGE_OPEN_READ_TTL_MS } from "../lib/page-open-reads";
import { useContentSpaces } from "./use-content-spaces";
import { contentSyncInvalidatePredicate } from "./use-db-sync";
import {
  documentQueryKey,
  ensurePreviewDocumentDraftRead,
  startPageOpenCompanionReads,
  startPageOpenDocumentReads,
  useContentNavigationContext,
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
    openAiHost.isOpenAiMcpAppHost.mockReturnValue(false);
    embedHost.isEmbedMcpChatBridgeActive.mockReturnValue(false);
    server.respond = (name, params) =>
      Promise.resolve(pageOrDraft(name, params));
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
    expect(reads("get-preview-document-draft")).toBe(0);
    expect(
      queryClient.getQueryData(["action", "get-document", { id: "doc-1" }]),
    ).not.toHaveProperty("previewDraft");
  });

  it("boots the /page/:id reads under a ChatGPT widget scope", async () => {
    openAiHost.isOpenAiMcpAppHost.mockReturnValue(true);

    function PageBoot() {
      const { id } = useParams<{ id: string }>();
      if (!id) throw new Error("Expected a page route id.");
      const { readsStartedEarly } = usePageOpenDocument(id, {});
      const currentQueryClient = useQueryClient();
      useEffect(() => {
        const cached = currentQueryClient.getQueryData<Document>(
          documentQueryKey(id, {}),
        );
        startPageOpenCompanionReads(
          currentQueryClient,
          id,
          cached,
          readsStartedEarly,
        );
      }, [currentQueryClient, id, readsStartedEarly]);
      useContentNavigationContext(id);
      useContentSpaces();
      return null;
    }

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/page/doc-1?__an_mcp_chat_bridge=1"] },
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: "/page/:id",
                element: createElement(PageBoot),
              }),
            ),
          ),
        ),
      );
    });

    await vi.waitFor(() =>
      expect(new Set(server.calls.map(({ name }) => name)).size).toBe(4),
    );
    expect(new Set(server.calls.map(({ name }) => name))).toEqual(
      new Set([
        "get-document",
        "list-comments",
        "list-resource-suggestions",
        "get-content-navigation-context",
      ]),
    );
    expect(reads("list-content-spaces")).toBe(0);
    expect(server.calls).toEqual(
      expect.arrayContaining([
        { name: "get-document", params: { id: "doc-1" } },
        { name: "list-comments", params: { documentId: "doc-1" } },
        {
          name: "list-resource-suggestions",
          params: { resourceType: "document", resourceId: "doc-1" },
        },
        {
          name: "get-content-navigation-context",
          params: { id: "doc-1" },
        },
      ]),
    );
  });

  it("reads only the page under the chat widget bridge", async () => {
    embedHost.isEmbedMcpChatBridgeActive.mockReturnValue(true);
    startPageOpenDocumentReads(queryClient, "doc-1");

    await vi.waitFor(() => expect(reads("get-document")).toBe(1));
    expect(server.calls).toEqual([
      { name: "get-document", params: { id: "doc-1" } },
    ]);
  });

  it("starts all document editor page-open data reads", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");

    await vi.waitFor(() =>
      expect(server.calls.map(({ name }) => name).sort()).toEqual([
        "get-document",
        "list-comments",
        "list-resource-suggestions",
      ]),
    );
    expect(server.calls).toEqual(
      expect.arrayContaining([
        {
          name: "get-document",
          params: { id: "doc-1", includePreviewDraft: true },
        },
        { name: "list-comments", params: { documentId: "doc-1" } },
        {
          name: "list-resource-suggestions",
          params: { resourceType: "document", resourceId: "doc-1" },
        },
      ]),
    );
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

  it("asks the server again when the open's own reads run a second time", async () => {
    let served = 0;
    server.respond = (name, params) => {
      const version = ++served;
      return Promise.resolve(
        name === "get-preview-document-draft"
          ? { editable: true, draft: { version } }
          : {
              ...pageOrDraft(name, params),
              title: `Plan ${version}`,
              ...(params.includePreviewDraft
                ? { previewDraft: { editable: true, draft: { version } } }
                : {}),
            },
      );
    };
    startPageOpenDocumentReads(queryClient, "doc-1");
    const pageKey = ["action", "get-document", { id: "doc-1" }];
    const draftKey = [
      "action",
      "get-preview-document-draft",
      { documentId: "doc-1" },
    ];
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(draftKey)).toEqual({
        editable: true,
        draft: { version: 1 },
      }),
    );

    await queryClient.refetchQueries({ queryKey: pageKey, exact: true });
    await queryClient.refetchQueries({ queryKey: draftKey, exact: true });

    expect(server.calls.map((call) => [call.name, call.params])).toEqual([
      ["get-document", { id: "doc-1", includePreviewDraft: true }],
      ["list-comments", { documentId: "doc-1" }],
      [
        "list-resource-suggestions",
        { resourceType: "document", resourceId: "doc-1" },
      ],
      ["get-document", { id: "doc-1" }],
      ["get-preview-document-draft", { documentId: "doc-1" }],
    ]);
    expect(queryClient.getQueryData<Document>(pageKey)?.title).toBe("Plan 4");
    expect(queryClient.getQueryData(draftKey)).toEqual({
      editable: true,
      draft: { version: 5 },
    });
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

  it("reads the page in the collection its URL names, with its review", () => {
    startPageOpenDocumentReads(queryClient, "known-page", {
      databaseId: "db-1",
    });

    expect(server.calls.map((call) => [call.name, call.params])).toEqual([
      [
        "get-document",
        { id: "known-page", databaseId: "db-1", includePreviewDraft: true },
      ],
      ["list-comments", { documentId: "known-page" }],
      [
        "list-resource-suggestions",
        { resourceType: "document", resourceId: "known-page" },
      ],
    ]);
  });

  it("does not read review for a local file page", () => {
    queryClient.setQueryData(["action", "get-document", { id: "local-page" }], {
      id: "local-page",
      title: "",
      source: { mode: "local-files" },
    } as unknown as Document);
    startPageOpenDocumentReads(queryClient, "local-page");

    expect(reads("list-comments")).toBe(0);
    expect(reads("list-resource-suggestions")).toBe(0);
  });
});

describe("draft recovery read", () => {
  let queryClient: QueryClient;

  const draftKey = [
    "action",
    "get-preview-document-draft",
    { documentId: "doc-1" },
  ];
  const draftLanded = () =>
    vi.waitFor(() =>
      expect(queryClient.getQueryState(draftKey)?.status).toBe("success"),
    );

  beforeEach(() => {
    server.calls = [];
    server.respond = (name, params) =>
      Promise.resolve(pageOrDraft(name, params));
    queryClient = new QueryClient();
  });

  it("verifies against the draft answer the page read carried", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-document")).toBe(1);
    expect(reads("get-preview-document-draft")).toBe(0);
  });

  it("fails verification when the page read says the reader cannot edit", async () => {
    server.respond = (name, params) =>
      Promise.resolve({
        ...pageOrDraft(name, params),
        previewDraft: { editable: false, draft: null },
      });
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();

    await expect(
      ensurePreviewDocumentDraftRead(queryClient, "doc-1"),
    ).rejects.toThrow("no longer editable");
    expect(reads("get-preview-document-draft")).toBe(0);
  });

  it("reads the draft on its own when the page read carries no answer", async () => {
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? { id: params.id, title: "Plan", canEdit: true }
          : { editable: true, draft: null },
      );
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(1);
  });

  it("reads the draft on its own when the page read fails", async () => {
    server.respond = (name, params) =>
      name === "get-document"
        ? Promise.reject(new Error("cold start timed out"))
        : Promise.resolve(pageOrDraft(name, params));
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(1);
  });

  it("shows a restarted draft read's own answer, not the late shared one", async () => {
    const page = deferred<unknown>();
    server.respond = (name, params) =>
      name === "get-document"
        ? page.promise
        : Promise.resolve({ editable: true, draft: { version: 2 } });
    startPageOpenDocumentReads(queryClient, "doc-1");
    await queryClient.invalidateQueries({ queryKey: draftKey });
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();
    page.resolve({
      ...pageOrDraft("get-document", { id: "doc-1" }),
      previewDraft: { editable: true, draft: { version: 1 } },
    });
    await act(async () => {});

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-document")).toBe(1);
    expect(reads("get-preview-document-draft")).toBe(1);
    expect(queryClient.getQueryData(draftKey)).toEqual({
      editable: true,
      draft: { version: 2 },
    });
  });

  it("shows the restarted page read's draft answer, not the late one it replaced", async () => {
    const first = deferred<unknown>();
    let pageReads = 0;
    server.respond = (name, params) => {
      if (name !== "get-document")
        return Promise.resolve(pageOrDraft(name, params));
      const version = ++pageReads;
      const answer = {
        ...pageOrDraft(name, params),
        previewDraft: { editable: true, draft: { version } },
      };
      return version === 1
        ? first.promise.then(() => answer)
        : Promise.resolve(answer);
    };
    startPageOpenDocumentReads(queryClient, "doc-1");
    await deliverSyncEvents(queryClient, "/home", [
      "update-preview-document-draft",
    ]);
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();
    first.resolve(undefined);
    await act(async () => {});

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-document")).toBe(2);
    expect(reads("get-preview-document-draft")).toBe(0);
    expect(queryClient.getQueryData(draftKey)).toEqual({
      editable: true,
      draft: { version: 2 },
    });
  });

  it("answers both reads from one new page read once the last open's reads expire", async () => {
    let pageReads = 0;
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? {
              ...pageOrDraft(name, params),
              previewDraft: { editable: true, draft: { version: ++pageReads } },
            }
          : pageOrDraft(name, params),
      );
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();
    const now = Date.now();
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(now + PAGE_OPEN_READ_TTL_MS + 1);
    try {
      startPageOpenDocumentReads(queryClient, "doc-1");
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(draftKey)).toEqual({
          editable: true,
          draft: { version: 2 },
        }),
      );
    } finally {
      clock.mockRestore();
    }

    expect(reads("get-document")).toBe(2);
    expect(reads("get-preview-document-draft")).toBe(0);
  });

  it("still answers the draft from a page read cancelled for this open", async () => {
    const page = deferred<unknown>();
    server.respond = (name, params) =>
      name === "get-document"
        ? page.promise
        : Promise.resolve(pageOrDraft(name, params));
    startPageOpenDocumentReads(queryClient, "doc-1");
    await queryClient.cancelQueries({
      queryKey: ["action", "get-document", { id: "doc-1" }],
    });
    page.resolve({
      ...pageOrDraft("get-document", { id: "doc-1" }),
      previewDraft: { editable: true, draft: { version: 1 } },
    });
    await draftLanded();

    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(0);
    expect(queryClient.getQueryData(draftKey)).toEqual({
      editable: true,
      draft: { version: 1 },
    });
  });

  it("reads again when another tab wrote a draft after the early read", async () => {
    startPageOpenDocumentReads(queryClient, "doc-1");
    await draftLanded();

    await deliverSyncEvents(queryClient, "/home", [
      "update-preview-document-draft",
    ]);
    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(1);
  });

  it("reads once when no read was made for this open", async () => {
    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");
    await ensurePreviewDocumentDraftRead(queryClient, "doc-1");

    expect(reads("get-preview-document-draft")).toBe(2);
  });

  it("fails verification when the reader can no longer edit the page", async () => {
    server.respond = (name, params) =>
      Promise.resolve(
        name === "get-document"
          ? pageOrDraft(name, params)
          : { editable: false, draft: null },
      );

    await expect(
      ensurePreviewDocumentDraftRead(queryClient, "doc-1"),
    ).rejects.toThrow("no longer editable");
  });
});
