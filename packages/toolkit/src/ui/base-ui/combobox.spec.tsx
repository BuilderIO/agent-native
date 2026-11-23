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
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxCollection,
  ComboboxInput,
  type ComboboxInputProps,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  type ComboboxPopupProps,
  ComboboxTrigger,
} from "./combobox.js";
import { InputSlot } from "./input.js";

afterEach(cleanup);

const LANGUAGES = ["Go", "Python", "Rust", "TypeScript"];

function Rows() {
  return (
    <ComboboxList>
      {(language: string) => (
        <ComboboxItem key={language} value={language}>
          {language}
        </ComboboxItem>
      )}
    </ComboboxList>
  );
}

function Single({
  onValueChange,
  defaultValue = null,
  input,
  popup,
}: {
  onValueChange?: (value: string | null) => void;
  defaultValue?: string | null;
  input?: Pick<ComboboxInputProps, "size" | "variant" | "color" | "radius">;
  popup?: Pick<ComboboxPopupProps, "variant" | "color" | "highContrast">;
}) {
  return (
    <Combobox
      items={LANGUAGES}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
    >
      <ComboboxInput aria-label="Language" {...input}>
        <InputSlot side="right">
          <ComboboxTrigger />
        </InputSlot>
      </ComboboxInput>
      <ComboboxPopup {...popup}>
        <ComboboxEmpty>No language found.</ComboboxEmpty>
        <Rows />
      </ComboboxPopup>
    </Combobox>
  );
}

function Multiple({
  onValueChange,
}: {
  onValueChange?: (value: string[]) => void;
}) {
  return (
    <Combobox
      items={LANGUAGES}
      multiple
      defaultValue={["Go", "Rust"]}
      onValueChange={onValueChange}
    >
      <ComboboxInput aria-label="Languages">
        <ComboboxChips>
          {(value: string[]) =>
            value.map((language) => (
              <ComboboxChip key={language} removeLabel={`Remove ${language}`}>
                {language}
              </ComboboxChip>
            ))
          }
        </ComboboxChips>
      </ComboboxInput>
      <ComboboxPopup>
        <Rows />
      </ComboboxPopup>
    </Combobox>
  );
}

function input(name = "Language") {
  return screen.getByRole<HTMLInputElement>("combobox", { name });
}

async function type(text: string, name?: string) {
  const element = input(name);
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

async function key(name: string, label?: string) {
  await act(async () => {
    fireEvent.keyDown(input(label), { key: name });
  });
}

function options() {
  return screen.getAllByRole("option").map((option) => option.textContent);
}

describe("Combobox", () => {
  it("draws the field as the input part with Input's defaults", () => {
    render(<Single />);
    const frame = input().parentElement;
    expect(input().classList.contains("input-control")).toBe(true);
    expect(frame?.classList.contains("input")).toBe(true);
    expect(frame?.dataset.size).toBe("md");
    expect(frame?.dataset.variant).toBe("surface");
    expect(
      frame?.querySelector(".input-slot .combobox-trigger svg"),
    ).not.toBeNull();
  });

  it("writes the input's size, variant, color and radius on the frame", () => {
    render(
      <Single
        input={{ size: "md", variant: "soft", color: "info", radius: "large" }}
      />,
    );
    const frame = input().parentElement;
    expect(frame?.dataset.size).toBe("md");
    expect(frame?.dataset.variant).toBe("soft");
    expect(frame?.dataset.color).toBe("info");
    expect(frame?.dataset.radius).toBe("large");
  });

  it("refuses an input size or popup variant it doesn't have", () => {
    const size = { size: "5" } as unknown as ComboboxInputProps;
    expect(() => render(<Single input={size} />)).toThrow(
      /size="5" is not one of/,
    );
    const popup = { variant: "surface" } as unknown as ComboboxPopupProps;
    expect(() => render(<Single popup={popup} />)).toThrow(
      /variant="surface" is not one of/,
    );
  });

  it("opens from the trigger with the popup's defaults and the input's size", async () => {
    render(<Single input={{ size: "sm" }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show options" }));
    });
    const listbox = await screen.findByRole("listbox");
    expect(listbox.classList.contains("combobox-list")).toBe(true);
    const popup = listbox.closest<HTMLElement>(".combobox-popup");
    expect(popup?.dataset.size).toBe("sm");
    expect(popup?.dataset.variant).toBe("soft");
    expect(popup?.dataset.color).toBe("gray");
    expect(popup?.parentElement?.className).toContain("combobox-positioner");
    expect(options()).toEqual(LANGUAGES);
  });

  it("writes the popup's variant, color and high contrast", async () => {
    render(
      <Single
        popup={{ variant: "solid", color: "accent", highContrast: true }}
      />,
    );
    await type("r");
    const popup = (await screen.findByRole("listbox")).closest<HTMLElement>(
      ".combobox-popup",
    );
    expect(popup?.dataset.variant).toBe("solid");
    expect(popup?.dataset.color).toBe("accent");
    expect(popup?.dataset.highContrast).toBe("");
  });

  it("filters as you type and selects with the arrow keys and Enter", async () => {
    const onValueChange = vi.fn();
    render(<Single onValueChange={onValueChange} />);
    await type("s");
    await screen.findByRole("listbox");
    expect(options()).toEqual(["Rust", "TypeScript"]);
    await key("ArrowDown");
    await key("ArrowDown");
    expect(
      screen
        .getByRole("option", { name: "TypeScript" })
        .hasAttribute("data-highlighted"),
    ).toBe(true);
    await key("Enter");
    expect(onValueChange).toHaveBeenCalledWith(
      "TypeScript",
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(input().value).toBe("TypeScript");
  });

  it("marks the selected row with the check in its leading column", async () => {
    render(<Single defaultValue="Python" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show options" }));
    });
    await screen.findByRole("listbox");
    const python = screen.getByRole("option", { name: "Python" });
    expect(python.className).toContain("combobox-item");
    expect(python.getAttribute("aria-selected")).toBe("true");
    expect(python.hasAttribute("data-selected")).toBe(true);
    expect(python.querySelector(".combobox-item-indicator svg")).not.toBeNull();
    expect(
      screen
        .getByRole("option", { name: "Go" })
        .querySelector(".combobox-item-indicator"),
    ).toBeNull();
  });

  it("shows the empty state when nothing matches", async () => {
    render(<Single />);
    await type("cobol");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    const empty = screen.getByText(/No language found/);
    expect(empty.className).toContain("combobox-empty");
    expect(empty.getAttribute("role")).toBe("status");
  });

  it("labels groups", async () => {
    const groups = [
      { value: "Compiled", items: ["Go", "Rust"] },
      { value: "Interpreted", items: ["Python"] },
    ];
    render(
      <Combobox items={groups}>
        <ComboboxInput aria-label="Language" />
        <ComboboxPopup>
          <ComboboxList>
            {(group: (typeof groups)[number]) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
                <ComboboxCollection>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>,
    );
    await type("o");
    await screen.findByRole("listbox");
    expect(options()).toEqual(["Go", "Python"]);
    const label = screen.getByText("Interpreted");
    expect(label.className).toContain("combobox-group-label");
    expect(label.parentElement?.className).toContain("combobox-group");
  });

  describe("multiple", () => {
    it("shows each selected value as a chip before the text", () => {
      render(<Multiple />);
      const chips = input("Languages").parentElement;
      expect(chips?.classList.contains("combobox-chips")).toBe(true);
      expect(chips?.parentElement?.classList.contains("input")).toBe(true);
      const labels = [...(chips?.querySelectorAll(".combobox-chip") ?? [])];
      expect(labels.map((chip) => chip.textContent)).toEqual(["Go", "Rust"]);
      expect(chips?.lastElementChild).toBe(input("Languages"));
    });

    it("adds a value from the list and keeps the list open", async () => {
      const onValueChange = vi.fn();
      render(<Multiple onValueChange={onValueChange} />);
      await type("py", "Languages");
      await screen.findByRole("listbox");
      await key("ArrowDown", "Languages");
      await key("Enter", "Languages");
      expect(onValueChange).toHaveBeenLastCalledWith(
        ["Go", "Rust", "Python"],
        expect.anything(),
      );
      expect(document.querySelectorAll(".combobox-chip")).toHaveLength(3);
    });

    it("removes a value with its chip's button", async () => {
      const onValueChange = vi.fn();
      render(<Multiple onValueChange={onValueChange} />);
      const remove = screen.getByRole("button", { name: "Remove Go" });
      expect(remove.className).toContain("combobox-chip-remove");
      await act(async () => {
        fireEvent.click(remove);
      });
      expect(onValueChange).toHaveBeenLastCalledWith(
        ["Rust"],
        expect.anything(),
      );
    });

    it("removes the last value with Backspace in an empty input", async () => {
      const onValueChange = vi.fn();
      render(<Multiple onValueChange={onValueChange} />);
      await key("Backspace", "Languages");
      expect(onValueChange).toHaveBeenLastCalledWith(["Go"], expect.anything());
    });
  });
});
