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

import { DESIGN_WRITE_FAILED_EVENT } from "@/lib/design-write-failure";

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

function mount(
  providerKey: string,
  deleteFile: ReturnType<typeof vi.fn>,
  options: {
    renameFile?: ReturnType<typeof vi.fn>;
    onRequestLocalWriteConsent?: (
      connectionId: string,
      retry: () => void,
    ) => void;
  } = {},
) {
  mocks.useWorkbench.mockReturnValue({
    api: {
      deleteFile,
      openFile: vi.fn(),
      renameFile: options.renameFile ?? vi.fn(),
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
          rename: options.renameFile !== undefined,
          delete: true,
        }}
        nodes={[fileNode]}
        activeUri={null}
        dirtyUris={new Set()}
        focusToken={0}
        registerRef={() => {}}
        onRefresh={() => {}}
        onRequestLocalWriteConsent={options.onRequestLocalWriteConsent}
      />,
    );
  });
}

// Rename is started from the context menu, then committed with Enter after
// the draft is changed through the input's native value setter, so React's
// onChange fires exactly as it does for typing.
async function commitRenameTo(name: string) {
  const host = container;
  if (!host) throw new Error("FileTree is not mounted");
  const renameItem = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Rename…",
  );
  if (!renameItem) throw new Error("Rename item is missing");
  await act(async () => renameItem.click());
  const input = host.querySelector("input");
  if (!input) throw new Error("Rename input did not open");
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setValue) throw new Error("The input value setter is missing");
  await act(async () => {
    setValue.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("reports a failed rename as a design write failure", async () => {
    const renameFile = vi.fn().mockRejectedValue(new Error("disk full"));
    mount("inline:design-1", vi.fn(), { renameFile });
    const reported = vi.fn();
    window.addEventListener(DESIGN_WRITE_FAILED_EVENT, reported);

    try {
      await commitRenameTo("renamed.html");

      expect(renameFile).toHaveBeenCalledWith(
        "inline:design-1",
        "index.html",
        "renamed.html",
      );
      expect(reported).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(DESIGN_WRITE_FAILED_EVENT, reported);
    }
  });

  it("hands a localhost consent error to the consent flow instead of reporting it", async () => {
    const consentError = Object.assign(new Error("consent required"), {
      name: "LocalWriteConsentRequiredError",
    });
    const renameFile = vi.fn().mockRejectedValue(consentError);
    const onRequestLocalWriteConsent = vi.fn();
    mount("localhost:connection-1", vi.fn(), {
      renameFile,
      onRequestLocalWriteConsent,
    });
    const reported = vi.fn();
    window.addEventListener(DESIGN_WRITE_FAILED_EVENT, reported);

    try {
      await commitRenameTo("renamed.html");

      expect(renameFile).toHaveBeenCalledOnce();
      expect(onRequestLocalWriteConsent).toHaveBeenCalledWith(
        "connection-1",
        expect.any(Function),
      );
      expect(reported).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(DESIGN_WRITE_FAILED_EVENT, reported);
    }
  });
});
