// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { assert, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { InputCellControl, parseMultiValue } from "./InputCellControl";

const choicesQuery = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: choicesQuery,
}));

const base = {
  id: "cel_input",
  order: "a0",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  kind: "input" as const,
  name: "region",
};

function renderStatic(node: ReactNode) {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      {node}
    </AgentNativeI18nProvider>,
  );
}

describe("InputCellControl", () => {
  it.each([
    ["TEXT_INPUT", "text", "North"],
    ["NUMERIC_INPUT", "number", "6.25"],
    ["DATE", "date", "2026-11-08"],
  ] as const)(
    "renders a labeled %s with its saved value",
    (inputType, type, value) => {
      const html = renderStatic(
        <InputCellControl
          contents={{ ...base, inputType, defaultValueString: value }}
          value={value}
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
        />,
      );
      expect(html).toContain(`type="${type}"`);
      expect(html).toContain(`value="${value}"`);
      expect(html).toContain('aria-label="Value for region"');
    },
  );

  it("renders the source slider default range", () => {
    const html = renderStatic(
      <InputCellControl
        contents={{ ...base, inputType: "SLIDER", defaultValueString: "4" }}
        value="4"
        disabled={false}
        onChange={() => {}}
        onCommit={() => {}}
      />,
    );
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="10"');
    expect(html).toContain('step="1"');
  });

  it("uses the minimum for an empty value and preserves an out-of-range value", () => {
    for (const [value, expected] of [
      ["", "5"],
      ["0", "0"],
    ] as const) {
      const html = renderStatic(
        <InputCellControl
          contents={{
            ...base,
            inputType: "SLIDER",
            defaultValueString: value,
            sliderOptions: { min: 5, max: 5, step: 0 },
          }}
          value={value}
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
        />,
      );
      expect(html).toContain(`value="${expected}"`);
      expect(html).toContain('step="1"');
      expect(html).toContain(`>${expected}</output>`);
    }
  });

  it("renders a labeled switch for a CHECKBOX input", () => {
    const html = renderStatic(
      <InputCellControl
        contents={{
          ...base,
          inputType: "CHECKBOX",
          defaultValueString: "true",
        }}
        value="true"
        disabled={false}
        onChange={() => {}}
        onCommit={() => {}}
      />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="region"');
  });
});

async function pressEnter(element: HTMLElement) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

function selectOptions() {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

describe("InputCellControl dropdown", () => {
  it("saves a named dropdown and its first static choice from the configuration popover", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const save = vi.fn();
    try {
      await act(async () =>
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <InputCellControl
              contents={{
                ...base,
                name: "input_1",
                inputType: "DROPDOWN",
                defaultValueString: "",
              }}
              updatedAt="original-revision"
              value=""
              disabled={false}
              onChange={() => {}}
              onCommit={() => {}}
              onChangeContents={save}
            />
          </AgentNativeI18nProvider>,
        ),
      );
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Configure input"]',
      );
      assert(trigger);
      await act(async () => trigger.click());
      const popup = document.querySelector(
        '[role="dialog"][aria-label="Input settings"]',
      );
      assert(popup);
      const label = popup.querySelector<HTMLInputElement>(
        'input[name="label"]',
      );
      const name = popup.querySelector<HTMLInputElement>('input[name="name"]');
      assert(label && name);
      expect(label.value).toBe("Input 1");
      expect(name.value).toBe("input_1");
      expect(
        popup
          .querySelector('[aria-label="Allow users to clear selection"]')
          ?.getAttribute("aria-checked"),
      ).toBe("false");
      const staticMode = [...popup.querySelectorAll("button")].find(
        (button) => button.textContent === "Static",
      );
      assert(staticMode);
      await act(async () => staticMode.click());
      expect(popup.querySelector("select")).toBeNull();
      const choices = popup.querySelector<HTMLTextAreaElement>("textarea");
      assert(choices);
      const change = async (
        field: HTMLInputElement | HTMLTextAreaElement,
        value: string,
      ) => {
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(field),
          "value",
        )?.set;
        assert(setter);
        await act(async () => {
          setter.call(field, value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      await change(name, "region");
      expect(label.value).toBe("Region");
      await change(label, "Region");
      await change(choices, "North, South, North");
      expect(save).not.toHaveBeenCalled();
      await act(async () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      expect(save).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          label: "Region",
          name: "region",
          options: ["North", "South"],
          defaultValueString: "North",
        }),
        "original-revision",
        undefined,
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("selects and clears labeled options by keyboard without a native select", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    function Control() {
      const [value, setValue] = useState("2");
      return (
        <InputCellControl
          contents={{
            ...base,
            inputType: "DROPDOWN",
            defaultValueString: "2",
            options: ["1", "2"],
            optionLabels: { "1": "EMEA", "2": "APAC" },
            optional: true,
          }}
          value={value}
          disabled={false}
          onChange={setValue}
          onCommit={onCommit}
        />
      );
    }
    try {
      await act(async () =>
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <Control />
          </AgentNativeI18nProvider>,
        ),
      );
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[role="combobox"][aria-label="Value for region"]',
      );
      assert(trigger);
      expect(trigger.textContent).toBe("APAC");
      expect(host.querySelector("select")).toBeNull();
      trigger.focus();
      await pressEnter(trigger);
      expect(selectOptions().map((option) => option.textContent)).toEqual([
        "Clear selection",
        "EMEA",
        "APAC",
      ]);
      expect(document.querySelector("select")).toBeNull();
      const emea = selectOptions().find(
        (option) => option.textContent === "EMEA",
      );
      assert(emea);
      await pressEnter(emea);
      expect(onCommit).toHaveBeenCalledExactlyOnceWith("1");
      expect(trigger.textContent).toBe("EMEA");
      await pressEnter(trigger);
      const clear = selectOptions().find(
        (option) => option.textContent === "Clear selection",
      );
      assert(clear);
      await pressEnter(clear);
      expect(onCommit).toHaveBeenLastCalledWith("");
      expect(trigger.textContent).toBe("Clear selection");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { canConfigure: false, action: undefined },
    { canConfigure: true, action: "Configure input" },
  ])(
    "guides an empty dropdown with configure availability $canConfigure",
    ({ canConfigure, action }) => {
      const html = renderStatic(
        <InputCellControl
          contents={{ ...base, inputType: "DROPDOWN", defaultValueString: "" }}
          value=""
          disabled={false}
          onChange={() => {}}
          onCommit={() => {}}
          onChangeContents={canConfigure ? () => {} : undefined}
        />,
      );
      expect(html).toContain("No choices available");
      expect(html).not.toContain("Clear selection");
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(
        host.querySelector('button[aria-label="Configure input"]')?.textContent,
      ).toBe(action);
    },
  );

  it("offers earlier result cells as dynamic producers", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const frame = {
      columns: [{ name: "region", type: "string" }],
      rows: [["North"]],
    };
    const node = (
      <InputCellControl
        contents={{
          ...base,
          order: "a1",
          inputType: "DROPDOWN",
          defaultValueString: "",
          dynamicOptions: { producerCellId: "earlier", valueFieldId: "0" },
        }}
        dataframes={[
          {
            ...frame,
            cellId: "earlier",
            name: "earlier_result",
            sourceOrder: "a0",
          },
          {
            ...frame,
            cellId: "later",
            name: "later_result",
            sourceOrder: "a2",
          },
        ]}
        value=""
        disabled={false}
        onChange={() => {}}
        onCommit={() => {}}
        onChangeContents={() => {}}
      />
    );
    try {
      await act(async () =>
        root.render(
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            {node}
          </AgentNativeI18nProvider>,
        ),
      );
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Configure input"]',
      );
      assert(trigger);
      await act(async () => trigger.click());
      const picker = document.querySelector<HTMLButtonElement>(
        'button[role="combobox"][aria-label="Choose an input..."]',
      );
      assert(picker);
      expect(picker.textContent).toBe("earlier_result");
      expect(
        document.querySelector(
          '[role="combobox"][aria-label="Value column..."]',
        )?.textContent,
      ).toBe("region (string)");
      expect(document.querySelector("select")).toBeNull();
      await pressEnter(picker);
      expect(selectOptions().map((option) => option.textContent)).toEqual([
        "Choose an input...",
        "earlier_result",
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe("InputCellControl multiselect", () => {
  it("commits the multiselect value when its popover closes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCommit = vi.fn();
    function Control() {
      const [value, setValue] = useState('["APAC"]');
      return (
        <InputCellControl
          contents={{
            ...base,
            inputType: "MULTISELECT",
            defaultValueString: "[]",
            options: ["EMEA", "APAC"],
          }}
          value={value}
          disabled={false}
          onChange={setValue}
          onCommit={onCommit}
        />
      );
    }
    try {
      await act(async () => root.render(<Control />));
      const trigger = host.querySelector("button");
      assert(trigger);
      await act(async () => trigger.click());
      const checks = document.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="region"] button[role="checkbox"]',
      );
      expect(
        [...checks].map((check) => check.getAttribute("aria-checked")),
      ).toEqual(["false", "true"]);
      const [emea, apac] = checks;
      assert(emea && apac);
      await act(async () => {
        emea.click();
        apac.click();
      });
      expect(onCommit).not.toHaveBeenCalled();
      await act(async () => trigger.click());
      expect(onCommit).toHaveBeenCalledExactlyOnceWith('["EMEA"]');
      expect(trigger.textContent).toBe("EMEA");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("parses only a string array as a stored selection", () => {
    expect(parseMultiValue('["a","b"]')).toEqual(["a", "b"]);
    expect(parseMultiValue("not json")).toEqual([]);
    expect(parseMultiValue('{"a":1}')).toEqual([]);
    expect(parseMultiValue("")).toEqual([]);
  });
});

it("distinguishes missing and empty dynamic choices and commits the first verified option", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onCommit = vi.fn();
  const contents = {
    ...base,
    inputType: "DROPDOWN" as const,
    defaultValueString: "",
    dynamicOptions: { producerCellId: "producer", valueFieldId: "0" },
  };
  function Control() {
    const [value, setValue] = useState("");
    return (
      <InputCellControl
        contents={contents}
        projectId="project"
        value={value}
        disabled={false}
        onChange={setValue}
        onCommit={onCommit}
      />
    );
  }
  async function render(status: "missing" | "empty" | "ready") {
    choicesQuery.mockReturnValue({
      isError: false,
      data:
        status === "ready"
          ? {
              status,
              resultId: "result-south",
              values: [{ value: "south", label: "South" }],
            }
          : { status },
      refetch: vi.fn(),
    });
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <Control />
        </AgentNativeI18nProvider>,
      ),
    );
  }
  try {
    await render("missing");
    expect(host.textContent).toContain("Run the options cell to load choices.");
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    assert(trigger);
    expect(trigger.disabled).toBe(true);
    await render("empty");
    expect(host.textContent).toContain("No choices available");
    expect(trigger.disabled).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    await render("ready");
    expect(trigger.disabled).toBe(false);
    expect(host.textContent).toContain("South");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("south", "result-south");
    await render("ready");
    expect(onCommit).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps inline input slots non-shrinking and commits slider value on blur", async () => {
  const { INLINE_SLOT_CLASS } = await import("./InputCellControl");
  expect(INLINE_SLOT_CLASS).toContain("shrink-0");

  const onChange = vi.fn();
  const onCommit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <InputCellControl
            contents={{
              id: "cel_slider",
              order: "a0",
              label: null,
              hidden: false,
              gridX: null,
              gridY: null,
              gridWidth: null,
              gridHeight: null,
              kind: "input",
              name: "threshold",
              inputType: "SLIDER",
              sliderOptions: { min: 0, max: 100, step: 1 },
              defaultValueString: "25",
            }}
            value="40"
            disabled={false}
            onChange={onChange}
            onCommit={onCommit}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
    assert(slider);
    await act(async () => {
      slider.focus();
      slider.blur();
    });
    expect(onCommit).toHaveBeenCalledWith("40");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
