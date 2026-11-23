// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ArchiveProjectDialog } from "./ArchiveProjectDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { TrashProjectDialog } from "./TrashProjectDialog";

function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

it("Move to trash focuses its confirm button and Escape cancels", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onCancel = vi.fn();
  const { container, root } = mount(
    <TrashProjectDialog
      projectTitle="QA project"
      pending={false}
      error={null}
      onCancel={onCancel}
      onConfirm={() => {}}
    />,
  );
  try {
    const confirm = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Move to trash",
    );
    if (!confirm) throw Error("Confirm button missing");
    expect(document.activeElement).toBe(confirm);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("Archive discards on Escape", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onCancel = vi.fn();
  const { container, root } = mount(
    <ArchiveProjectDialog
      pending={false}
      error={null}
      onCancel={onCancel}
      onConfirm={() => {}}
    />,
  );
  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Move to archive");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("a pending confirmation still cancels on Escape without writing", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const { container, root } = mount(
    <DeleteProjectDialog
      pending={true}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  try {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Confirm permanent deletion");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
