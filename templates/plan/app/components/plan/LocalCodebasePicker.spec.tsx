// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clearLocalCodebaseSelectionMock = vi.hoisted(() => vi.fn());
const collectLocalCodebaseSnapshotMock = vi.hoisted(() => vi.fn());
const deleteLocalCodebaseResourcesMock = vi.hoisted(() => vi.fn());
const deleteLocalControlResourcesMock = vi.hoisted(() => vi.fn());
const rememberLocalCodebaseSelectionMock = vi.hoisted(() => vi.fn());
const restoreLocalCodebaseSelectionMock = vi.hoisted(() => vi.fn());
const setClientAppStateMock = vi.hoisted(() => vi.fn());
const syncLocalCodebaseSnapshotMock = vi.hoisted(() => vi.fn());
const syncLocalControlResourcesMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  setClientAppState: (...args: unknown[]) => setClientAppStateMock(...args),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tabler/icons-react", () => ({
  IconAlertCircle: () => null,
  IconCircleCheck: () => null,
  IconFolderOpen: () => null,
  IconRefresh: () => null,
  IconX: () => null,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMock, { error: toastErrorMock }),
}));

vi.mock("@/lib/local-codebase-context", () => ({
  chooseLocalCodebase: vi.fn(),
  clearLocalCodebaseSelection: (...args: unknown[]) =>
    clearLocalCodebaseSelectionMock(...args),
  collectLocalCodebaseSnapshot: (...args: unknown[]) =>
    collectLocalCodebaseSnapshotMock(...args),
  deleteLocalCodebaseResources: (...args: unknown[]) =>
    deleteLocalCodebaseResourcesMock(...args),
  localCodebaseAppState: vi.fn(() => ({})),
  rememberLocalCodebaseSelection: (...args: unknown[]) =>
    rememberLocalCodebaseSelectionMock(...args),
  restoreLocalCodebaseSelection: (...args: unknown[]) =>
    restoreLocalCodebaseSelectionMock(...args),
  supportsLocalCodebasePicker: () => true,
  syncLocalCodebaseSnapshot: (...args: unknown[]) =>
    syncLocalCodebaseSnapshotMock(...args),
}));

vi.mock("@/lib/local-control-resources", () => ({
  deleteLocalControlResources: (...args: unknown[]) =>
    deleteLocalControlResourcesMock(...args),
  syncLocalControlResources: (...args: unknown[]) =>
    syncLocalControlResourcesMock(...args),
}));

import { LocalCodebasePicker } from "./LocalCodebasePicker";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LocalCodebasePicker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    clearLocalCodebaseSelectionMock.mockReset();
    collectLocalCodebaseSnapshotMock.mockReset();
    deleteLocalCodebaseResourcesMock.mockReset();
    deleteLocalControlResourcesMock.mockReset();
    rememberLocalCodebaseSelectionMock.mockReset();
    restoreLocalCodebaseSelectionMock.mockReset();
    setClientAppStateMock.mockReset();
    syncLocalCodebaseSnapshotMock.mockReset();
    syncLocalControlResourcesMock.mockReset();
    toastMock.mockReset();
    toastErrorMock.mockReset();
    restoreLocalCodebaseSelectionMock.mockResolvedValue({
      id: "codebase-1",
      name: "Repo One",
      handle: {
        kind: "directory",
        name: "Repo One",
        values: async function* () {},
        getDirectoryHandle: vi.fn(),
        getFileHandle: vi.fn(),
      },
      latest: {
        id: "codebase-1",
        name: "Repo One",
        resourcePrefix: "plan-local-codebase",
        snapshotPrefix: "plan-local-codebase",
        instructionPath: "/tmp/plan/AGENTS.md",
        latestPath: "/tmp/plan/latest.txt",
        indexPath: "/tmp/plan/index.txt",
        treePath: "/tmp/plan/tree.txt",
        indexedFileCount: 1,
        capturedFileCount: 1,
        skippedFileCount: 0,
        totalCapturedBytes: 10,
        updatedAt: "2026-08-14T00:00:00.000Z",
      },
    });
    setClientAppStateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reports unlink only after cleanup finishes", async () => {
    const cleanup = deferred<{ count: number; paths: string[] }>();
    deleteLocalCodebaseResourcesMock.mockReturnValue(cleanup.promise);
    deleteLocalControlResourcesMock.mockReturnValue(cleanup.promise);
    clearLocalCodebaseSelectionMock.mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocalCodebasePicker />
        </QueryClientProvider>,
      );
    });

    const button = container.querySelector(
      'button[aria-label="raw.localCodebase.clearCodebase"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalledWith(
      "raw.localCodebase.codebaseUnlinked",
    );
    expect(clearLocalCodebaseSelectionMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("raw.localCodebase.clearCodebase");
    expect(deleteLocalCodebaseResourcesMock).toHaveBeenCalledTimes(1);
    expect(deleteLocalControlResourcesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      cleanup.resolve({ count: 1, paths: [] });
      await cleanup.promise;
    });

    expect(toastMock).toHaveBeenCalledWith(
      "raw.localCodebase.codebaseUnlinked",
    );
    expect(clearLocalCodebaseSelectionMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(
        'button[aria-label="raw.localCodebase.clearCodebase"]',
      ),
    ).toBeNull();
  });

  it("keeps the selection and exposes a retry when cleanup fails", async () => {
    const cleanupError = new Error("snapshot cleanup failed");
    deleteLocalCodebaseResourcesMock
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValue({ count: 1, paths: [] });
    deleteLocalControlResourcesMock.mockResolvedValue({
      count: 0,
      paths: [],
    });
    clearLocalCodebaseSelectionMock.mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocalCodebasePicker />
        </QueryClientProvider>,
      );
    });

    const button = container.querySelector(
      'button[aria-label="raw.localCodebase.clearCodebase"]',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(clearLocalCodebaseSelectionMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalledWith(
      "raw.localCodebase.codebaseUnlinked",
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "raw.localCodebase.codebaseSyncFailed",
      { description: cleanupError.message },
    );
    expect(container.textContent).toContain(cleanupError.message);
    expect(
      container.querySelector(
        'button[aria-label="raw.localCodebase.clearCodebase"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(deleteLocalCodebaseResourcesMock).toHaveBeenCalledTimes(2);
    expect(deleteLocalControlResourcesMock).toHaveBeenCalledTimes(2);
    expect(clearLocalCodebaseSelectionMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      "raw.localCodebase.codebaseUnlinked",
    );
  });
});
