// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectGroupLabel,
  SelectSeparator,
  SelectTrigger,
  type SelectPopupProps,
  type SelectProps,
  type SelectTriggerProps,
  SelectValue,
} from "./select.js";

afterEach(cleanup);

const ITEMS = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
];

function press(element: Element) {
  fireEvent.pointerDown(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.pointerUp(element, { pointerType: "mouse", button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

function Sample({
  onValueChange,
  size,
  trigger,
  popup,
}: {
  onValueChange?: (value: string | null) => void;
  size?: SelectProps<string>["size"];
  trigger?: Pick<SelectTriggerProps, "variant" | "color" | "radius">;
  popup?: Pick<SelectPopupProps, "variant" | "color" | "highContrast">;
}) {
  return (
    <Select
      items={ITEMS}
      defaultValue="banana"
      onValueChange={onValueChange}
      {...(size === undefined ? {} : { size })}
    >
      <SelectTrigger aria-label="Fruit" {...trigger}>
        <SelectValue placeholder="Pick" />
      </SelectTrigger>
      <SelectPopup {...popup}>
        <SelectGroup>
          <SelectGroupLabel>Fruits</SelectGroupLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="other" disabled>
          Other
        </SelectItem>
      </SelectPopup>
    </Select>
  );
}

describe("Select", () => {
  it("shows the selected item's label and the select part's classes", () => {
    render(<Sample />);
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger.classList.contains("select-trigger")).toBe(true);
    expect(trigger.dataset.size).toBe("md");
    expect(trigger.dataset.variant).toBe("surface");
    expect(trigger.dataset.color).toBeUndefined();
    expect(trigger.querySelector(".select-value")?.textContent).toBe("Banana");
    expect(trigger.querySelector(".select-icon svg")).not.toBeNull();
  });

  it("shares a visible label with the open list and lets the list supply its own name", async () => {
    const field = (label: string, popupLabel?: string) => (
      <>
        <span id="fruit-label">{label}</span>
        <Select
          aria-labelledby="fruit-label"
          items={ITEMS}
          defaultValue="apple"
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup aria-label={popupLabel}>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectPopup>
        </Select>
      </>
    );
    const view = render(field("Fruit"));
    await act(async () =>
      press(screen.getByRole("combobox", { name: "Fruit" })),
    );
    const list = await screen.findByRole("listbox", { name: "Fruit" });
    view.rerender(field("Ingredient"));
    expect(screen.getByRole("listbox", { name: "Ingredient" })).toBe(list);
    view.rerender(field("Ingredient", "Available ingredients"));
    expect(screen.getByRole("listbox", { name: "Available ingredients" })).toBe(
      list,
    );
    expect(screen.getByRole("combobox", { name: "Ingredient" })).toBeTruthy();
  });

  it("keeps option focus when a controlled host keeps the list open after selection", async () => {
    render(
      <Select open items={ITEMS} defaultValue="banana">
        <SelectTrigger aria-label="Fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="apple">Apple</SelectItem>
        </SelectPopup>
      </Select>,
    );
    const apple = await screen.findByRole("option", { name: "Apple" });
    await act(async () => {
      apple.focus();
      press(apple);
    });
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(screen.getByRole("combobox").textContent).toBe("Apple");
    expect(document.activeElement).toBe(apple);
  });

  it("writes the trigger's variant, color and radius", () => {
    render(
      <Sample trigger={{ variant: "ghost", color: "gray", radius: "full" }} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger.dataset.variant).toBe("ghost");
    expect(trigger.dataset.color).toBe("gray");
    expect(trigger.dataset.radius).toBe("full");
  });

  it("gives the root's size to the trigger and the popup, and the popup its own props", async () => {
    render(
      <Sample
        size="sm"
        popup={{ variant: "soft", color: "danger", highContrast: true }}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger.dataset.size).toBe("sm");
    await act(async () => press(trigger));
    const popup = (await screen.findByRole("listbox")).closest<HTMLElement>(
      ".select-popup",
    );
    expect(popup?.dataset.size).toBe("sm");
    expect(popup?.dataset.variant).toBe("soft");
    expect(popup?.dataset.color).toBe("danger");
    expect(popup?.dataset.highContrast).toBe("");
  });

  it("refuses a trigger variant it doesn't have instead of drawing the default", () => {
    const trigger = { variant: "solid" } as unknown as SelectTriggerProps;
    expect(() => render(<Sample trigger={trigger} />)).toThrow(
      /variant="solid" is not one of/,
    );
  });

  it("lists items under the popup, marks the selected one and picks another", async () => {
    const onValueChange = vi.fn();
    render(<Sample onValueChange={onValueChange} />);
    await act(async () =>
      press(screen.getByRole("combobox", { name: "Fruit" })),
    );

    const listbox = await screen.findByRole("listbox");
    const popup = listbox.closest<HTMLElement>(".select-popup");
    expect(popup?.dataset.size).toBe("md");
    expect(popup?.dataset.variant).toBe("soft");
    expect(popup?.dataset.color).toBe("gray");
    expect(
      listbox.closest(".select-popup")?.parentElement?.className,
    ).toContain("select-positioner");
    const banana = screen.getByRole("option", { name: "Banana" });
    expect(banana.getAttribute("aria-selected")).toBe("true");
    expect(banana.querySelector(".select-item-indicator")).not.toBeNull();
    expect(
      screen
        .getByRole("option", { name: "Other" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    expect(screen.getByText("Fruits").className).toContain(
      "select-group-label",
    );

    await act(async () => press(screen.getByRole("option", { name: "Apple" })));
    expect(onValueChange).toHaveBeenCalledWith(
      "apple",
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });
});
