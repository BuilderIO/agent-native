// @vitest-environment happy-dom

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  callActionWithRetry: read,
  useActionQuery: (
    action: string,
    params: object,
    options?: { refetchOnMount?: "always" },
  ) =>
    useQuery({
      queryKey: [action, params],
      queryFn: () => read(action, params),
      retry: false,
      ...options,
    }),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { MovePageDialog, type MovePageTarget } from "./MovePageDialog";

const space = {
  id: "space",
  name: "Space",
  filesDatabaseId: "files",
  orgId: null,
};
const target = { documentId: "moving", title: "Moving", spaceId: "space" };
function row(id: string, type = "page") {
  return { documentId: id, title: id, type, icon: null, parentId: null };
}
function response(items: ReturnType<typeof row>[], nextCursor: string | null) {
  return {
    items,
    pagination: { limit: 20, hasMore: nextCursor !== null, nextCursor },
  };
}
let queryClient: QueryClient;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  read.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
});

it("pages through scoped search and resets continuation when the search changes", async () => {
  read.mockImplementation(async (action, params) => {
    if (action !== "search-documents")
      return response([row("root")], "root-next");
    const id = `${params.query}-${params.offset}`;
    return {
      documents: [
        { id, title: id, icon: null, parentTitle: null },
        {
          id: "search-folder",
          title: "search-folder",
          sourceKind: "folder",
          icon: null,
          parentTitle: null,
        },
      ],
      pagination: {
        hasMore: params.offset === 0,
        nextOffset: params.offset === 0 ? 20 : null,
      },
    };
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("root"));
  async function search(value: string) {
    const input = document.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await search("plan");
  await vi.waitFor(() => expect(document.body.textContent).toContain("plan-0"));
  expect(document.body.textContent).not.toContain("search-folder");
  const more = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => element.textContent.includes("sidebar.showMore"));
  if (!more) throw new Error("Missing continuation");
  await act(async () => more.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("plan-20"),
  );
  expect(read).toHaveBeenCalledWith(
    "search-documents",
    expect.objectContaining({
      query: "plan",
      spaceId: "space",
      documentType: "page",
      excludeSubtreeOf: "moving",
      limit: 20,
      offset: 20,
    }),
  );
  await search("other");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("other-0"),
  );
  expect(document.body.textContent).not.toContain("plan-20");
  expect(
    read.mock.calls.some(
      ([action, params]) =>
        action === "search-documents" &&
        params.query === "other" &&
        params.offset === 20,
    ),
  ).toBe(false);
  await search("");
  await vi.waitFor(() => expect(document.body.textContent).toContain("root"));
  expect(document.body.textContent).not.toContain("plan-20");
});

it("starts at the first page when switching spaces", async () => {
  const other = {
    id: "other",
    name: "Other space",
    filesDatabaseId: "other-files",
    orgId: null,
  };
  read.mockImplementation(async (_action, params) =>
    response(
      [row(`${params.databaseId}-${params.navigation.cursor ?? "first"}`)],
      params.navigation.cursor ? null : "next",
    ),
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space, other]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("files-first"),
  );
  const more = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("sidebar.showMore"));
  if (!more) throw new Error("Missing continuation");
  await act(async () => more.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("files-next"),
  );
  const trigger = document.querySelector<HTMLElement>(
    '[aria-label="sidebar.chooseSpace"]',
  );
  if (!trigger) throw new Error("Missing space selector");
  await act(async () =>
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    ),
  );
  const choice = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ].find((item) => item.textContent.includes("Other space"));
  if (!choice) throw new Error("Missing other space");
  await act(async () => choice.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("other-files-first"),
  );
  expect(document.body.textContent).not.toContain("files-next");
  expect(
    read.mock.calls.some(
      ([, params]) =>
        params.databaseId === "other-files" &&
        params.navigation.cursor === "next",
    ),
  ).toBe(false);
});

it("does not offer cached destinations while reopening is reauthorizing", async () => {
  let answer!: (value: ReturnType<typeof response>) => void;
  read.mockResolvedValueOnce(response([row("old")], null));
  const render = (page: MovePageTarget | null) =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={page}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    );
  await act(async () => render(target));
  await vi.waitFor(() => expect(document.body.textContent).toContain("old"));
  await act(async () => render(null));
  read.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  await act(async () => render(target));
  expect(document.body.textContent).not.toContain("old");
  expect(
    document.body.querySelectorAll("[data-sidebar-row-placeholder]").length,
  ).toBeGreaterThan(0);
  expect(document.body.textContent).toContain("sidebar.topLevel");
  await act(async () => answer(response([row("fresh")], null)));
  await vi.waitFor(() => expect(document.body.textContent).toContain("fresh"));
});

it("shows a placeholder instead of cached search results during revalidation", async () => {
  let resolveSearch!: (value: {
    documents: Array<{
      id: string;
      title: string;
      icon: null;
      parentTitle: null;
    }>;
    pagination: { hasMore: boolean; nextOffset: null };
  }) => void;
  const searchResult = (id: string) => ({
    documents: [{ id, title: id, icon: null, parentTitle: null }],
    pagination: { hasMore: false, nextOffset: null },
  });
  let searches = 0;
  read.mockImplementation(async (action) => {
    if (action !== "search-documents") return response([row("root")], null);
    if (searches++ === 0) return searchResult("old-search");
    return new Promise((resolve) => {
      resolveSearch = resolve;
    });
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  async function search(value: string) {
    const input = document.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await search("plan");
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("old-search"),
  );
  await search("");
  await vi.waitFor(() => expect(document.body.textContent).toContain("root"));
  await search("plan");
  await vi.waitFor(() => expect(searches).toBe(2));
  expect(document.body.textContent).not.toContain("old-search");
  expect(
    document.body.querySelectorAll("[data-sidebar-row-placeholder]").length,
  ).toBeGreaterThan(0);
  expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(0);
  await act(async () => resolveSearch(searchResult("fresh-search")));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("fresh-search"),
  );
});

it("allows moving to top level when the destination list fails", async () => {
  read.mockRejectedValue(new Error("Unavailable"));
  const onMove = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={onMove}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("root.searchRetry"),
  );
  const topLevel = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("sidebar.topLevel"));
  if (!topLevel) throw new Error("Missing top level");
  await act(async () => topLevel.click());
  expect(onMove).toHaveBeenCalledWith(target, {
    spaceId: "space",
    parentId: null,
  });
});

it("restarts from the first page after retrying a stale cursor", async () => {
  let firstRead = true;
  read.mockImplementation(async (_action, params) => {
    if (params.navigation.cursor)
      throw Object.assign(new Error("stale"), {
        errorCode: "invalid_navigation_cursor",
        status: 400,
      });
    const initial = firstRead;
    firstRead = false;
    return response(
      [row(initial ? "old-first" : "new-first")],
      initial ? "stale-cursor" : null,
    );
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("old-first"),
  );
  const more = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("sidebar.showMore"));
  if (!more) throw new Error("Missing continuation");
  await act(async () => more.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("root.searchRetry"),
  );
  const retry = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("root.searchRetry"));
  if (!retry) throw new Error("Missing retry");
  await act(async () => retry.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("new-first"),
  );
  expect(
    read.mock.calls.filter(
      ([, params]) => params.navigation.cursor === "stale-cursor",
    ),
  ).toHaveLength(1);
});

it("withdraws cached page destinations when a continuation reports the database unavailable", async () => {
  read.mockImplementation(async (_action, params) =>
    params.navigation.cursor
      ? { available: false, reason: "deleted", databaseId: "files" }
      : response([row("old")], "next"),
  );
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("old"));
  const more = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("sidebar.showMore"));
  if (!more) throw new Error("Missing continuation");
  await act(async () => more.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).not.toContain("old"),
  );
  expect(document.body.textContent).toContain("sidebar.topLevel");
  expect(document.body.textContent).toContain("empty.genericError");
});

it("recovers from a cached unavailable response after retry", async () => {
  let resolveRetry!: (value: ReturnType<typeof response>) => void;
  let attempts = 0;
  read.mockImplementation(async (_action, params) => {
    if (params.navigation.cursor)
      return { available: false, reason: "deleted", databaseId: "files" };
    if (attempts++ === 0) return response([row("old")], "next");
    return new Promise((resolve) => {
      resolveRetry = resolve;
    });
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={target}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={() => {}}
        />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("old"));
  const more = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("sidebar.showMore"));
  if (!more) throw new Error("Missing continuation");
  await act(async () => more.click());
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("root.searchRetry"),
  );
  const retry = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((item) => item.textContent.includes("root.searchRetry"));
  if (!retry) throw new Error("Missing retry");
  await act(async () => retry.click());
  await vi.waitFor(() => expect(attempts).toBe(2));
  await act(async () => resolveRetry(response([row("recovered")], null)));
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("recovered"),
  );
});

it.each([401, 403, 404])(
  "shows retry when continuation is refused with %i",
  async (status) => {
    let refused = true;
    read.mockImplementation(async (_action, params) => {
      if (params.navigation.cursor && refused) {
        refused = false;
        throw Object.assign(new Error("refused"), { status });
      }
      return response(
        [row(refused ? "old" : "recovered")],
        refused ? "next" : null,
      );
    });
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MovePageDialog
            page={target}
            spaces={[space]}
            onOpenChange={() => {}}
            onMove={() => {}}
          />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain("old"));
    const more = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent.includes("sidebar.showMore"));
    if (!more) throw new Error("Missing continuation");
    await act(async () => more.click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("root.searchRetry"),
    );
    expect(document.body.textContent).not.toContain("old");
    const retry = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent.includes("root.searchRetry"));
    if (!retry) throw new Error("Missing retry");
    await act(async () => retry.click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("recovered"),
    );
  },
);

it("loads later pages on request and refetches the first page on reopening", async () => {
  let first = response([row("first"), row("folder", "folder")], "cursor-2");
  read.mockImplementation(async (_action, params) =>
    params.navigation.cursor ? response([row("later")], null) : first,
  );
  const onMove = vi.fn();
  function render(page: MovePageTarget | null) {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MovePageDialog
          page={page}
          spaces={[space]}
          onOpenChange={() => {}}
          onMove={onMove}
        />
      </QueryClientProvider>,
    );
  }
  await act(async () => render(target));
  await vi.waitFor(() => expect(document.body.textContent).toContain("first"));
  expect(document.body.textContent).not.toContain("folder");
  const more = Array.from(
    document.querySelectorAll('[role="option"], button'),
  ).find((element) => element.textContent.includes("sidebar.showMore"));
  expect(more).toBeDefined();
  await act(async () => (more as HTMLElement).click());
  await vi.waitFor(() => expect(document.body.textContent).toContain("later"));
  expect(
    read.mock.calls.some(
      ([, params]) =>
        params.navigation.cursor === "cursor-2" &&
        params.navigation.pagesOnly === true &&
        params.limit === 20,
    ),
  ).toBe(true);
  const later = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => element.textContent === "later");
  if (!later) throw new Error("Missing later destination");
  await act(async () => later.click());
  expect(onMove).toHaveBeenCalledWith(target, {
    spaceId: "space",
    parentId: "later",
  });

  await act(async () => render(null));
  first = response([row("fresh")], null);
  await act(async () => render(target));
  await vi.waitFor(() => expect(document.body.textContent).toContain("fresh"));
  expect(document.body.textContent).not.toContain("later");
});

it.each([
  {
    kind: "private",
    orgId: null,
    warning: "sidebar.moveToSpaceWarningPrivate",
  },
  { kind: "shared", orgId: "org", warning: "sidebar.moveToSpaceWarningShared" },
])(
  "opens on the Page's own space and asks before moving it to a $kind one",
  async ({ orgId, warning }) => {
    const other = {
      id: "other",
      name: "Other space",
      filesDatabaseId: "other-files",
      orgId,
    };
    read.mockResolvedValue(response([row("root")], null));
    const onMove = vi.fn();
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <MovePageDialog
            page={target}
            spaces={[other, space]}
            onOpenChange={() => {}}
            onMove={onMove}
          />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain("root"));
    const trigger = document.querySelector<HTMLElement>(
      '[aria-label="sidebar.chooseSpace"]',
    );
    if (!trigger) throw new Error("Missing space selector");
    expect(trigger.textContent.trim()).toBe("Space");

    await act(async () =>
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
    const choice = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ].find((item) => item.textContent.includes("Other space"));
    if (!choice) throw new Error("Missing other space");
    await act(async () => choice.click());
    const topLevel = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent.includes("sidebar.topLevel"));
    if (!topLevel) throw new Error("Missing top level");
    await act(async () => topLevel.click());

    expect(onMove).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-move-space-warning]")?.textContent,
    ).toContain(warning);
    const confirm = [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent.trim() === "sidebar.movePage",
    );
    if (!confirm) throw new Error("Missing move confirmation");
    await act(async () => confirm.click());
    expect(onMove).toHaveBeenCalledWith(target, {
      spaceId: "other",
      parentId: null,
    });
  },
);
