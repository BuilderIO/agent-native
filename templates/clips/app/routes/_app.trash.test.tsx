// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

const mocks = vi.hoisted(() => ({
  recordings: [] as Array<{ id: string }>,
  cleanups: undefined as { cleanups: unknown[] } | undefined,
  purge: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.cleanups,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useActionMutation: (action: string) => ({
    mutateAsync:
      action === "delete-recording-permanent" ? mocks.purge : vi.fn(),
  }),
}));

// Resolves keys against the real English catalog so copy changes show up here.
vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, values?: Record<string, string | number | undefined>) => {
      const found = key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          messages,
        );
      if (typeof found !== "string") throw new Error(`Missing copy: ${key}`);
      return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? ""),
      );
    },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/use-library", () => ({
  dedupeRecordingsById: (recordings: unknown[]) => recordings,
  useRecordingsCount: () => ({ data: mocks.recordings.length }),
  useInfiniteRecordings: () => ({
    data: { pages: [{ recordings: mocks.recordings }] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
  }),
}));

vi.mock("@/components/library/recording-card", () => ({
  RecordingCard: ({
    recording,
    onToggleSelect,
    onTrash,
  }: {
    recording: { id: string };
    onToggleSelect: (id: string) => void;
    onTrash: () => void;
  }) => (
    <div>
      <button
        data-select={recording.id}
        onClick={() => onToggleSelect(recording.id)}
      />
      <button data-trash={recording.id} onClick={onTrash} />
    </div>
  ),
}));

vi.mock("@/components/library/empty-state", () => ({
  EmptyState: () => <div data-testid="empty-trash" />,
}));

vi.mock("@/components/library/page-header", () => ({
  PageBreadcrumb: () => null,
  PageHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/library/sort-menu", () => ({ SortMenu: () => null }));

vi.mock("@/components/ui/alert-dialog", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => (open ? <div data-testid="dialog">{children}</div> : null),
    AlertDialogAction: ({
      children,
      onClick,
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button onClick={onClick}>{children}</button>
    ),
    AlertDialogCancel: Passthrough,
    AlertDialogContent: Passthrough,
    AlertDialogDescription: Passthrough,
    AlertDialogFooter: Passthrough,
    AlertDialogHeader: Passthrough,
    AlertDialogTitle: Passthrough,
  };
});

import TrashRoute from "./_app.trash";

const cleanup = (status: string) => ({
  status,
  pending: status === "pending" ? 1 : 0,
  blocked: status === "blocked" ? 1 : 0,
  deleted: status === "complete" ? 2 : 0,
  retained: status === "retained_shared" ? 1 : 0,
});

const deleted = (id: string, status: string) => ({
  success: status === "complete",
  id,
  recordingRemoved: true,
  mediaCleanup: cleanup(status),
});

const listed = (id: string, status: string) => ({
  ...cleanup(status),
  id,
  recordingId: id,
  reason: null,
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:05:00.000Z",
});

const RETAINED_TOAST =
  "Recording deleted. Media files other recordings still use were kept.";
const RETAINED_ROW =
  "Shared media files from deleted recordings are kept while other recordings use them";

describe("TrashRoute permanent delete", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  const render = () =>
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TrashRoute />
        </QueryClientProvider>,
      );
    });

  const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy();
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  const dialogAction = () =>
    Array.from(
      container.querySelectorAll('[data-testid="dialog"] button'),
    ).find((button) => button.textContent === "Delete forever");

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    mocks.recordings = [];
    mocks.cleanups = { cleanups: [] };
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each([
    ["complete", "success", "Permanently deleted"],
    ["retained_shared", "info", RETAINED_TOAST],
    [
      "pending",
      "info",
      "Recording deleted. Media removal is still in progress.",
    ],
    [
      "blocked",
      "warning",
      "Recording deleted, but its media files couldn't be removed.",
    ],
  ] as const)(
    "reports a %s media cleanup without overclaiming",
    async (status, variant, message) => {
      mocks.recordings = [{ id: "rec-1" }];
      mocks.purge.mockResolvedValue(deleted("rec-1", status));
      render();

      await click(container.querySelector('[data-trash="rec-1"]'));
      await click(dialogAction());

      expect(mocks.purge).toHaveBeenCalledWith({ id: "rec-1" });
      expect(toast[variant]).toHaveBeenCalledTimes(1);
      expect(toast[variant]).toHaveBeenCalledWith(message);
      const others = (["success", "info", "warning", "error"] as const).filter(
        (name) => name !== variant,
      );
      for (const name of others) expect(toast[name]).not.toHaveBeenCalled();
    },
  );

  it("never reports kept shared media as removed, even if the server says success", async () => {
    mocks.recordings = [{ id: "rec-1" }];
    mocks.purge.mockResolvedValue({
      ...deleted("rec-1", "retained_shared"),
      success: true,
    });
    render();

    await click(container.querySelector('[data-trash="rec-1"]'));
    await click(dialogAction());

    expect(toast.info).toHaveBeenCalledWith(RETAINED_TOAST);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("separates confirmed, kept, unfinished, and failed deletes in a bulk delete", async () => {
    mocks.recordings = [
      { id: "rec-1" },
      { id: "rec-2" },
      { id: "rec-3" },
      { id: "rec-4" },
    ];
    mocks.purge.mockImplementation(async ({ id }: { id: string }) => {
      if (id === "rec-1") return deleted(id, "complete");
      if (id === "rec-2") return deleted(id, "pending");
      if (id === "rec-4") return deleted(id, "retained_shared");
      throw new Error("Network error");
    });
    render();

    for (const id of ["rec-1", "rec-2", "rec-3", "rec-4"]) {
      await click(container.querySelector(`[data-select="${id}"]`));
    }
    const headerDelete = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Delete forever",
    );
    await click(headerDelete);
    await click(dialogAction());

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("1 clips permanently deleted");
    expect(toast.info).toHaveBeenCalledWith(
      "Recordings deleted: 1. Media removal is still in progress.",
    );
    expect(toast.info).toHaveBeenCalledWith(
      "Recordings deleted: 1. Media files other recordings still use were kept.",
    );
    expect(toast.error).toHaveBeenCalledWith("1 clips could not be deleted");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-recordings"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-recording-media-cleanups"],
    });
    expect(container.textContent).toContain("1 selected");

    // The failed request had removed rec-3 after all; the refetch says so.
    mocks.recordings = [];
    render();
    expect(container.textContent).not.toContain("selected");
  });

  it("shows unfinished media cleanup read from the server in an empty Trash", () => {
    mocks.cleanups = { cleanups: [listed("rec-9", "blocked")] };
    render();

    expect(container.querySelector('[data-testid="empty-trash"]')).toBeTruthy();
    expect(container.textContent).toContain(
      "Media files from deleted recordings couldn't be removed",
    );
  });

  it("shows kept shared media read from the server in an empty Trash", () => {
    mocks.cleanups = { cleanups: [listed("rec-8", "retained_shared")] };
    render();

    expect(container.querySelector('[data-testid="empty-trash"]')).toBeTruthy();
    expect(container.textContent).toContain(RETAINED_ROW);
  });
});
