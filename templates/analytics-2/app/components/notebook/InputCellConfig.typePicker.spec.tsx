// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { InputCellControl, type InputCellContents } from "./InputCellControl";

// Report QA-1795067325.015019 (whole report): the original's input settings
// open with a type picker beside the type icon and the type's value kind next
// to it, above Label and Name. Source: pretty/0bfc6f41…js:2790-2815 (type
// titles), :2810-2815 (value kind chip), :2570-2650 (type change).

const base: InputCellContents = {
  id: "cel_input",
  order: "n",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  kind: "input",
  name: "input_1",
  inputType: "TEXT_INPUT",
  defaultValueString: "hello",
  multiline: true,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function pressEnter(element: HTMLElement) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

const typePicker = () =>
  document.querySelector<HTMLButtonElement>(
    'button[role="combobox"][aria-label="Input type"]',
  );

const typeOptions = () => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
];

function mount(contents: InputCellContents) {
  const onChangeContents = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  const mountedRoot = createRoot(container);
  root = mountedRoot;
  act(() =>
    mountedRoot.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <InputCellControl
          contents={contents}
          value=""
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
          onChangeContents={onChangeContents}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  act(() => {
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Configure input"]')
      ?.click();
  });
  return onChangeContents;
}

describe("report QA-1795067325.015019 input type picker", () => {
  it("lists only the input types this notebook can create, with the original titles", async () => {
    mount(base);
    const select = typePicker();
    assert.ok(select, "type picker present");
    expect(select.textContent).toBe("Text");
    await pressEnter(select);
    expect(typeOptions().map((option) => option.textContent)).toEqual([
      "Text",
      "Number",
      "Dropdown",
      "Slider",
      "Date",
      "Checkbox",
      "Multiselect",
    ]);
  });

  it("shows the value kind of the chosen type", () => {
    mount(base);
    expect(
      document.querySelector('[data-testid="input-output-type"]')?.textContent,
    ).toBe("string");
  });

  it("changing the type resets the value and drops settings of the old type", async () => {
    const save = mount(base);
    const select = typePicker();
    assert.ok(select);
    await pressEnter(select);
    const checkbox = typeOptions().find(
      (option) => option.textContent === "Checkbox",
    );
    assert.ok(checkbox);
    await pressEnter(checkbox);
    expect(
      document.querySelector('[data-testid="input-output-type"]')?.textContent,
    ).toBe("boolean");
    // oracle-change: input settings save when the popover closes, not on each field change
    expect(save).not.toHaveBeenCalled();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(save).toHaveBeenCalledOnce();
    const saved = save.mock.calls[0]?.[0] as InputCellContents;
    expect(saved.inputType).toBe("CHECKBOX");
    expect(saved.defaultValueString).toBe("false");
    expect(saved.multiline).toBeUndefined();
  });
});
