// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuGroupLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSubmenuRoot,
  ContextMenuSubmenuPopup,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
} from "./context-menu.js";

afterEach(cleanup);

async function rightClick(area: HTMLElement) {
  await act(async () => {
    fireEvent.contextMenu(area, { clientX: 40, clientY: 60 });
  });
}

function Area(props: {
  onClick?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenuTrigger>
        <p>Canvas</p>
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <ContextMenuGroupLabel>Layer</ContextMenuGroupLabel>
        <ContextMenuItem onClick={props.onClick}>
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem leading={<svg data-testid="rename-icon" />}>
          Rename
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}

describe("ContextMenu on Base UI", () => {
  it("opens on a right click and renders the menu part", async () => {
    render(<Area />);
    expect(
      screen
        .getByText("Canvas")
        .parentElement?.classList.contains("context-menu-trigger"),
    ).toBe(true);
    await rightClick(screen.getByText("Canvas").parentElement as HTMLElement);

    const menu = await screen.findByRole("menu");
    expect(menu.classList.contains("menu-popup")).toBe(true);
    expect(menu.parentElement?.classList.contains("menu-positioner")).toBe(
      true,
    );
    expect(
      screen.getByRole("menuitem", { name: /Duplicate/ }).classList,
    ).toContain("menu-item");
    expect(screen.getByText("⌘D").classList).toContain("menu-shortcut");
    const rename = screen.getByRole("menuitem", { name: "Rename" });
    expect(rename.firstElementChild?.className).toBe("menu-item-leading");
    expect(
      rename.firstElementChild?.contains(screen.getByTestId("rename-icon")),
    ).toBe(true);
  });

  it("takes the menu's props on its content and items", async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <p>Canvas</p>
        </ContextMenuTrigger>
        <ContextMenuPopup variant="solid">
          <ContextMenuItem>Duplicate</ContextMenuItem>
          <ContextMenuItem color="danger">Delete</ContextMenuItem>
        </ContextMenuPopup>
      </ContextMenu>,
    );
    await rightClick(screen.getByText("Canvas").parentElement as HTMLElement);
    const menu = await screen.findByRole("menu");
    expect(menu.dataset).toMatchObject({
      variant: "solid",
      color: "gray",
    });
    expect(screen.getByRole("menuitem", { name: "Delete" }).dataset.color).toBe(
      "danger",
    );
  });

  it("runs an item's onClick and closes", async () => {
    const onClick = vi.fn();
    const onOpenChange = vi.fn();
    render(<Area onClick={onClick} onOpenChange={onOpenChange} />);
    await rightClick(screen.getByText("Canvas").parentElement as HTMLElement);
    const item = await screen.findByRole("menuitem", { name: /Duplicate/ });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onOpenChange.mock.lastCall?.[0]).toBe(false);
  });

  it("opens a submenu from its trigger", async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <p>Canvas</p>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuSubmenuRoot>
            <ContextMenuSubmenuTrigger>Export</ContextMenuSubmenuTrigger>
            <ContextMenuSubmenuPopup>
              <ContextMenuItem>PDF</ContextMenuItem>
            </ContextMenuSubmenuPopup>
          </ContextMenuSubmenuRoot>
        </ContextMenuPopup>
      </ContextMenu>,
    );
    await rightClick(screen.getByText("Canvas").parentElement as HTMLElement);
    const subTrigger = await screen.findByRole("menuitem", { name: "Export" });
    subTrigger.focus();
    await act(async () => {
      fireEvent.keyDown(subTrigger, { key: "ArrowRight" });
    });
    expect(await screen.findByRole("menuitem", { name: "PDF" })).toBeTruthy();
  });
});
