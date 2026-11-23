// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { InputCellControl, type InputCellContents } from "./InputCellControl";

const input: InputCellContents = {
  id: "cel_input",
  order: "n",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  kind: "input",
  name: "region",
  inputType: "TEXT_INPUT",
  defaultValueString: "",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

it("flags a reserved word as an invalid name and keeps the saved name", () => {
  const onChangeContents = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <InputCellControl
          contents={input}
          value=""
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
          onChangeContents={onChangeContents}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const gear = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Configure cell"]',
  );
  assert.ok(gear);
  act(() => {
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const name = document.querySelector<HTMLInputElement>(
    'input[aria-label="Name"]',
  );
  assert.ok(name);
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(name, "class");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "valid python identifier",
  );
  act(() => {
    name.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(onChangeContents).not.toHaveBeenCalledWith(
    expect.objectContaining({ name: "class" }),
  );
});

it("clears an existing custom label when the label field is emptied", () => {
  const onChangeContents = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <InputCellControl
          contents={{ ...input, label: "Custom Region" }}
          value=""
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
          onChangeContents={onChangeContents}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const gear = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Configure cell"]',
  );
  assert.ok(gear);
  act(() => {
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const labelInput = document.querySelector<HTMLInputElement>(
    'input[aria-label="Label"]',
  );
  assert.ok(labelInput);
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(labelInput, "");
    labelInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    labelInput.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(onChangeContents.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ label: null }),
  );
});
