// @vitest-environment happy-dom

/**
 * What FillProperties hands the base fill's picker for contrast and tokens:
 * contrast only for a text layer's own fill, with a screen to read; token
 * binding for CSS paints, not for SVG vector fills.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DesignColorContrast } from "../inspector/color-picker-contrast";
import type { ElementInfo } from "../types";
import { FillProperties } from "./fill-properties";
import type { TextContrastContext } from "./text-contrast";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children?: unknown }) => children as never,
  PopoverTrigger: ({ children }: { children?: unknown }) => children as never,
  PopoverContent: () => null,
}));

vi.mock("../inspector", () => ({
  DesignColorPicker: ({ trigger }: { trigger?: unknown }) => trigger as never,
  ScrubInput: () => null,
  imageFillToBackgroundStyles: () => ({}),
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return { ...actual, FieldTrailer: () => null };
});

vi.mock("./panel-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./panel-primitives")>();
  return {
    ...actual,
    ColorInput: (props: {
      contrast?: DesignColorContrast;
      bindTokens?: boolean;
      boundToken?: string;
    }) =>
      createElement("div", {
        "data-testid": "base-fill-color-input",
        "data-has-contrast": String(props.contrast !== undefined),
        "data-contrast-large": String(props.contrast?.large),
        "data-bind-tokens": String(props.bindTokens ?? false),
        "data-bound-token": props.boundToken ?? "",
      }),
  };
});

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

const context: TextContrastContext = {
  designId: "d1",
  screenId: "screen-1",
  selector: "#t",
};

function textElement(overrides: Partial<ElementInfo> = {}) {
  return element({
    tagName: "p",
    hasOwnText: true,
    textContent: "Hello",
    computedStyles: {
      color: "rgb(158, 158, 158)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      fontSize: "16px",
      fontWeight: "400",
    },
    ...overrides,
  });
}

function render(
  el: ElementInfo,
  contrastContext: TextContrastContext | undefined = context,
) {
  return renderToStaticMarkup(
    createElement(FillProperties, {
      element: el,
      onStyleChange: vi.fn(),
      onStylesChange: vi.fn(),
      contrastContext,
    }),
  );
}

describe("FillProperties contrast", () => {
  it("gives a text layer's fill contrast, as body text at 16px", () => {
    const markup = render(textElement());
    expect(markup).toContain('data-has-contrast="true"');
    expect(markup).toContain('data-contrast-large="false"');
  });

  it("counts 32px text as large", () => {
    const markup = render(
      textElement({
        computedStyles: {
          color: "rgb(158, 158, 158)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          fontSize: "32px",
          fontWeight: "400",
        },
      }),
    );
    expect(markup).toContain('data-contrast-large="true"');
  });

  it("does not count text it cannot measure as body or large", () => {
    const markup = render(
      textElement({
        computedStyles: {
          color: "rgb(158, 158, 158)",
          backgroundColor: "rgba(0, 0, 0, 0)",
        },
      }),
    );
    expect(markup).toContain('data-has-contrast="true"');
    expect(markup).toContain('data-contrast-large="null"');
  });

  it("has no contrast without a screen to read from", () => {
    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: textElement(),
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );
    expect(markup).toContain('data-has-contrast="false"');
  });

  it("has no contrast for a box fill, even one holding text", () => {
    const markup = render(
      element({
        tagName: "button",
        hasOwnText: true,
        textContent: "Listen now",
        computedStyles: {
          color: "#ffffff",
          backgroundColor: "#0f766e",
          fontSize: "16px",
          fontWeight: "600",
        },
      }),
    );
    expect(markup).toContain('data-has-contrast="false"');
  });
});

describe("FillProperties token binding", () => {
  it("offers tokens for a box fill and reports the token it is bound to", () => {
    const markup = render(
      element({
        computedStyles: { backgroundColor: "rgb(10, 107, 214)" },
        inlineStyles: { backgroundColor: "var(--link)" },
      }),
    );
    expect(markup).toContain('data-bind-tokens="true"');
    expect(markup).toContain('data-bound-token="--link"');
  });

  it("reports no bound token for a literal color", () => {
    const markup = render(
      element({
        computedStyles: { backgroundColor: "rgb(10, 107, 214)" },
        inlineStyles: { backgroundColor: "#0a6bd6" },
      }),
    );
    expect(markup).toContain('data-bound-token=""');
  });

  it("reads the bound token of a text color from its own property", () => {
    const markup = render(
      textElement({ inlineStyles: { color: "var(--ink)" } }),
    );
    expect(markup).toContain('data-bound-token="--ink"');
  });
});
