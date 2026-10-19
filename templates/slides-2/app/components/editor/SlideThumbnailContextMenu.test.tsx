// @vitest-environment happy-dom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlideThumbnailContextMenu } from "./SlideThumbnailContextMenu";

afterEach(() => cleanup());

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "editorSidebar.duplicateSlide": "Duplicate slide",
      "editorSidebar.deleteSlide": "Delete slide",
    })[key] ?? key,
}));

function renderMenu({ canDelete = true }: { canDelete?: boolean } = {}) {
  return render(
    <SlideThumbnailContextMenu
      canDelete={canDelete}
      onSelect={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    >
      <button type="button">Slide 1</button>
    </SlideThumbnailContextMenu>,
  );
}

describe("SlideThumbnailContextMenu", () => {
  it("reveals slide actions from a thumbnail context menu", () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();

    render(
      <SlideThumbnailContextMenu
        onSelect={vi.fn()}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      >
        <button type="button">Slide 1</button>
      </SlideThumbnailContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Slide 1" }));

    expect(
      screen.getByRole("menuitem", { name: "Duplicate slide" }),
    ).toBeTruthy();
    const deleteItem = screen.getByRole("menuitem", { name: "Delete slide" });
    expect(deleteItem).toBeTruthy();

    fireEvent.click(deleteItem);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it("keeps delete disabled when the deck only has one slide", () => {
    renderMenu({ canDelete: false });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Slide 1" }));

    expect(
      screen
        .getByRole("menuitem", { name: "Delete slide" })
        .getAttribute("data-disabled"),
    ).toBe("");
  });
});
