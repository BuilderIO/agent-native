// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));

const TOKEN_QUERY = vi.hoisted(() => ({
  isError: false,
  data: {
    tokens: [
      { name: "Space 1", cssVar: "--space-1", value: "4px", type: "spacing" },
      {
        name: "Space 14",
        cssVar: "--space-14",
        value: "56px",
        type: "spacing",
      },
      {
        name: "Space Page",
        cssVar: "--space-page",
        value: "var(--space-14)",
        type: "spacing",
      },
      {
        name: "Container Sm",
        cssVar: "--container-sm",
        value: "640px",
        type: "container",
      },
    ],
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => TOKEN_QUERY,
}));

import { DesignColorTokensProvider } from "../edit-panel/design-color-tokens";
import { TokenScrubInput, type TokenFieldBinding } from "./TokenScrubInput";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(authored: string | undefined, value = 116) {
  const onChange = vi.fn();
  const binding: TokenFieldBinding = {
    accepts: ["container", "spacing"],
    authored,
    onBind: vi.fn(),
    onDetach: vi.fn(),
  };
  act(() =>
    root.render(
      <DesignColorTokensProvider designId="design-1">
        <TokenScrubInput
          label="W"
          ariaLabel="Width"
          value={value}
          onChange={onChange}
          unit="px"
          tokenBinding={binding}
        />
      </DesignColorTokensProvider>,
    ),
  );
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Width"]',
  );
  if (!input) throw new Error("missing field");
  return { input, onChange, binding };
}

function key(
  input: HTMLInputElement,
  name: string,
  init: KeyboardEventInit = {},
) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }),
    );
  });
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function options() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).map((option) => option.getAttribute("data-token-field-option"));
}

function headings() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="listbox"] [role="presentation"]',
    ),
  ).map((heading) => heading.textContent);
}

describe("TokenScrubInput", () => {
  it("opens on ↓ with the accepted tokens grouped, aliases before scales", () => {
    const { input } = render(undefined);
    act(() => input.focus());
    key(input, "ArrowDown");

    expect(
      container
        .querySelector("button[data-token-field-chevron]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(options()).toEqual([
      "container-sm",
      "space-page",
      "space-1",
      "space-14",
    ]);
    expect(headings()).toEqual([
      "designEditor.tokens.types.container",
      "designEditor.tokens.types.spacing",
      "designEditor.tokens.field.primitives:designEditor.tokens.types.spacing",
    ]);
  });

  it("filters by a typed name and binds the highlighted token on Enter", () => {
    const { input, binding, onChange } = render(undefined);
    act(() => input.focus());
    type(input, "page");

    expect(options()).toEqual(["space-page"]);
    key(input, "Enter");

    expect(binding.onBind).toHaveBeenCalledWith("--space-page", "56px");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a bound field's exact token name with Detach first", () => {
    const { input, binding } = render("var(--space-page)", 56);
    expect(input.value).toBe("space-page");

    act(() => input.focus());
    key(input, "ArrowDown", { altKey: true });
    expect(options()[0]).toBe("detach");
    expect(
      document
        .querySelector('[data-token-field-option="space-page"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    key(input, "Escape");
    act(() => input.focus());
    key(input, "Backspace");
    expect(binding.onDetach).toHaveBeenCalledWith("56px");
  });

  it("commits a typed number as a custom value", () => {
    const { input, binding, onChange } = render("var(--space-page)", 56);
    act(() => input.focus());
    type(input, "72");
    key(input, "Enter");

    expect(onChange).toHaveBeenCalledWith(
      72,
      expect.objectContaining({ phase: "commit" }),
    );
    expect(binding.onBind).not.toHaveBeenCalled();
  });

  it("commits a number typed after ↓ opened the list", () => {
    const { input, binding, onChange } = render(undefined);
    act(() => input.focus());
    key(input, "ArrowDown");
    type(input, "30");
    key(input, "Enter");

    expect(options()).toEqual([]);
    expect(onChange).toHaveBeenCalledWith(
      30,
      expect.objectContaining({ phase: "commit" }),
    );
    expect(binding.onBind).not.toHaveBeenCalled();
  });

  it("says the token list failed to load instead of showing it empty", () => {
    const data = TOKEN_QUERY.data;
    Object.assign(TOKEN_QUERY, { data: undefined, isError: true });
    try {
      const { input } = render(undefined);
      act(() => input.focus());
      key(input, "ArrowDown");

      expect(document.querySelector('[role="listbox"]')?.textContent).toBe(
        "editPanel.colorPicker.tokensFailed",
      );
    } finally {
      Object.assign(TOKEN_QUERY, { data, isError: false });
    }
  });

  it("returns focus to the field once a picked token is applied", () => {
    const { input } = render(undefined);
    act(() => input.focus());
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(document.activeElement).not.toBe(input);

    render("var(--container-sm)", 640);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("container-sm");
  });

  it("returns focus to the field after a preset is picked", () => {
    const onSelect = vi.fn();
    const renderWithPreset = (authored: string) =>
      act(() =>
        root.render(
          <DesignColorTokensProvider designId="design-1">
            <TokenScrubInput
              label="Size"
              ariaLabel="Size"
              value={16}
              onChange={vi.fn()}
              unit="px"
              tokenBinding={{
                accepts: ["font-size"],
                authored,
                onBind: vi.fn(),
                onDetach: vi.fn(),
                extraGroups: [
                  {
                    key: "scale",
                    items: [{ key: "24", label: "24", onSelect }],
                  },
                ],
              }}
            />
          </DesignColorTokensProvider>,
        ),
      );
    renderWithPreset("16px");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Size"]',
    );
    if (!input) throw new Error("missing field");
    act(() => input.focus());
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(onSelect).toHaveBeenCalled();

    renderWithPreset("24px");
    expect(document.activeElement).toBe(input);
  });

  it("is a combobox that names its list only while the list is open", () => {
    const { input } = render(undefined);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-controls")).toBe(false);

    act(() => input.focus());
    key(input, "ArrowDown");
    const listId = input.getAttribute("aria-controls");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(
      listId && document.getElementById(listId)?.getAttribute("role"),
    ).toBe("listbox");
  });

  it("scrolls the keyboard-highlighted token into view", () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      function (this: HTMLElement) {
        scrolled.push(this.getAttribute("data-token-field-option") ?? "");
      },
    );
    const { input } = render(undefined);
    act(() => input.focus());
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    key(input, "ArrowDown");

    expect(scrolled[scrolled.length - 1]).toBe("space-1");
    vi.restoreAllMocks();
  });

  it("applies Mixed+2 as a relative change on a mixed selection", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <DesignColorTokensProvider designId="design-1">
          <TokenScrubInput
            label="Size"
            ariaLabel="Size"
            value={16}
            mixed
            onChange={onChange}
            unit="px"
            tokenBinding={{
              accepts: ["font-size"],
              authored: undefined,
              onBind: vi.fn(),
              onDetach: vi.fn(),
            }}
          />
        </DesignColorTokensProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Size"]',
    );
    if (!input) throw new Error("missing field");
    act(() => input.focus());
    type(input, "Mixed+2");
    key(input, "Enter");
    act(() => input.blur());

    expect(onChange).toHaveBeenCalledWith(
      18,
      expect.objectContaining({
        relativeExpression: expect.objectContaining({ expression: "Mixed+2" }),
      }),
    );
  });

  it("keeps ↑ nudging the value", () => {
    const { input, onChange } = render(undefined);
    act(() => input.focus());
    key(input, "ArrowUp");
    expect(onChange).toHaveBeenCalledWith(
      117,
      expect.objectContaining({ phase: "commit" }),
    );
  });
});
