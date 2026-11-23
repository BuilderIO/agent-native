// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { DeleteCollectionDialog } from "@/components/collections/DeleteCollectionDialog";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useDialogEscape } from "./useDialogEscape";

function Harness({ onClose }: { onClose: () => void }) {
  useDialogEscape(onClose);
  return <div>dialog</div>;
}

function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

it("Escape dismisses and other keys do not", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onClose = vi.fn();
  const { container, root } = mount(<Harness onClose={onClose} />);
  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("the new project dialog cancels on Escape", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onCancel = vi.fn();
  const { container, root } = mount(
    <NewProjectDialog
      pending={false}
      error={null}
      onCancel={onCancel}
      onCreate={() => {}}
    />,
  );
  try {
    pressEscape();
    expect(onCancel).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("delete collection focuses its confirm button and cancels on Escape", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const { container, root } = mount(
    <DeleteCollectionDialog
      collectionId="col_1"
      collectionName="QA revenue"
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  );
  try {
    const confirm = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Delete collection",
    );
    if (!confirm) throw Error("Confirm button missing");
    expect(document.activeElement).toBe(confirm);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("AlertDialog confirmation focuses its confirm button and closes on Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const { container, root } = mount(
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete item?</AlertDialogTitle>
          <AlertDialogDescription>Cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
  try {
    const confirm = await vi.waitFor(() => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Delete",
      );
      if (!button) throw Error("Confirm button missing");
      expect(document.activeElement).toBe(button);
      return button;
    });
    expect(document.activeElement).toBe(confirm);
    pressEscape();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
