// @vitest-environment happy-dom

/**
 * The picker's `Custom | Libraries` header stays through every paint type.
 *
 * Switching a box fill from Solid to Gradient moves the open picker from the
 * base row to the new gradient layer's own row (the base row is gone), and
 * that row's picker was never given the design's tokens, so the header
 * vanished and stayed gone once Solid was picked again. These tests drive the
 * real `FillProperties` with the real token provider and real pickers.
 */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

// One answer object: a fresh one per render would reload the token list forever.
const tokenAnswer = vi.hoisted(() => ({
  data: {
    tokens: [
      { name: "Link", cssVar: "--link", value: "#0a6bd6", type: "color" },
      { name: "Ink", cssVar: "--ink", value: "#111111", type: "color" },
    ],
  },
  isError: false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => tokenAnswer,
  useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  callAction: vi.fn(),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({ isSuccess: false }),
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return { ...actual, FieldTrailer: () => null };
});

import type { ElementInfo } from "../types";
import { DesignColorTokensProvider } from "./design-color-tokens";
import { FillProperties } from "./fill-properties";
import type {
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    ...overrides,
  } as ElementInfo;
}

function StatefulFill({
  onStyleChange,
  onStylesChange,
  tagName = "div",
  initialStyles,
}: {
  onStyleChange: StyleChangeHandler;
  onStylesChange: StylesChangeHandler;
  tagName?: string;
  initialStyles: Record<string, string>;
}) {
  const [computedStyles, setComputedStyles] = useState(initialStyles);
  return (
    <DesignColorTokensProvider designId="d1">
      <FillProperties
        element={element({ tagName, computedStyles, textContent: "Hello" })}
        onStyleChange={(property, value, meta) => {
          onStyleChange(property, value, meta);
          setComputedStyles((current) => ({ ...current, [property]: value }));
        }}
        onStylesChange={(patch, meta) => {
          onStylesChange(patch, meta);
          setComputedStyles((current) => ({ ...current, ...patch }));
        }}
      />
    </DesignColorTokensProvider>
  );
}

const BOX_FILL = {
  backgroundColor: "rgb(255, 0, 0)",
  backgroundImage: "none",
  backgroundSize: "",
  backgroundRepeat: "",
  backgroundPosition: "",
};

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
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"]',
  );
const tabs = () =>
  Array.from(popover()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
const tab = (label: string) =>
  tabs().find((candidate) => candidate.textContent === label)!;
const paint = (label: string) =>
  document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

function openBasePicker() {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open color picker"]',
      )!
      .click();
  });
}

describe("FillProperties — the picker header through the paint types", () => {
  it("keeps Custom | Libraries when a box fill goes Solid, Gradient, Solid", () => {
    act(() =>
      root.render(
        <StatefulFill
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
          initialStyles={BOX_FILL}
        />,
      ),
    );
    openBasePicker();
    expect(tabs().map((candidate) => candidate.textContent)).toEqual([
      "editPanel.colorPicker.custom",
      "editPanel.colorPicker.libraries",
    ]);

    act(() => paint("Gradient").click());
    expect(
      document.querySelector('[role="group"][aria-label="Gradient stops"]'),
    ).not.toBeNull();
    expect(tabs()).toHaveLength(2);

    act(() => paint("Solid").click());
    expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
    expect(tabs()).toHaveLength(2);
  });

  it("lists the tokens in a gradient layer's picker and binds the layer to the one picked", () => {
    const onStylesChange = vi.fn();
    const onStyleChange = vi.fn();
    act(() =>
      root.render(
        <StatefulFill
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={BOX_FILL}
        />,
      ),
    );
    openBasePicker();
    act(() => paint("Gradient").click());

    act(() =>
      tab("editPanel.colorPicker.libraries").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ),
    );
    const link = Array.from(
      popover()!.querySelectorAll<HTMLButtonElement>("button[title]"),
    ).find((button) => button.title === "--link")!;
    expect(link).toBeDefined();
    act(() => link.click());

    const written = [...onStylesChange.mock.calls, ...onStyleChange.mock.calls]
      .flatMap((call) => Object.values(call[0] as object).concat(call[1]))
      .filter((value): value is string => typeof value === "string");
    expect(written).toContain("linear-gradient(var(--link) 0 0)");
  });

  it("keeps the header on a text fill that goes Solid, Gradient, Solid", () => {
    act(() =>
      root.render(
        <StatefulFill
          tagName="p"
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
          initialStyles={{
            color: "rgb(255, 0, 0)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage: "none",
          }}
        />,
      ),
    );
    openBasePicker();
    expect(tabs()).toHaveLength(2);
    act(() => paint("Gradient").click());
    expect(tabs()).toHaveLength(2);
    act(() => paint("Solid").click());
    expect(tabs()).toHaveLength(2);
  });

  it("binds a text fill's color to the token picked while its gradient is open", () => {
    const onStyleChange = vi.fn();
    const onStylesChange = vi.fn();
    act(() =>
      root.render(
        <StatefulFill
          tagName="p"
          onStyleChange={onStyleChange}
          onStylesChange={onStylesChange}
          initialStyles={{
            color: "rgb(255, 0, 0)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage: "none",
          }}
        />,
      ),
    );
    openBasePicker();
    act(() => paint("Gradient").click());
    act(() =>
      tab("editPanel.colorPicker.libraries").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ),
    );
    const link = Array.from(
      popover()!.querySelectorAll<HTMLButtonElement>("button[title]"),
    ).find((button) => button.title === "--link")!;
    act(() => link.click());

    // The gradient layer goes and the text color is the token.
    expect(onStyleChange).toHaveBeenLastCalledWith(
      "color",
      "var(--link)",
      expect.objectContaining({ phase: "commit" }),
    );
    const patches = onStylesChange.mock.calls.map(
      (call) => call[0] as Record<string, string>,
    );
    const last = patches[patches.length - 1];
    expect(last).toEqual(
      expect.objectContaining({ backgroundClip: "border-box" }),
    );
    expect(last?.backgroundImage ?? "").not.toContain("gradient");
  });
});
