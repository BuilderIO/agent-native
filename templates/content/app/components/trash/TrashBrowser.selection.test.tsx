// @vitest-environment happy-dom

import type { ContentTrashItem } from "@shared/content-trash";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TrashBrowser } from "./TrashBrowser";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function trashItem(documentId: string, title: string) {
  return {
    documentId,
    databaseId: null,
    legacyRestoreDatabaseId: null,
    title,
    kind: "page",
    createdByState: "unresolved",
    updatedByState: "unresolved",
    trashedAt: "2026-11-20T00:00:00.000Z",
    trashedBy: null,
    trashedByState: "unresolved",
    trashOrigin: null,
    trashRootId: documentId,
    parentId: null,
    parentTitle: null,
    spaceId: "space-a",
    spaceName: "Personal",
    canRestore: true,
    canPermanentlyDelete: true,
    hasAccessibleTrashedChildren: false,
  } satisfies ContentTrashItem;
}

const items = [
  trashItem("page-a", "Alpha"),
  trashItem("page-b", "Beta"),
  trashItem("page-c", "Gamma"),
];
const rootQuery = {
  data: { pages: [{ items }] },
  isLoading: false,
  isError: false,
  isFetching: false,
  isPlaceholderData: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  refetch: vi.fn(),
  fetchNextPage: vi.fn(),
};
const childQuery = { ...rootQuery, data: { pages: [{ items: [] }] } };
const restoreDocument = vi.fn<(input: { id: string }) => Promise<unknown>>();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let operationIds: string[] = [];

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to: _to,
    ...props
  }: React.ComponentProps<"a"> & { to: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));
vi.mock("@/hooks/use-content-spaces", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-spaces")>()),
  useContentSpaces: () => ({
    data: { spaces: [{ id: "space-a", name: "Personal" }] },
  }),
}));
vi.mock("@/hooks/use-content-trash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-trash")>()),
  useContentTrash: (_filters: unknown, groupId?: string) =>
    groupId ? childQuery : rootQuery,
  useRestoreTrashItem: () => ({
    isPending: false,
    mutateAsync: (input: { id: string }) => restoreDocument(input),
  }),
  useTrashContext: () => {},
  readTrashOperationIds: () => Promise.resolve(operationIds),
}));
vi.mock("@/components/editor/TrashDocumentPreview", () => ({
  TrashDocumentPreview: () => null,
}));
vi.mock("./EmptyTrashDialog", () => ({
  TrashPurgeDialog: () => null,
  TrashOperationSurface: ({
    operationIds: ids,
  }: {
    operationIds: readonly string[] | null | undefined;
  }) => <output data-operation-ids="">{ids?.join(",")}</output>,
}));

let root: Root | null = null;

beforeEach(() => {
  restoreDocument.mockImplementation(() =>
    Promise.resolve({ success: true, restored: 1 }),
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  operationIds = [];
  rootQuery.data = { pages: [{ items }] };
  restoreDocument.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  document.body.replaceChildren();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderTrash() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await rerenderTrash();
  return host;
}

async function rerenderTrash() {
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <TrashBrowser />
      </TooltipProvider>,
    );
  });
  await settle();
}

async function tick(host: HTMLElement, title: string) {
  const checkbox = host.querySelector<HTMLButtonElement>(
    `button[role="checkbox"][aria-label='trash.selectPage {"title":"${title}"}']`,
  );
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox?.click());
}

function barButton(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  );
}

describe("Trash selection bar", () => {
  it("stays available while a finished purge notice is showing", async () => {
    operationIds = ["op-1"];
    const host = await renderTrash();

    expect(host.querySelector("[data-operation-ids]")?.textContent).toBe(
      "op-1",
    );

    await tick(host, "Alpha");
    await tick(host, "Beta");

    expect(host.textContent).toContain('trash.selected {"count":2}');
    expect(barButton(host, "trash.restore")?.disabled).toBe(false);
    expect(barButton(host, "trash.deletePermanently")).not.toBeUndefined();
    expect(barButton(host, "trash.cancel")).not.toBeUndefined();
  });

  it("restores every ticked page and keeps only the failures selected", async () => {
    restoreDocument.mockImplementation(({ id }) =>
      id === "page-b"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ success: true, restored: 1 }),
    );
    const host = await renderTrash();
    await tick(host, "Alpha");
    await tick(host, "Beta");
    await tick(host, "Gamma");

    await act(async () => barButton(host, "trash.restore")?.click());
    await settle();

    expect(restoreDocument.mock.calls.map(([input]) => input.id)).toEqual([
      "page-a",
      "page-b",
      "page-c",
    ]);
    expect(toastSuccess).toHaveBeenCalledWith(
      'trash.restoredCount {"count":2}',
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('trash.selected {"count":1}');
  });

  it("restores one page from its row arrow", async () => {
    const host = await renderTrash();
    const arrows = host.querySelectorAll<HTMLButtonElement>(
      'button[data-trash-row-restore][aria-label="trash.restore"]',
    );

    await act(async () => arrows[1]?.click());
    await settle();

    expect(restoreDocument).toHaveBeenCalledExactlyOnceWith({ id: "page-b" });
    expect(toastSuccess).toHaveBeenCalledWith("trash.restored");
  });

  it("moves focus to Empty Trash when the focused page was the last one", async () => {
    rootQuery.data = { pages: [{ items: [trashItem("page-a", "Alpha")] }] };
    const host = await renderTrash();
    const row = host.querySelector<HTMLElement>('[role="row"][tabindex]');
    await act(async () => row?.focus());

    rootQuery.data = { pages: [{ items: [] }] };
    await rerenderTrash();

    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "trash.emptyTrash",
      ),
    );
  });
});
