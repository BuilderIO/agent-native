// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, assert, describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { InputCellControl, type InputCellContents } from "./InputCellControl";
import { ProjectVariablesPanel } from "./ProjectVariablesPanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const contents: InputCellContents = {
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
};

describe("input configuration length", () => {
  it("accepts a label longer than 200 characters", () => {
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
            contents={contents}
            value=""
            disabled={false}
            onChange={() => {}}
            onCommit={() => {}}
            onChangeContents={() => {}}
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
    const label = document.querySelector<HTMLInputElement>(
      'input[aria-label="Label"]',
    );
    assert.ok(label);
    expect(label.hasAttribute("maxlength")).toBe(false);
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name"]',
    );
    expect(name?.hasAttribute("maxlength")).toBe(false);
  });
});

describe("ProjectVariablesPanel empty copy", () => {
  it("reads the empty state from the message catalog", () => {
    const html = renderToStaticMarkup(
      <AgentNativeI18nProvider
        catalog={{
          messages: {
            ...enUS,
            notebook: {
              ...enUS.notebook,
              pythonNoVariables: "Catalog empty copy",
            },
          },
        }}
      >
        <ProjectVariablesPanel
          variables={[]}
          onClose={() => {}}
          onJump={() => {}}
        />
      </AgentNativeI18nProvider>,
    );
    expect(html).toContain("Catalog empty copy");
  });
});
