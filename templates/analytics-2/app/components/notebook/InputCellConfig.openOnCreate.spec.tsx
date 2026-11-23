// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { requestInputConfig } from "./input-config-request";
import { InputCellControl, type InputCellContents } from "./InputCellControl";

const contents = (
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

function mount(value: InputCellContents) {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  act(() =>
    mounted.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <InputCellControl
          contents={value}
          value=""
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
          onChangeContents={() => {}}
        />
      </AgentNativeI18nProvider>,
    ),
  );
}

const nameField = () =>
  document.body.querySelector<HTMLInputElement>('input[aria-label="Name"]');

describe("a newly added input", () => {
  it("opens Label and Name when the cell was just added", () => {
    mount(contents());
    expect(nameField()).toBeNull();
    act(() => requestInputConfig("cel_input"));
    expect(nameField()?.value).toBe("input_1");
  });

  it("opens when the request lands before the cell mounts", () => {
    requestInputConfig("cel_input");
    mount(contents());
    expect(nameField()?.value).toBe("input_1");
  });

  it("stays closed for another cell and on a plain reload", () => {
    requestInputConfig("cel_other");
    mount(contents());
    expect(nameField()).toBeNull();
  });
});
