/**
 * Base fill row image-layer prop wiring regression.
 *
 * `FillProperties`' base swatch renders a `<ColorInput>` whose
 * `onImageFillLayerChange` builds its commit patch from whatever ColorInput
 * computes internally from its `backgroundImage`/`backgroundSize`/
 * `backgroundRepeat`/`backgroundPosition` props (see `imageFillChangePatch`
 * in fill-gradient-helpers.ts). The base row previously only passed
 * `backgroundImage`, so ColorInput treated every sibling layer as having no
 * size/repeat/position of its own — switching the base swatch to Image then
 * rebuilt those three properties as a single-entry list against the real
 * N+1-layer backgroundImage stack, corrupting every existing gradient/image
 * layer's size/repeat/position via CSS background-layer-list cycling (e.g.
 * an existing "cover" silently became "auto").
 *
 * There is no React Testing Library in this app, but `layout-properties.test.tsx`
 * establishes the pattern of rendering with `react-dom/server` and asserting
 * on the resulting markup, so this file follows the same approach: stub out
 * `ColorInput` to surface the exact props it receives, then assert the base
 * row's `<ColorInput>` is wired with the real backgroundSize/backgroundRepeat/
 * backgroundPosition values instead of leaving them empty.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "../types";
import { baseFillLayerSourceProps, FillProperties } from "./fill-properties";

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
  DesignColorPicker: () => null,
  imageFillToBackgroundStyles: () => ({
    backgroundImage: "",
    backgroundSize: "",
    backgroundRepeat: "",
    backgroundPosition: "",
  }),
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return {
    ...actual,
    FieldTrailer: () => null,
  };
});

// Stub ColorInput so the test can inspect exactly what props the base fill
// row wires it with, without needing to render the real popover/picker tree.
vi.mock("./panel-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./panel-primitives")>();
  return {
    ...actual,
    ColorInput: (props: {
      value: string;
      resolvedColor?: string;
      backgroundImage?: string;
      backgroundSize?: string;
      backgroundRepeat?: string;
      backgroundPosition?: string;
    }) =>
      createElement("div", {
        "data-testid": "base-fill-color-input",
        "data-value": props.value,
        "data-resolved-color": props.resolvedColor ?? "",
        "data-background-image": props.backgroundImage ?? "",
        "data-background-size": props.backgroundSize ?? "",
        "data-background-repeat": props.backgroundRepeat ?? "",
        "data-background-position": props.backgroundPosition ?? "",
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

describe("baseFillLayerSourceProps", () => {
  it("sources all four background layer props together for a non-text fill", () => {
    expect(
      baseFillLayerSourceProps(
        {
          backgroundImage: "url(a.png), linear-gradient(red, blue)",
          backgroundSize: "cover, 100% 100%",
          backgroundRepeat: "no-repeat, repeat",
          backgroundPosition: "center, 0% 0%",
        },
        false,
      ),
    ).toEqual({
      backgroundImage: "url(a.png), linear-gradient(red, blue)",
      backgroundSize: "cover, 100% 100%",
      backgroundRepeat: "no-repeat, repeat",
      backgroundPosition: "center, 0% 0%",
    });
  });

  it("collapses every value to empty for a text fill (color can't hold a layered paint)", () => {
    expect(
      baseFillLayerSourceProps(
        {
          backgroundImage: "url(a.png)",
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        },
        true,
      ),
    ).toEqual({
      backgroundImage: "",
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    });
  });
});

describe("FillProperties base row — image layer prop wiring", () => {
  it("wires backgroundSize/backgroundRepeat/backgroundPosition onto the base row's ColorInput, not just backgroundImage", () => {
    const el = element({
      computedStyles: {
        backgroundColor: "rgba(255,255,255,1)",
        backgroundImage: "url(hero.png), linear-gradient(red, blue)",
        backgroundSize: "cover, 100% 100%",
        backgroundRepeat: "no-repeat, repeat",
        backgroundPosition: "center, 0% 0%",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    // Before the fix, backgroundSize/backgroundRepeat/backgroundPosition were
    // never passed at all, so these data attributes would be missing/empty
    // even though the element clearly has real, non-default values for all
    // three (a genuine "cover, 100% 100%" sibling layer stack).
    expect(markup).toContain('data-background-image="url(hero.png)');
    expect(markup).toContain('data-background-size="cover, 100% 100%"');
    expect(markup).toContain('data-background-repeat="no-repeat, repeat"');
    expect(markup).toContain('data-background-position="center, 0% 0%"');
  });

  it("leaves every layer prop empty for a text fill selection", () => {
    const el = element({
      tagName: "span",
      computedStyles: {
        color: "#000000",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-background-image=""');
    expect(markup).toContain('data-background-size=""');
    expect(markup).toContain('data-background-repeat=""');
    expect(markup).toContain('data-background-position=""');
  });
});

describe("design system token fills", () => {
  it("shows the authored var() reference, not the colour it resolves to", () => {
    // getComputedStyle resolves var(), so a token-backed fill arrives already
    // flattened. Only the authored inline declaration still names the token —
    // and the bridge has to report the property for this to be reachable at
    // all (see INLINE_STYLE_PROPERTIES in editor-chrome.bridge.ts).
    const el = element({
      computedStyles: { backgroundColor: "rgb(15, 98, 254)" },
      inlineStyles: { backgroundColor: "var(--color-accent, #0f62fe)" },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="var(--color-accent, #0f62fe)"');
  });

  it("still shows a plain colour fill from computed styles", () => {
    const el = element({
      computedStyles: { backgroundColor: "rgb(15, 98, 254)" },
      inlineStyles: { backgroundColor: "#0f62fe" },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="rgb(15, 98, 254)"');
  });

  it("names a text fill from its authored reference too", () => {
    const el = element({
      tagName: "span",
      computedStyles: { color: "rgb(15, 98, 254)" },
      inlineStyles: { color: "var(--color-accent, #0f62fe)" },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="var(--color-accent, #0f62fe)"');
  });
});

describe("class-styled fills", () => {
  it("names a fill whose colour comes from a class rule, not inline style", () => {
    // A generated design styles through classes, so inlineStyles is empty and
    // computedStyles has already flattened var(). Only the bridge's
    // cascade-resolved declaration still carries the token.
    const el = element({
      tagName: "button",
      computedStyles: { backgroundColor: "rgb(15, 98, 254)" },
      inlineStyles: {},
      authoredColorStyles: {
        backgroundColor: "var(--cds-background-brand)",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="var(--cds-background-brand)"');
  });

  it("lets an inline declaration win over the class rule", () => {
    const el = element({
      tagName: "button",
      computedStyles: { backgroundColor: "rgb(0, 0, 0)" },
      inlineStyles: { backgroundColor: "var(--color-accent, #0f62fe)" },
      authoredColorStyles: {
        backgroundColor: "var(--color-accent, #0f62fe)",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="var(--color-accent, #0f62fe)"');
  });

  it("passes the canvas-resolved colour so a bare var() still paints a swatch", () => {
    // Generated CSS writes `var(--cds-background-brand)` with no fallback; the
    // editor document cannot resolve it, so the picker needs the painted colour.
    const el = element({
      tagName: "button",
      computedStyles: { backgroundColor: "rgb(15, 98, 254)" },
      inlineStyles: {},
      authoredColorStyles: {
        backgroundColor: "var(--cds-background-brand)",
      },
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="var(--cds-background-brand)"');
    expect(markup).toContain('data-resolved-color="rgb(15, 98, 254)"');
  });

  it("still uses the computed colour when nothing authored one", () => {
    const el = element({
      tagName: "button",
      computedStyles: { backgroundColor: "rgb(15, 98, 254)" },
      inlineStyles: {},
      authoredColorStyles: {},
    });

    const markup = renderToStaticMarkup(
      createElement(FillProperties, {
        element: el,
        onStyleChange: vi.fn(),
        onStylesChange: vi.fn(),
      }),
    );

    expect(markup).toContain('data-value="rgb(15, 98, 254)"');
  });
});
