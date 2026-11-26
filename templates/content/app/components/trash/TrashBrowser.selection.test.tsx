// @vitest-environment happy-dom

import type {
  ContentTrashItem,
  ContentTrashPurgeSpace,
} from "@shared/content-trash";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ContentTrashPurgeStart } from "@/hooks/use-content-trash";

import type { TrashPurgeDialog } from "./EmptyTrashDialog";
import { TrashBrowser } from "./TrashBrowser";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function trashItem(
  documentId: string,
  title: string,
  fields: Partial<ContentTrashItem> = {},
) {
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
    ...fields,
  } satisfies ContentTrashItem;
}

type RestoreInput = {
  id: string;
  expectedTrashedAt: string;
  idempotencyKey: string;
};

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
const purgeSpacesQuery: {
  data: { spaces: ContentTrashPurgeSpace[] } | undefined;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: { spaces: [{ spaceId: "space-a", name: "Personal", canPurge: true }] },
  isFetching: false,
  refetch: vi.fn(),
};
const restoreDocument = vi.fn<(input: RestoreInput) => Promise<unknown>>();
const restoreCollection =
  vi.fn<(input: { databaseId: string }) => Promise<unknown>>();
const toastSuccess = vi.fn();
const toastError = vi.fn();
let latestDialogProps: ComponentProps<typeof TrashPurgeDialog> | undefined;
let purgeStarts: ContentTrashPurgeStart[] = [];

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
vi.mock("@/hooks/use-content-database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-database")>()),
  useRestoreContentDatabase: () => ({
    isPending: false,
    mutateAsync: (input: { databaseId: string }) => restoreCollection(input),
  }),
}));
vi.mock("@/hooks/use-content-trash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-content-trash")>()),
  useContentTrash: (_filters: unknown, groupId?: string) =>
    groupId ? childQuery : rootQuery,
  useRestoreTrashPage: () => ({
    isPending: false,
    mutateAsync: (input: RestoreInput) => restoreDocument(input),
  }),
  useContentTrashPurgeSpaces: () => purgeSpacesQuery,
  useContentTrashFilterOptions: () => ({ data: undefined }),
  useTrashContext: () => {},
  writeTrashContext: () => Promise.resolve({}),
  readTrashPurgeStarts: () => Promise.resolve(purgeStarts),
}));
vi.mock("@/components/editor/TrashDocumentPreview", () => ({
  TrashDocumentPreview: () => null,
}));
vi.mock("./EmptyTrashDialog", () => ({
  TrashPurgeDialog: (props: ComponentProps<typeof TrashPurgeDialog>) => {
    latestDialogProps = props;
    return props.request ? <div data-purge-dialog="" /> : null;
  },
  TrashOperationSurface: ({
    starts,
  }: {
    starts: readonly ContentTrashPurgeStart[] | undefined;
  }) =>
    starts?.length ? (
      <output data-operation-surface="">
        {starts.map((start) => start.operationId).join(",")}
      </output>
    ) : null,
}));

let root: Root | null = null;

function restored(input: RestoreInput) {
  return Promise.resolve({
    success: true,
    documentId: input.id,
    affectedDocumentIds: [input.id],
    affectedDocumentIdsComplete: true,
    receipt: { outcome: "restored" },
  });
}

function deferred() {
  const handle = { resolve: () => {} };
  const promise = new Promise<void>((resolve) => {
    handle.resolve = resolve;
  });
  return { promise, resolve: () => handle.resolve() };
}

beforeEach(() => {
  restoreDocument.mockImplementation(restored);
  restoreCollection.mockImplementation(({ databaseId }) =>
    Promise.resolve({ success: true, databaseId }),
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  purgeStarts = [];
  rootQuery.data = { pages: [{ items }] };
  purgeSpacesQuery.data = {
    spaces: [{ spaceId: "space-a", name: "Personal", canPurge: true }],
  };
  purgeSpacesQuery.isFetching = false;
  latestDialogProps = undefined;
  restoreDocument.mockReset();
  restoreCollection.mockReset();
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

const emptyTrashButton = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>(
    'button[aria-label="trash.emptyTrash"]',
  );
const latestDialog = () => latestDialogProps;

describe("Trash selection bar", () => {
  it("shows the finished purge notice inline after the table, leaving the bar usable", async () => {
    purgeStarts = [
      {
        spaceId: "space-a",
        planId: "plan-1",
        idempotencyKey: "key-1",
        status: "started",
        operationId: "op-1",
        error: null,
      },
    ];
    const host = await renderTrash();
    const surface = host.querySelector("main [data-operation-surface]");
    const table = host.querySelector('[aria-label="trash.tableLabel"]');

    expect(surface?.textContent).toBe("op-1");
    expect(surface?.previousElementSibling?.contains(table)).toBe(true);

    await tick(host, "Alpha");
    await tick(host, "Beta");

    expect(host.textContent).toContain('trash.selected {"count":2}');
    expect(barButton(host, "trash.restore")?.disabled).toBe(false);
    expect(barButton(host, "trash.deletePermanently")).not.toBeUndefined();
    expect(barButton(host, "trash.cancel")).not.toBeUndefined();
  });

  it("restores every ticked page against its listed deletion and keeps only the failures selected", async () => {
    restoreDocument.mockImplementation((input) =>
      input.id === "page-b"
        ? Promise.reject(new Error("offline"))
        : restored(input),
    );
    const host = await renderTrash();
    await tick(host, "Alpha");
    await tick(host, "Beta");
    await tick(host, "Gamma");

    await act(async () => barButton(host, "trash.restore")?.click());
    await settle();

    const inputs = restoreDocument.mock.calls.map(([input]) => input);
    expect(inputs.map((input) => input.id)).toEqual([
      "page-a",
      "page-b",
      "page-c",
    ]);
    expect(
      inputs.every(
        (input) => input.expectedTrashedAt === "2026-11-20T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(new Set(inputs.map((input) => input.idempotencyKey)).size).toBe(3);
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

    expect(restoreDocument).toHaveBeenCalledExactlyOnceWith({
      id: "page-b",
      expectedTrashedAt: "2026-11-20T00:00:00.000Z",
      idempotencyKey: expect.any(String),
    });
    expect(toastSuccess).toHaveBeenCalledWith("trash.restored");
  });

  it("restores a legacy Collection through the Collection path, from the arrow and in a mixed selection", async () => {
    rootQuery.data = {
      pages: [
        {
          items: [
            trashItem("page-a", "Alpha"),
            trashItem("legacy-row", "Old tasks", {
              kind: "database",
              legacyRestoreDatabaseId: "legacy-db",
            }),
          ],
        },
      ],
    };
    const host = await renderTrash();
    const arrows = host.querySelectorAll<HTMLButtonElement>(
      'button[data-trash-row-restore][aria-label="trash.restore"]',
    );

    await act(async () => arrows[1]?.click());
    await settle();

    expect(restoreCollection).toHaveBeenCalledExactlyOnceWith({
      databaseId: "legacy-db",
    });
    expect(restoreDocument).not.toHaveBeenCalled();

    restoreCollection.mockClear();
    await tick(host, "Alpha");
    await tick(host, "Old tasks");
    await act(async () => barButton(host, "trash.restore")?.click());
    await settle();

    expect(restoreDocument.mock.calls.map(([input]) => input.id)).toEqual([
      "page-a",
    ]);
    expect(restoreCollection).toHaveBeenCalledExactlyOnceWith({
      databaseId: "legacy-db",
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("trash.selected");
  });

  it("keeps a page ticked when another tab restored and deleted it again first", async () => {
    restoreDocument.mockImplementation((input) =>
      input.id === "page-b"
        ? Promise.reject(
            Object.assign(new Error("Trash revision changed"), {
              status: 409,
              errorCode: "TRASH_REVISION_CONFLICT",
            }),
          )
        : restored(input),
    );
    const host = await renderTrash();
    await tick(host, "Alpha");
    await tick(host, "Beta");

    await act(async () => barButton(host, "trash.restore")?.click());
    await settle();

    expect(toastError).toHaveBeenCalledWith("trash.restoreFailed", {
      description: "trash.restoreConflict",
    });
    expect(host.textContent).toContain('trash.selected {"count":1}');
    expect(
      host
        .querySelector(
          `button[role="checkbox"][aria-label='trash.selectPage {"title":"Beta"}']`,
        )
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("clears restored rows from the selection the person has now, not the one the batch started with", async () => {
    const first = deferred();
    restoreDocument.mockImplementation(async (input) => {
      if (input.id === "page-a") await first.promise;
      return restored(input);
    });
    const host = await renderTrash();
    await tick(host, "Alpha");
    await tick(host, "Beta");

    await act(async () => barButton(host, "trash.restore")?.click());
    await tick(host, "Gamma");
    expect(host.textContent).toContain('trash.selected {"count":3}');

    await act(async () => first.resolve());
    await settle();

    expect(restoreDocument.mock.calls.map(([input]) => input.id)).toEqual([
      "page-a",
      "page-b",
    ]);
    expect(host.textContent).toContain('trash.selected {"count":1}');
    expect(
      host
        .querySelector(
          `button[role="checkbox"][aria-label='trash.selectPage {"title":"Gamma"}']`,
        )
        ?.getAttribute("aria-checked"),
    ).toBe("true");
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

describe("Trash permanent deletion", () => {
  it("keeps Empty Trash unavailable until the purgeable workspaces load", async () => {
    purgeSpacesQuery.data = undefined;
    purgeSpacesQuery.isFetching = true;
    const host = await renderTrash();
    const button = emptyTrashButton(host);

    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    await act(async () => button?.click());
    expect(latestDialog()?.request ?? null).toBeNull();
    expect(purgeSpacesQuery.refetch).not.toHaveBeenCalled();

    purgeSpacesQuery.data = {
      spaces: [{ spaceId: "space-a", name: "Personal", canPurge: true }],
    };
    purgeSpacesQuery.isFetching = false;
    await rerenderTrash();
    expect(emptyTrashButton(host)?.hasAttribute("aria-disabled")).toBe(false);
  });

  it("plans Empty Trash only where the server says the caller may purge", async () => {
    purgeSpacesQuery.data = {
      spaces: [
        { spaceId: "space-a", name: "Personal", canPurge: true },
        { spaceId: "viewer-space", name: "Team", canPurge: false },
      ],
    };
    const host = await renderTrash();

    await act(async () => emptyTrashButton(host)?.click());
    await settle();

    expect(latestDialog()?.request).toEqual({
      kind: "empty",
      targets: [
        { spaceId: "space-a", input: { mode: "scope", spaceId: "space-a" } },
      ],
      unavailableSpaceIds: ["viewer-space"],
    });
    expect(latestDialog()?.spaceName("viewer-space")).toBe("Team");
  });

  it("returns focus to the row's ⋯ after its delete dialog closes, and to Empty Trash once the row is gone", async () => {
    const host = await renderTrash();
    const trigger = host.querySelector<HTMLButtonElement>(
      `button[aria-label='trash.rowActions {"title":"Alpha"}']`,
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.focus();
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const deleteItem = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "trash.deletePermanently");
    expect(deleteItem).not.toBeUndefined();
    await act(async () => {
      deleteItem?.focus();
      deleteItem?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await vi.waitFor(() =>
      expect(latestDialog()?.request?.targets).toEqual([
        {
          spaceId: "space-a",
          input: { mode: "selection", documentIds: ["page-a"] },
        },
      ]),
    );

    expect(latestDialog()?.returnFocus()).toBe(trigger);

    rootQuery.data = {
      pages: [{ items: items.filter((item) => item.documentId !== "page-a") }],
    };
    await rerenderTrash();

    expect(latestDialog()?.returnFocus()).toBe(emptyTrashButton(host));
  });

  it("ignores an older dialog's close and acknowledgment once a newer one is open", async () => {
    const host = await renderTrash();
    await act(async () => emptyTrashButton(host)?.click());
    await settle();
    const older = latestDialog();
    expect(older?.request).not.toBeNull();

    await act(async () => older?.onClose());
    expect(latestDialog()?.request).toBeNull();
    await act(async () => emptyTrashButton(host)?.click());
    await settle();
    const newer = latestDialog();
    expect(newer?.request).not.toBe(older?.request);

    await act(async () => {
      older?.onAcknowledged();
      older?.onClose();
    });
    expect(latestDialog()?.request).toBe(newer?.request);

    await act(async () => newer?.onAcknowledged());
    expect(latestDialog()?.request).toBeNull();
  });
});
