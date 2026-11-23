// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellContentsSchema } from "@/lib/model/contracts";

import { InputCellControl, type InputCellContents } from "./InputCellControl";

// Report 1795067325: adding a text input put the field straight into the
// notebook. The original gives every input a "Configure cell" popover with a
// Label, a Name (a code identifier) and, for a text input, a Multiline toggle.
// Source: pretty/0bfc6f41…js:2572-2650 (label/name editor), :2820-2866 (fields,
// error copy), :1117-1123 (Enter closes); 31d6874c…js:229-250 (gear tooltip).

const NAME_ERROR =
  "Name must be a valid python identifier. It can only contain alphanumeric characters and underscores.";

const textInput = (
  over: Partial<InputCellContents> = {},
): InputCellContents => ({
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
  defaultValueString: "",
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(contents: InputCellContents, onChangeContents = vi.fn()) {
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
  return onChangeContents;
}

function openConfig() {
  const gear = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Configure cell"]',
  );
  assert.ok(gear, "the Configure cell control is present");
  act(() => {
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function field(label: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  assert.ok(found, `the ${label} field is present`);
  return found;
}

function type(el: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("report 1795067325 input configuration", () => {
  it("offers Label and Name for a text input from the Configure cell control", () => {
    mount(textInput({ name: "region", label: "Region" }));
    expect(document.querySelector('input[aria-label="Label"]')).toBeNull();
    openConfig();
    expect(field("Label").value).toBe("Region");
    expect(field("Name").value).toBe("region");
    // The helper copy lives in the dotted-underlined labels' tooltips, as in
    // the source, not in a paragraph under each field.
    expect(document.querySelector("p")).toBeNull();
    expect(
      document.querySelector('label[for$="config-label"]')?.className,
    ).toContain("underline");
    expect(
      document.querySelector('label[for$="config-name"]')?.className,
    ).toContain("underline");
  });

  it("does not offer configuration when the cell cannot be edited", () => {
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
            contents={textInput()}
            value=""
            disabled={false}
            onChange={() => {}}
            onCommit={() => {}}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(
      document.querySelector('button[aria-label="Configure cell"]'),
    ).toBeNull();
  });

  it("saves the label and the name together when Enter is pressed in Label", () => {
    const save = mount(textInput());
    openConfig();
    type(field("Label"), "Customer Region");
    // The name follows the label's slug while it still matched it.
    expect(field("Name").value).toBe("input_1");
    press(field("Label"), "Enter");
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      label: "Customer Region",
      name: "input_1",
    });
    expect(document.querySelector('input[aria-label="Label"]')).toBeNull();
  });

  it("keeps the name in step with the label while they still match", () => {
    const save = mount(textInput({ label: "Region", name: "region" }));
    openConfig();
    type(field("Label"), "Sales Region");
    expect(field("Name").value).toBe("sales_region");
    press(field("Label"), "Enter");
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      label: "Sales Region",
      name: "sales_region",
    });
  });

  it("leaves a name the person set apart from the label alone", () => {
    const save = mount(textInput({ label: "Region", name: "area" }));
    openConfig();
    type(field("Label"), "Sales Region");
    expect(field("Name").value).toBe("area");
    press(field("Label"), "Enter");
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      label: "Sales Region",
      name: "area",
    });
  });

  it("rejects an invalid name with the source error and does not save it", () => {
    const save = mount(textInput({ label: "Region", name: "region" }));
    openConfig();
    type(field("Name"), "1 region");
    expect(document.body.textContent).toContain(NAME_ERROR);
    press(field("Name"), "Enter");
    expect(save).not.toHaveBeenCalled();
  });

  it("fills an empty label from the saved name the way the source does", () => {
    const save = mount(textInput({ label: null, name: "input_1" }));
    openConfig();
    type(field("Name"), "customer_region");
    press(field("Name"), "Enter");
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      label: "Customer region",
      name: "customer_region",
    });
  });

  it("does not write when nothing changed", () => {
    const save = mount(textInput({ label: "Region", name: "region" }));
    openConfig();
    press(field("Name"), "Enter");
    expect(save).not.toHaveBeenCalled();
  });

  // The source stores Multiline as a boolean option defaulting to false
  // (fdf1273c…js:1120) and its text renderer picks a textarea from it
  // (d5755db4…js:2246-2313); ours keeps it as an optional boolean on the
  // input's contents.
  it("keeps a text input's Multiline flag through the contents schema", () => {
    const parsed = cellContentsSchema.parse({
      ...textInput(),
      multiline: true,
    });
    expect("multiline" in parsed && parsed.multiline).toBe(true);
  });

  it("saves the Multiline switch and renders a textarea that keeps line breaks", () => {
    const save = mount(textInput());
    openConfig();
    const toggle = document.querySelector<HTMLButtonElement>(
      'button[role="switch"]',
    );
    assert.ok(toggle, "the Multiline switch is present");
    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({ multiline: true });

    const onChange = vi.fn();
    const onCommit = vi.fn();
    assert.ok(root);
    const mountedRoot = root;
    act(() =>
      mountedRoot.render(
        <AgentNativeI18nProvider>
          <InputCellControl
            contents={{ ...textInput(), multiline: true }}
            value={"a\nb"}
            disabled={false}
            onChange={onChange}
            onCommit={onCommit}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const area = document.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(area, "a textarea replaces the single-line input");
    expect(area.value).toBe("a\nb");
    press(area, "Enter");
    act(() => {
      area.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledWith("a\nb");
  });

  it("shows the switch on, and keeps it, when a multiline input is reopened", () => {
    mount(textInput({ multiline: true }));
    openConfig();
    const toggle = document.querySelector('button[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
  });
});
