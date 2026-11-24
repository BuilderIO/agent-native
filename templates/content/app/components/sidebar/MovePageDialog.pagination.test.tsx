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
