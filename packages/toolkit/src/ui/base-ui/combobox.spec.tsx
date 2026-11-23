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
  ComboboxClear,
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
import { Field, FieldLabel } from "./field.js";
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
  input?: Pick<
    ComboboxInputProps,
    "className" | "style" | "size" | "variant" | "color" | "radius"
  >;
  popup?: Pick<
    ComboboxPopupProps,
    "variant" | "color" | "highContrast" | "className"
  >;
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
  readOnly,
}: {
  onValueChange?: (value: string[]) => void;
  readOnly?: boolean;
}) {
  return (
    <Combobox
      items={LANGUAGES}
      multiple
      readOnly={readOnly}
      defaultValue={["Go", "Rust"]}
      onValueChange={onValueChange}
    >
      <ComboboxInput aria-label="Languages">
        <ComboboxChips>
          {(value: string[]) =>
            value.map((language) => (
              <ComboboxChip key={language} aria-labelledby={undefined}>
                <strong>{language}</strong>
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
  it("keeps a controlled search popup usable when the host defers dismissal", async () => {
    const onOpenChange = vi.fn();
    const onOpenChangeComplete = vi.fn();
    const picker = (open: boolean) => (
      <Combobox
        items={LANGUAGES}
        open={open}
        onOpenChange={onOpenChange}
        onOpenChangeComplete={onOpenChangeComplete}
      >
        <ComboboxTrigger>Choose language</ComboboxTrigger>
        <ComboboxPopup aria-label="Languages">
          <ComboboxInput aria-label="Language" />
          <Rows />
        </ComboboxPopup>
      </Combobox>
    );
    const { rerender } = render(picker(true));
    const field = input();
    await type("Py");
    expect(options()).toEqual(["Python"]);
    await key("Escape");
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    expect(input()).toBe(field);
    await type("Ru");
    expect(options()).toEqual(["Rust"]);
    expect(onOpenChangeComplete).not.toHaveBeenCalledWith(false);
    await act(async () => rerender(picker(false)));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onOpenChangeComplete).toHaveBeenCalledWith(false);
  });

  it("updates frame classes and styles as the popup opens and closes", async () => {
    render(
      <Single
        input={{
          className: (state) => (state.open ? "expanded" : undefined),
          style: (state) => ({ opacity: state.open ? 1 : 0.9 }),
        }}
      />,
    );
    const field = screen.getByRole("combobox");
    const frame = field.closest<HTMLElement>(".input");
    expect(frame?.style.opacity).toBe("0.9");
    await act(async () => {
      fireEvent.keyDown(field, { key: "ArrowDown" });
    });
    await screen.findByRole("listbox");
    expect(frame?.classList.contains("expanded")).toBe(true);
    expect(frame?.style.opacity).toBe("1");
    await act(async () => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(frame?.classList.contains("expanded")).toBe(false);
    expect(frame?.style.opacity).toBe("0.9");
  });

  it("keeps default action names when an optional label is undefined", () => {
    render(
      <Combobox items={["Rust"]} defaultValue="Rust">
        <ComboboxInput aria-label="Language">
          <ComboboxTrigger aria-label={undefined} />
          <ComboboxClear aria-label={undefined} />
        </ComboboxInput>
      </Combobox>,
    );
    expect(screen.getByRole("button", { name: "Show options" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();
  });

  it("preserves the accessible names of rendered action buttons", () => {
    render(
      <Combobox items={["Rust"]} defaultValue="Rust">
        <ComboboxInput aria-label="Language">
          <ComboboxTrigger render={<button>Choose language</button>} />
          <ComboboxClear render={<button title="Reset language" />} />
        </ComboboxInput>
      </Combobox>,
    );
    expect(
      screen.getByRole("button", { name: "Choose language" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Reset language" }),
    ).toBeDefined();
  });

  it("uses the visible names of custom trigger and clear actions", () => {
    render(
      <Combobox items={["Rust"]} defaultValue="Rust">
        <ComboboxInput aria-label="Language">
          <ComboboxTrigger render={<button />}>
            <span>Choose language</span>
          </ComboboxTrigger>
          <ComboboxClear render={<button />}>
            <span>Reset language</span>
          </ComboboxClear>
        </ComboboxInput>
      </Combobox>,
    );
    expect(
      screen.getByRole("button", { name: "Choose language" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Reset language" }),
    ).toBeDefined();
  });

  it("shares the field label with the portaled list and honors a list-specific name", async () => {
    function Picker({ listLabel }: { listLabel?: string }) {
      return (
        <Field>
          <FieldLabel id="language-label">Language</FieldLabel>
          <Combobox
            aria-labelledby="language-label"
            items={LANGUAGES}
            defaultOpen
          >
            <ComboboxInput />
            <ComboboxPopup>
              <ComboboxList aria-label={listLabel}>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </Combobox>
        </Field>
      );
    }
    const { rerender } = render(<Picker />);
    expect(input().getAttribute("aria-controls")).toBe(
      (await screen.findByRole("listbox", { name: "Language" })).id,
    );
    rerender(<Picker listLabel="Supported languages" />);
    expect(
      screen
        .getByRole("listbox", { name: "Supported languages" })
        .hasAttribute("aria-labelledby"),
    ).toBe(false);
  });
  it("dismisses the popup when focus leaves the document without a destination", async () => {
    const change = vi.fn();
    render(<Single onValueChange={change} />);
    const field = input();
    await act(async () => field.focus());
    await key("ArrowDown");
    expect(field.getAttribute("aria-expanded")).toBe("true");
    fireEvent.blur(window);
    expect(field.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      field.blur();
      window.dispatchEvent(new FocusEvent("blur"));
    });
    expect(field.getAttribute("aria-expanded")).toBe("false");
    expect(change).not.toHaveBeenCalled();
  });

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
        popup={{
          variant: "solid",
          color: "accent",
          highContrast: true,
          className: ({ open }) => (open ? "is-open" : undefined),
        }}
      />,
    );
    await type("r");
    const popup = (await screen.findByRole("listbox")).closest<HTMLElement>(
      ".combobox-popup",
    );
    expect(popup?.dataset.variant).toBe("solid");
    expect(popup?.dataset.color).toBe("accent");
    expect(popup?.dataset.highContrast).toBe("");
    expect(popup?.classList.contains("is-open")).toBe(true);
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

    it("keeps read-only chips named and prevents removal", () => {
      const onValueChange = vi.fn();
      render(<Multiple readOnly onValueChange={onValueChange} />);
      const chip = screen.getByRole("group", { name: "Rust" });
      expect(input("Languages").readOnly).toBe(true);
      expect(chip.hasAttribute("aria-readonly")).toBe(false);
      fireEvent.keyDown(chip, { key: "Delete" });
      fireEvent.click(screen.getByRole("button", { name: "Remove Rust" }));
      expect(onValueChange).not.toHaveBeenCalled();
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
