// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useWorkbench: vi.fn(),
}));

vi.mock("../store", () => ({
  useWorkbench: () => mocks.useWorkbench(),
}));

vi.mock("@/components/ui/context-menu", () => {
  const passthrough = ({ children }: { children: ReactNode }) => children;
  const item = ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>;
  return {
    ContextMenu: passthrough,
    ContextMenuContent: passthrough,
    ContextMenuItem: item,
    ContextMenuSeparator: () => null,
    ContextMenuTrigger: passthrough,
  };
});

vi.mock("@/components/ui/alert-dialog", () => {
  const passthrough = ({ children }: { children: ReactNode }) => children;
  return {
    AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
      open ? <div role="dialog">{children}</div> : null,
    AlertDialogAction: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => <button onClick={onClick}>{children}</button>,
    AlertDialogCancel: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
  };
});

vi.mock("./file-icons", () => ({
  FileIcon: () => null,
  FolderIcon: () => null,
}));

import { FileTree } from "./FileTree";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const fileNode = {
  kind: "file" as const,
  name: "index.html",
  path: "index.html",
  parentPath: "",
  entry: { path: "index.html" },
};

function mount(providerKey: string, deleteFile: ReturnType<typeof vi.fn>) {
  mocks.useWorkbench.mockReturnValue({
    api: {
      deleteFile,
      openFile: vi.fn(),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <FileTree
        providerKey={providerKey}
        providerLabel="Files"
        capabilities={{
          write: true,
          create: false,
          rename: false,
          delete: true,
        }}
        nodes={[fileNode]}
        activeUri={null}
        dirtyUris={new Set()}
        focusToken={0}
        registerRef={() => {}}
        onRefresh={() => {}}
      />,
    );
  });
}

function deleteButtons(scope: ParentNode): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll("button")).filter(
    (button) => button.textContent === "Delete",
  );
}

beforeEach(() => {
  mocks.useWorkbench.mockReset();
  container = null;
  root = null;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("FileTree deletion confirmation", () => {
  it("deletes inline Design files immediately for durable undo/history", async () => {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    mount("inline:design-1", deleteFile);

    await act(async () => {
      deleteButtons(container!)[0]?.click();
      await Promise.resolve();
    });

    expect(deleteFile).toHaveBeenCalledWith("inline:design-1", "index.html");
    expect(container?.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps confirmation for provider files without the editor history boundary", async () => {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    mount("localhost:connection-1", deleteFile);

    await act(async () => {
      deleteButtons(container!)[0]?.click();
      await Promise.resolve();
    });

    expect(deleteFile).not.toHaveBeenCalled();
    const dialog = container?.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await act(async () => {
      deleteButtons(dialog!)[0]?.click();
      await Promise.resolve();
    });
    expect(deleteFile).toHaveBeenCalledWith(
      "localhost:connection-1",
      "index.html",
    );
  });
});
