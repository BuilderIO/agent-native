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

import { Button } from "./button.js";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubmenuRoot,
  MenuSubmenuPopup,
  MenuSubmenuTrigger,
  MenuTrailing,
  MenuTrigger,
  type MenuPopupProps,
} from "./menu.js";

afterEach(cleanup);

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

async function openMenu(trigger: HTMLElement) {
  await act(async () => press(trigger));
  return screen.findByRole("menu");
}

function BasicMenu(props: {
  onClick?: () => void;
  onOpenChange?: (
    open: boolean,
    details: { reason: string; cancel: () => void },
  ) => void;
}) {
  return (
    <Menu onOpenChange={props.onOpenChange}>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuGroupLabel>Document</MenuGroupLabel>
        <MenuItem onClick={props.onClick}>
          Rename
          <MenuShortcut>⌘R</MenuShortcut>
        </MenuItem>
        <MenuSeparator />
        <MenuItem leading={<svg data-testid="archive-icon" />}>
          Archive
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

describe("Menu on Base UI", () => {
  it("opens from the trigger and renders the menu part classes", async () => {
    render(<BasicMenu />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger.hasAttribute("data-popup-open")).toBe(false);
    const menu = await openMenu(trigger);

    expect(trigger.hasAttribute("data-popup-open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.classList.contains("menu-popup")).toBe(true);
    expect(menu.hasAttribute("data-open")).toBe(true);
    expect(menu.parentElement?.classList.contains("menu-positioner")).toBe(
      true,
    );
    const rename = screen.getByRole("menuitem", { name: /Rename/ });
    expect(rename.classList.contains("menu-item")).toBe(true);
    const archive = screen.getByRole("menuitem", { name: "Archive" });
    expect(archive.hasAttribute("data-inset")).toBe(false);
    expect(screen.getByText("Document").classList).toContain(
      "menu-group-label",
    );
    expect(screen.getByRole("separator").classList).toContain("menu-separator");
  });

  it("runs an item's onClick and closes", async () => {
    const onClick = vi.fn();
    const onOpenChange = vi.fn();
    render(<BasicMenu onClick={onClick} onOpenChange={onOpenChange} />);
    await openMenu(screen.getByRole("button", { name: "Actions" }));
    await act(async () =>
      press(screen.getByRole("menuitem", { name: /Rename/ })),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onOpenChange.mock.lastCall?.[0]).toBe(false);
    expect(onOpenChange.mock.lastCall?.[1].reason).toBe("item-press");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("stays open for an item with closeOnClick={false}", async () => {
    const onClick = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem closeOnClick={false} onClick={onClick}>
            Refresh
          </MenuItem>
        </MenuPopup>
      </Menu>,
    );
    await openMenu(screen.getByRole("button", { name: "Actions" }));
    await act(async () =>
      press(screen.getByRole("menuitem", { name: "Refresh" })),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<BasicMenu />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    const menu = await openMenu(trigger);
    await act(async () => {
      fireEvent.keyDown(menu, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("lets onOpenChange cancel an Escape dismissal", async () => {
    render(
      <BasicMenu
        onOpenChange={(open, details) => {
          if (!open && details.reason === "escape-key") details.cancel();
        }}
      />,
    );
    const menu = await openMenu(
      screen.getByRole("button", { name: "Actions" }),
    );
    await act(async () => {
      fireEvent.keyDown(menu, { key: "Escape" });
    });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("opens from the keyboard", async () => {
    render(<BasicMenu />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
    });
    expect(await screen.findByRole("menu")).toBeTruthy();
  });

  it("renders the trigger through render", async () => {
    render(
      <Menu>
        <MenuTrigger
          render={<Button variant="outline" data-testid="trigger" />}
        >
          Actions
        </MenuTrigger>
        <MenuPopup>
          <MenuItem>Rename</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    const trigger = screen.getByTestId("trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.classList.contains("button")).toBe(true);
    await openMenu(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles a checkbox item without closing the menu", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Menu>
        <MenuTrigger>View</MenuTrigger>
        <MenuPopup>
          <MenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
            Show grid
          </MenuCheckboxItem>
        </MenuPopup>
      </Menu>,
    );
    await openMenu(screen.getByRole("button", { name: "View" }));
    const item = screen.getByRole("menuitemcheckbox", { name: "Show grid" });
    expect(item.classList.contains("menu-checkbox-item")).toBe(true);
    await act(async () => press(item));
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("selects a radio item through the group", async () => {
    const onValueChange = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Sort</MenuTrigger>
        <MenuPopup>
          <MenuRadioGroup value="name" onValueChange={onValueChange}>
            <MenuRadioItem value="name">Name</MenuRadioItem>
            <MenuRadioItem value="date" indicator="check">
              Date
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>,
    );
    await openMenu(screen.getByRole("button", { name: "Sort" }));
    const name = screen.getByRole("menuitemradio", { name: "Name" });
    const date = screen.getByRole("menuitemradio", { name: "Date" });
    expect(name.hasAttribute("data-checked")).toBe(true);
    expect(date.hasAttribute("data-checked")).toBe(false);
    expect(date.dataset.indicator).toBe("check");
    await act(async () => press(date));
    expect(onValueChange.mock.calls[0]?.[0]).toBe("date");
  });

  it("opens a submenu from its trigger", async () => {
    render(
      <Menu>
        <MenuTrigger>File</MenuTrigger>
        <MenuPopup>
          <MenuSubmenuRoot>
            <MenuSubmenuTrigger>Export</MenuSubmenuTrigger>
            <MenuSubmenuPopup>
              <MenuItem>PDF</MenuItem>
            </MenuSubmenuPopup>
          </MenuSubmenuRoot>
        </MenuPopup>
      </Menu>,
    );
    await openMenu(screen.getByRole("button", { name: "File" }));
    const subTrigger = screen.getByRole("menuitem", { name: "Export" });
    expect(subTrigger.classList.contains("menu-submenu-trigger")).toBe(true);
    expect(subTrigger.hasAttribute("data-popup-open")).toBe(false);
    subTrigger.focus();
    await act(async () => {
      fireEvent.keyDown(subTrigger, { key: "ArrowRight" });
    });
    expect(await screen.findByRole("menuitem", { name: "PDF" })).toBeTruthy();
    expect(subTrigger.hasAttribute("data-popup-open")).toBe(true);
  });

  it("keeps a controlled menu open until its owner says otherwise", async () => {
    const onOpenChange = vi.fn();
    render(
      <Menu open onOpenChange={onOpenChange}>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem>Rename</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    const menu = await screen.findByRole("menu");
    await act(async () => {
      fireEvent.keyDown(menu, { key: "Escape" });
    });
    expect(onOpenChange.mock.lastCall?.[0]).toBe(false);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("labels a group with Base UI's group label", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuGroup>
            <MenuGroupLabel>Danger zone</MenuGroupLabel>
            <MenuItem>Delete</MenuItem>
          </MenuGroup>
          <MenuRadioGroup defaultValue="name">
            <MenuGroupLabel>Sort by</MenuGroupLabel>
            <MenuRadioItem value="name">Name</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>,
    );
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(
      screen
        .getByRole("group", { name: "Danger zone" })
        .contains(screen.getByRole("menuitem", { name: "Delete" })),
    ).toBe(true);
    expect(
      screen
        .getByRole("group", { name: "Sort by" })
        .contains(screen.getByRole("menuitemradio", { name: "Name" })),
    ).toBe(true);
  });
});

describe("menu item slots", () => {
  it("renders leading, label and trailing in order, each in its slot", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem
            leading={<svg data-testid="icon" />}
            trailing={<MenuShortcut>⌘D</MenuShortcut>}
          >
            Duplicate
          </MenuItem>
          <MenuItem>Rename</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    const duplicate = await screen.findByRole("menuitem", {
      name: /Duplicate/,
    });
    const [leading, , trailing] = Array.from(duplicate.childNodes);
    expect((leading as HTMLElement).className).toBe("menu-item-leading");
    expect((leading as HTMLElement).querySelector("svg")).toBe(
      screen.getByTestId("icon"),
    );
    expect(duplicate.childNodes.item(1).textContent).toBe("Duplicate");
    expect((trailing as HTMLElement).className).toBe("menu-item-trailing");
    expect(
      (trailing as HTMLElement).querySelector(".menu-shortcut")?.textContent,
    ).toBe("⌘D");

    const rename = screen.getByRole("menuitem", { name: "Rename" });
    expect(rename.querySelector(".menu-item-leading")).toBeNull();
    expect(rename.querySelector(".menu-item-trailing")).toBeNull();
  });

  it("puts the checkbox check and radio dot in the leading slot", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>View</MenuTrigger>
        <MenuPopup>
          <MenuCheckboxItem checked={false}>Grid</MenuCheckboxItem>
          <MenuRadioGroup value="a">
            <MenuRadioItem value="a">A</MenuRadioItem>
            <MenuRadioItem value="b">B</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>,
    );
    for (const name of ["Grid", "A", "B"]) {
      const row = await screen.findByRole(
        name === "Grid" ? "menuitemcheckbox" : "menuitemradio",
        { name },
      );
      expect(row.firstElementChild?.className).toBe("menu-item-leading");
    }
  });

  it("gives the submenu trigger the item anatomy with a chevron trailing", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>File</MenuTrigger>
        <MenuPopup>
          <MenuSubmenuRoot>
            <MenuSubmenuTrigger leading={<svg data-testid="icon" />}>
              Export
            </MenuSubmenuTrigger>
            <MenuSubmenuPopup>
              <MenuItem>PDF</MenuItem>
            </MenuSubmenuPopup>
          </MenuSubmenuRoot>
        </MenuPopup>
      </Menu>,
    );
    const trigger = await screen.findByRole("menuitem", { name: "Export" });
    const [leading, , trailing] = Array.from(trigger.childNodes);
    expect((leading as HTMLElement).className).toBe("menu-item-leading");
    expect(trigger.childNodes.item(1).textContent).toBe("Export");
    expect((trailing as HTMLElement).className).toBe("menu-item-trailing");
    expect((trailing as HTMLElement).querySelector("svg")).not.toBeNull();
  });
});

describe("menu trailing slot", () => {
  it("gives MenuShortcut the shortcut part class", () => {
    render(<MenuShortcut>⌘D</MenuShortcut>);
    expect(screen.getByText("⌘D").classList).toContain("menu-shortcut");
  });

  it("gives MenuTrailing the trailing slot class", () => {
    render(<MenuTrailing>x</MenuTrailing>);
    expect(screen.getByText("x").classList).toContain("menu-item-trailing");
  });
});

describe("menu props", () => {
  it("writes soft and gray on the popup by default", async () => {
    render(<BasicMenu />);
    const menu = await openMenu(
      screen.getByRole("button", { name: "Actions" }),
    );
    expect(menu.dataset.variant).toBe("soft");
    expect(menu.dataset.color).toBe("gray");
    expect(menu.dataset.highContrast).toBeUndefined();
  });

  it("writes variant, color and high contrast as Radix names them", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup variant="solid" color="accent" highContrast>
          <MenuItem>Rename</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    const menu = await screen.findByRole("menu");
    expect(menu.dataset).toMatchObject({
      variant: "solid",
      color: "accent",
      highContrast: "",
    });
  });

  it("marks a destructive item with its color", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem>Rename</MenuItem>
          <MenuItem color="danger">Delete</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    const remove = await screen.findByRole("menuitem", { name: "Delete" });
    expect(remove.dataset.color).toBe("danger");
    expect(
      screen.getByRole("menuitem", { name: "Rename" }).dataset.color,
    ).toBeUndefined();
  });

  it("refuses a variant it doesn't have instead of drawing the default", () => {
    const props = { variant: "ghost" } as unknown as MenuPopupProps;
    expect(() =>
      render(
        <Menu defaultOpen>
          <MenuTrigger>Actions</MenuTrigger>
          <MenuPopup {...props}>
            <MenuItem>Rename</MenuItem>
          </MenuPopup>
        </Menu>,
      ),
    ).toThrow(/variant="ghost" is not one of/);
  });

  it("gives a submenu its menu's variant and color", async () => {
    render(
      <Menu defaultOpen>
        <MenuTrigger>File</MenuTrigger>
        <MenuPopup variant="solid" color="danger">
          <MenuSubmenuRoot>
            <MenuSubmenuTrigger>Export</MenuSubmenuTrigger>
            <MenuSubmenuPopup data-testid="submenu">
              <MenuItem>PDF</MenuItem>
            </MenuSubmenuPopup>
          </MenuSubmenuRoot>
        </MenuPopup>
      </Menu>,
    );
    const subTrigger = await screen.findByRole("menuitem", { name: "Export" });
    subTrigger.focus();
    await act(async () => {
      fireEvent.keyDown(subTrigger, { key: "ArrowRight" });
    });
    await screen.findByRole("menuitem", { name: "PDF" });
    expect(screen.getByTestId("submenu").dataset).toMatchObject({
      variant: "solid",
      color: "danger",
    });
  });
});
