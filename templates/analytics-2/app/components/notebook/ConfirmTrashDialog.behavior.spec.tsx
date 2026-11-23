// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ConfirmTrashDialog } from "./ConfirmTrashDialog";

it("focuses the confirm button on open and Escape closes it", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ConfirmTrashDialog
        isOpen
        projectTitle="QA project"
        onClose={onClose}
        onConfirm={async () => {}}
      />,
    ),
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
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
