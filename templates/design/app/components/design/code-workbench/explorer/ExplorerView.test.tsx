// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceFileEntry, WorkspaceProvider } from "../workspace/types";
import { ExplorerView } from "./ExplorerView";

const mocks = vi.hoisted(() => ({
  fileTree: vi.fn(),
  t: (key: string) => key,
  useActionQuery: vi.fn(),
  useWorkbench: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => mocks.useActionQuery(...args),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => mocks.t,
}));

vi.mock("../store", () => ({
  useWorkbench: () => mocks.useWorkbench(),
}));

vi.mock("./FileTree", () => ({
  FileTree: (props: unknown) => {
    mocks.fileTree(props);
    return null;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function localhostProvider(
  listFiles: () => Promise<WorkspaceFileEntry[]>,
): WorkspaceProvider {
  return {
    key: "localhost:connection-1",
    kind: "localhost",
    label: "local-app",
    rootPath: "/tmp/local-app",
    capabilities: { write: true, create: false, rename: false, delete: false },
    listFiles,
    readFile: async () => ({ content: "" }),
    writeFile: async () => ({}),
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let unsubscribe: ReturnType<typeof vi.fn>;
let refetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  unsubscribe = vi.fn();
  refetch = vi.fn();
  mocks.fileTree.mockReset();
  mocks.useActionQuery.mockReturnValue({
    data: { files: [] },
    error: null,
    isLoading: false,
    refetch,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

function setWorkbench(provider: WorkspaceProvider) {
  const providers = [provider];
  mocks.useWorkbench.mockReturnValue({
    state: { activeUri: null, buffers: {} },
    providers,
    api: {
      onFilesChanged: vi.fn(() => unsubscribe),
    },
  });
}

async function mountExplorer() {
  await act(async () => {
    root!.render(<ExplorerView designId="design-1" explorerFocusToken={0} />);
    await Promise.resolve();
  });
}

describe("ExplorerView local file loading", () => {
  it("enumerates each local workspace once on a successful mount", async () => {
    const listFiles = vi.fn(async () => [{ path: "src/App.tsx", size: 42 }]);
    setWorkbench(localhostProvider(listFiles));

    await mountExplorer();
    await act(async () => {
      await Promise.resolve();
    });

    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps an in-flight listing when provider objects refresh with the same key", async () => {
    const pending = deferred<WorkspaceFileEntry[]>();
    const listFiles = vi.fn(() => pending.promise);
    setWorkbench(localhostProvider(listFiles));

    await mountExplorer();
    expect(listFiles).toHaveBeenCalledTimes(1);

    setWorkbench(localhostProvider(listFiles));
    await act(async () => {
      root!.render(<ExplorerView designId="design-1" explorerFocusToken={0} />);
      await Promise.resolve();
    });
    expect(listFiles).toHaveBeenCalledTimes(1);

    pending.resolve([{ path: "src/App.tsx", size: 42 }]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fileTree).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerKey: "localhost:connection-1",
        loading: false,
        nodes: [
          expect.objectContaining({
            kind: "folder",
            name: "src",
            path: "src",
          }),
        ],
      }),
    );
  });

  it("ignores a local file result that settles after unmount", async () => {
    const pending = deferred<WorkspaceFileEntry[]>();
    const listFiles = vi.fn(() => pending.promise);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    setWorkbench(localhostProvider(listFiles));

    await mountExplorer();
    expect(listFiles).toHaveBeenCalledTimes(1);
    mocks.fileTree.mockClear();

    await act(async () => root!.unmount());
    root = null;
    pending.resolve([{ path: "src/Late.tsx" }]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fileTree).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
