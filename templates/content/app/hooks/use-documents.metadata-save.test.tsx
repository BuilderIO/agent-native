// @vitest-environment happy-dom

import type { Document } from "@shared/api";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  calls: [] as string[],
  respond: (_name: string): Promise<unknown> =>
    Promise.reject(new Error("No answer was set up for this action.")),
}));

vi.mock("@agent-native/core/client/hooks", () => {
  const callAction = (name: string) => {
    server.calls.push(name);
    return server.respond(name);
  };
  return {
    callAction,
    getBrowserTabId: () => "tab-1",
    useDbSync: vi.fn(),
    // Mirrors core: the options run around the action call.
    useActionMutation: (name: string, options: object = {}) =>
      useMutation({ ...options, mutationFn: () => callAction(name) }),
    // Mirrors core: the action name and params are the query key.
    useActionQuery: (name: string, params: unknown, options: object) =>
      useQuery({
        queryKey: ["action", name, params],
        queryFn: () => callAction(name),
        ...options,
      }),
  };
});
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import {
  documentQueryKey,
  useDocument,
  useUpdateDocument,
} from "./use-documents";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const reads = () => server.calls.filter((name) => name === "get-document");

const opened: Document = {
  id: "doc-1",
  parentId: null,
  position: 0,
  title: "Plan",
  content: "Words before the agent",
  icon: null,
  isFavorite: false,
  hideFromSearch: false,
  visibility: "private",
  createdAt: "2026-10-17T00:00:00.000Z",
  updatedAt: "2026-10-17T00:00:01.000Z",
  revision: "body:1:sha256:before",
  bodyRevision: 1,
  contentHash: "sha256:before",
};
const agentEdited: Document = {
  ...opened,
  content: "Words the agent wrote",
  updatedAt: "2026-10-17T00:00:02.000Z",
  revision: "body:2:sha256:agent",
  bodyRevision: 2,
  contentHash: "sha256:agent",
};

describe("a save that sends no body", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let save: ReturnType<typeof useUpdateDocument>["mutateAsync"];
  const cached = () =>
    queryClient.getQueryData<Document>(documentQueryKey("doc-1"));

  function Editor() {
    useDocument("doc-1");
    save = useUpdateDocument().mutateAsync;
    return null;
  }

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.calls = [];
    server.respond = () => Promise.resolve(opened);
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Editor),
        ),
      );
    });
    await vi.waitFor(() => expect(cached()).toEqual(opened));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("keeps the cached body with its own revision until a read brings the newer body", async () => {
    const pairs = new Set<string>();
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const page = cached();
      if (page)
        pairs.add(`${page.content} | ${page.revision} | ${page.updatedAt}`);
    });
    const reread = deferred<Document>();
    server.respond = (name) =>
      name === "update-document"
        ? Promise.resolve({
            ...agentEdited,
            title: "Renamed",
            urlPath: "/page/doc-1",
            softDeletedDatabaseIds: [],
          })
        : reread.promise;

    try {
      await act(async () => {
        await save({ id: "doc-1", title: "Renamed" });
      });

      expect(cached()).toMatchObject({
        title: "Renamed",
        content: opened.content,
        revision: opened.revision,
        bodyRevision: opened.bodyRevision,
        contentHash: opened.contentHash,
        updatedAt: opened.updatedAt,
      });
      await vi.waitFor(() => expect(reads()).toHaveLength(2));

      await act(async () =>
        reread.resolve({ ...agentEdited, title: "Renamed" }),
      );

      await vi.waitFor(() =>
        expect(cached()).toEqual({ ...agentEdited, title: "Renamed" }),
      );
      expect([...pairs].sort()).toEqual(
        [
          `${opened.content} | ${opened.revision} | ${opened.updatedAt}`,
          `${agentEdited.content} | ${agentEdited.revision} | ${agentEdited.updatedAt}`,
        ].sort(),
      );
    } finally {
      unsubscribe();
    }
  });

  it("takes the answer's timestamp without reading again when the body did not move", async () => {
    const titled = "2026-10-17T00:00:03.000Z";
    server.respond = (name) =>
      name === "update-document"
        ? Promise.resolve({
            ...opened,
            title: "Renamed",
            updatedAt: titled,
            urlPath: "/page/doc-1",
            softDeletedDatabaseIds: [],
          })
        : Promise.resolve(opened);

    await act(async () => {
      await save({ id: "doc-1", title: "Renamed" });
    });

    expect(cached()).toEqual({
      ...opened,
      title: "Renamed",
      updatedAt: titled,
    });
    expect(reads()).toHaveLength(1);
  });
});
