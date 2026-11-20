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
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  type AutocompleteInputProps,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  type AutocompletePopupProps,
} from "./autocomplete.js";
import { InputSlot } from "./input.js";

afterEach(cleanup);

const FRUITS = ["Apple", "Apricot", "Banana", "Cherry"];

const GROUPS = [
  { value: "Fruit", items: ["Apple", "Banana"] },
  { value: "Vegetable", items: ["Carrot", "Celery"] },
];

function Sample({
  onValueChange,
  input,
  popup,
}: {
  onValueChange?: (value: string) => void;
  input?: Pick<
    AutocompleteInputProps,
    "size" | "variant" | "color" | "radius" | "disabled"
  >;
  popup?: Pick<AutocompletePopupProps, "variant" | "color" | "highContrast">;
}) {
  return (
    <Autocomplete items={FRUITS} onValueChange={onValueChange}>
      <AutocompleteInput aria-label="Fruit" {...input}>
        <InputSlot side="right">
          <AutocompleteClear />
        </InputSlot>
      </AutocompleteInput>
      <AutocompletePopup {...popup}>
        <AutocompleteEmpty>No fruit found.</AutocompleteEmpty>
        <AutocompleteList>
          {(fruit: string) => (
            <AutocompleteItem key={fruit} value={fruit}>
              {fruit}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}

function input() {
  return screen.getByRole<HTMLInputElement>("combobox", { name: "Fruit" });
}

/** Types as a keyboard does: Base UI opens the list only for typed input. */
async function type(text: string) {
  const element = input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(element, text);
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" }),
    );
  });
}

async function key(name: string) {
  await act(async () => {
    fireEvent.keyDown(input(), { key: name });
  });
}

describe("Autocomplete", () => {
  it("draws the field as the input part with Input's defaults", () => {
    render(<Sample />);
    const frame = input().parentElement;
    expect(input().classList.contains("input-control")).toBe(true);
    expect(frame?.classList.contains("input")).toBe(true);
    expect(frame?.dataset.size).toBe("3");
    expect(frame?.dataset.variant).toBe("surface");
    expect(frame?.dataset.color).toBeUndefined();
  });

  it("writes the input's size, variant, color and radius on the frame", () => {
    render(
      <Sample
        input={{ size: "2", variant: "soft", color: "gray", radius: "full" }}
      />,
    );
    const frame = input().parentElement;
    expect(frame?.dataset.size).toBe("2");
    expect(frame?.dataset.variant).toBe("soft");
    expect(frame?.dataset.color).toBe("gray");
    expect(frame?.dataset.radius).toBe("full");
  });

  it("refuses an input variant it doesn't have", () => {
    const props = { variant: "ghost" } as unknown as AutocompleteInputProps;
    expect(() => render(<Sample input={props} />)).toThrow(
      /variant="ghost" is not one of/,
    );
  });

  it("refuses a popup variant it doesn't have", () => {
    const popup = { variant: "outline" } as unknown as AutocompletePopupProps;
    expect(() => render(<Sample popup={popup} />)).toThrow(
      /variant="outline" is not one of/,
    );
  });

  it("suggests matches as you type, with the popup's defaults and the input's size", async () => {
    render(<Sample input={{ size: "1" }} />);
    await type("ap");
    const listbox = await screen.findByRole("listbox");
    expect(listbox.classList.contains("autocomplete-list")).toBe(true);
    const popup = listbox.closest<HTMLElement>(".autocomplete-popup");
    expect(popup?.dataset.variant).toBe("soft");
    expect(popup?.dataset.color).toBe("gray");
    expect(popup?.dataset.size).toBe("1");
    expect(popup?.parentElement?.className).toContain(
      "autocomplete-positioner",
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Apple", "Apricot"]);
    expect(screen.getByRole("option", { name: "Apple" }).className).toContain(
      "autocomplete-item",
    );
  });

  it("writes the popup's variant, color and high contrast", async () => {
    render(
      <Sample
        popup={{ variant: "solid", color: "danger", highContrast: true }}
      />,
    );
    await type("a");
    const popup = (await screen.findByRole("listbox")).closest<HTMLElement>(
      ".autocomplete-popup",
    );
    expect(popup?.dataset.variant).toBe("solid");
    expect(popup?.dataset.color).toBe("danger");
    expect(popup?.dataset.highContrast).toBe("");
  });

  it("moves the highlight with the arrow keys and fills the input on Enter", async () => {
    const onValueChange = vi.fn();
    render(<Sample onValueChange={onValueChange} />);
    await type("ap");
    await screen.findByRole("listbox");
    await key("ArrowDown");
    expect(
      screen
        .getByRole("option", { name: "Apple" })
        .hasAttribute("data-highlighted"),
    ).toBe(true);
    await key("ArrowDown");
    expect(
      screen
        .getByRole("option", { name: "Apricot" })
        .hasAttribute("data-highlighted"),
    ).toBe(true);
    await key("Enter");
    expect(input().value).toBe("Apricot");
    expect(onValueChange).toHaveBeenLastCalledWith(
      "Apricot",
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  it("keeps free text that matches nothing, and says so", async () => {
    render(<Sample />);
    await type("kiwi");
    expect(input().value).toBe("kiwi");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    const empty = screen.getByText(/No fruit found/);
    expect(empty.className).toContain("autocomplete-empty");
    expect(empty.getAttribute("role")).toBe("status");
  });

  it("clears the text with the clear button", async () => {
    render(<Sample />);
    await type("ban");
    // Base UI hides the field's other controls from assistive technology
    // while the list is open; the clear button is a pointer affordance.
    const clear = screen.getByRole("button", { name: "Clear", hidden: true });
    expect(clear.className).toContain("autocomplete-clear");
    await act(async () => {
      fireEvent.click(clear);
    });
    expect(input().value).toBe("");
  });

  it("labels groups and filters inside them", async () => {
    render(
      <Autocomplete items={GROUPS}>
        <AutocompleteInput aria-label="Fruit" />
        <AutocompletePopup>
          <AutocompleteList>
            {(group: (typeof GROUPS)[number]) => (
              <AutocompleteGroup key={group.value} items={group.items}>
                <AutocompleteGroupLabel>{group.value}</AutocompleteGroupLabel>
                <AutocompleteCollection>
                  {(item: string) => (
                    <AutocompleteItem key={item} value={item}>
                      {item}
                    </AutocompleteItem>
                  )}
                </AutocompleteCollection>
              </AutocompleteGroup>
            )}
          </AutocompleteList>
        </AutocompletePopup>
      </Autocomplete>,
    );
    await type("c");
    await screen.findByRole("listbox");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Carrot", "Celery"]);
    const label = screen.getByText("Vegetable");
    expect(label.className).toContain("autocomplete-group-label");
    expect(label.parentElement?.className).toContain("autocomplete-group");
  });

  it("renders an inline list with the popup's attributes, for a command palette", () => {
    render(
      <Autocomplete items={FRUITS} inline open>
        <AutocompleteInput aria-label="Fruit" size="4" />
        <AutocompleteList>
          {(fruit: string) => (
            <AutocompleteItem key={fruit} value={fruit}>
              {fruit}
            </AutocompleteItem>
          )}
        </AutocompleteList>
      </Autocomplete>,
    );
    const list = screen.getByRole("listbox");
    expect(list.dataset.variant).toBe("soft");
    expect(list.dataset.color).toBe("gray");
    expect(list.dataset.size).toBe("4");
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });
});
