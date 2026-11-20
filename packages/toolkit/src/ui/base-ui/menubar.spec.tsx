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
  Menubar,
  MenubarPopup,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "./menubar.js";

afterEach(cleanup);

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

function Bar({ onClick }: { onClick?: () => void }) {
  return (
    <Menubar aria-label="Editor" data-testid="bar">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarPopup>
          <MenubarItem onClick={onClick}>New</MenubarItem>
        </MenubarPopup>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarPopup>
          <MenubarItem>Zoom</MenubarItem>
        </MenubarPopup>
      </MenubarMenu>
    </Menubar>
  );
}

describe("Menubar on Base UI", () => {
  it("renders the bar and trigger part classes", () => {
    render(<Bar />);
    expect(screen.getByTestId("bar").classList.contains("menubar")).toBe(true);
    expect(
      screen
        .getByRole("menuitem", { name: "File" })
        .classList.contains("menubar-trigger"),
    ).toBe(true);
  });

  it("opens a trigger's menu with the menu part and runs an item's onClick", async () => {
    const onClick = vi.fn();
    render(<Bar onClick={onClick} />);
    const trigger = screen.getByRole("menuitem", { name: "File" });
    await act(async () => press(trigger));
    const menu = await screen.findByRole("menu");
    expect(menu.classList.contains("menu-popup")).toBe(true);
    expect(trigger.hasAttribute("data-popup-open")).toBe(true);
    await act(async () => press(screen.getByRole("menuitem", { name: "New" })));
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("draws its menus as soft gray by default, and takes item colors", async () => {
    render(
      <Menubar aria-label="Editor">
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarPopup>
            <MenubarItem color="danger">Delete</MenubarItem>
          </MenubarPopup>
        </MenubarMenu>
      </Menubar>,
    );
    await act(async () =>
      press(screen.getByRole("menuitem", { name: "Edit" })),
    );
    const menu = await screen.findByRole("menu");
    expect(menu.dataset).toMatchObject({
      variant: "soft",
      color: "gray",
    });
    expect(screen.getByRole("menuitem", { name: "Delete" }).dataset.color).toBe(
      "danger",
    );
  });
});
