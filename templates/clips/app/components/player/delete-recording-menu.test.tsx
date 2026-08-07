// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutationOptions: null as any,
  mutate: vi.fn(),
  closeAutoFocus: null as
    | ((event: { preventDefault: () => void }) => void)
    | null,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (_name: string, options: unknown) => {
    mocks.mutationOptions = options;
    return { isPending: false, mutate: mocks.mutate };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@tabler/icons-react", () => ({
  IconDots: () => <span />,
  IconDownload: () => <span />,
  IconTrash: () => <span />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogContent: ({
    children,
    onCloseAutoFocus,
  }: {
    children: React.ReactNode;
    onCloseAutoFocus?: (event: { preventDefault: () => void }) => void;
  }) => {
    mocks.closeAutoFocus = onCloseAutoFocus ?? null;
    return <div>{children}</div>;
  },
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button type="button" onClick={(event) => onSelect?.(event)}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { RecordingOptionsMenu } from "./delete-recording-menu";

describe("RecordingOptionsMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.mutationOptions = null;
    mocks.closeAutoFocus = null;
    mocks.mutate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("waits for the dialog close lifecycle before navigating away", async () => {
    const onDeleted = vi.fn();
    act(() => {
      root.render(
        <RecordingOptionsMenu
          recordingId="recording-1"
          onDeleted={onDeleted}
        />,
      );
    });

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "deleteRecordingMenu.delete",
    );
    act(() => deleteButton?.click());
    expect(mocks.mutationOptions).not.toBeNull();

    act(() => mocks.mutationOptions.onSuccess());
    expect(onDeleted).not.toHaveBeenCalled();

    const closeEvent = { preventDefault: vi.fn() };
    act(() => mocks.closeAutoFocus?.(closeEvent));
    expect(closeEvent.preventDefault).toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onDeleted).toHaveBeenCalledOnce();
  });
});
