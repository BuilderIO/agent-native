// @vitest-environment happy-dom

/**
 * Choosing Gradient on a solid fill turns it into a gradient layer row. That
 * row's paint row must still offer Solid, Gradient, Image, Shader and None,
 * and Shader must work from it: the shader takes the layer's place in the same
 * source write, so the Fill list shows one fill, the shader.
 */

import { listShaderMounts } from "@shared/shader-fills";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  source: "",
  applied: [] as Array<{ name: string; params: Record<string, unknown> }>,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (name: string) => {
    if (name === "read-source-file") {
      return Promise.resolve({
        content: mocks.source,
        versionHash: "v1",
        fileId: "f1",
      });
    }
    throw new Error(`unexpected callAction: ${name}`);
  },
  useActionMutation: (name: string) => ({
    mutateAsync: (params: Record<string, unknown>) => {
      mocks.applied.push({ name, params });
      return Promise.resolve({
        fileId: "f1",
        updatedAt: "2026-07-06T00:00:00.000Z",
      });
    },
  }),
  useActionQuery: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
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

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return { ...actual, FieldTrailer: () => null };
});

import type { ElementInfo } from "../types";
import { FillProperties } from "./fill-properties";

const GRADIENT = "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)";
const RADIAL = "radial-gradient(circle at center, #00ff00 0%, #ff00ff 100%)";
const LAYER_STYLE = `background-color: transparent; background-image: ${GRADIENT}; background-size: auto; background-repeat: no-repeat; background-position: 0% 0%`;

function documentWith(style: string): string {
  return `<html><body><div data-agent-native-node-id="hero" style="${style}"></div></body></html>`;
}

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    sourceId: "hero",
    ...overrides,
  } as ElementInfo;
}

function layerElement(backgroundImage = GRADIENT): ElementInfo {
  return element({
    computedStyles: {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage,
      backgroundSize: "",
      backgroundRepeat: "",
      backgroundPosition: "",
    },
    inlineStyles: { backgroundColor: "transparent", backgroundImage },
  });
}

/** The element as the editor reads it back from the source after a write. */
function elementFromSource(html: string): ElementInfo {
  if (html.includes("background-image")) return layerElement();
  return element({
    computedStyles: {
      backgroundColor: "rgb(255, 154, 158)",
      backgroundImage: "none",
    },
    inlineStyles: { backgroundColor: "#ff9a9e" },
  });
}

function Editor({ initial }: { initial: string }) {
  const [content, setContent] = useState(initial);
  return (
    <FillProperties
      element={elementFromSource(content)}
      onStyleChange={styleChange}
      glslShaderContext={{
        designId: "d1",
        fileId: "f1",
        content,
        nodeId: "hero",
        onApplied: (_fileId, next) => {
          mocks.source = next;
          setContent(next);
        },
      }}
    />
  );
}

const styleChange = vi.fn();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  mocks.applied.length = 0;
  styleChange.mockReset();
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

const layerRows = () =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-inspector-layout="drag-paint-row"]',
    ),
  );
const paintRow = () =>
  document.querySelector<HTMLElement>(
    '[data-design-chrome-region="right-panel"] div.border-b.h-10',
  );
const paintLabels = () =>
  Array.from(paintRow()?.querySelectorAll("button") ?? []).map((button) =>
    button.getAttribute("aria-label"),
  );
const paint = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

function openLayerPicker(index = 0) {
  act(() =>
    layerRows()
      [index]!.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="dialog"]',
      )!
      .click(),
  );
}

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

describe("a gradient layer's paint row", () => {
  it("offers Solid, Gradient, Image, Shader and None", () => {
    mocks.source = documentWith(LAYER_STYLE);
    render(<Editor initial={mocks.source} />);
    openLayerPicker();

    expect(paintLabels()).toEqual([
      "Solid",
      "Gradient",
      "Image",
      "Shader",
      "None",
    ]);
  });

  it("offers the same five for an image layer", () => {
    const image = "url(a.png)";
    render(
      <FillProperties
        element={layerElement(image)}
        onStyleChange={styleChange}
        glslShaderContext={{ designId: "d1", fileId: "f1", nodeId: "hero" }}
      />,
    );
    openLayerPicker();

    expect(paintLabels()).toEqual([
      "Solid",
      "Gradient",
      "Image",
      "Shader",
      "None",
    ]);
  });

  it("replaces the layer with the shader in one source write", async () => {
    mocks.source = documentWith(LAYER_STYLE);
    render(<Editor initial={mocks.source} />);
    openLayerPicker();

    act(() => paint("Shader").click());
    expect(
      document.querySelector('[data-shader-pane="browse"]'),
    ).not.toBeNull();
    // Nothing is written until a shader is picked.
    expect(mocks.applied).toHaveLength(0);

    await act(async () => paint("Clouds").click());

    expect(mocks.applied).toHaveLength(1);
    expect(mocks.applied[0]!.name).toBe("apply-source-edit");
    const written = (mocks.applied[0]!.params.edit as { content: string })
      .content;
    expect(listShaderMounts(written)).toMatchObject([
      { nodeId: "hero", mode: "fill" },
    ]);
    for (const property of [
      "background-image",
      "background-size",
      "background-repeat",
      "background-position",
    ]) {
      expect(written).not.toContain(property);
    }
    // The layer goes with the shader, not through a second style write.
    expect(styleChange).not.toHaveBeenCalled();

    // The Fill list now shows the one fill, the shader, and its picker is open on it.
    expect(layerRows()).toHaveLength(0);
    expect(
      container.querySelectorAll('button[aria-label="Open color picker"]'),
    ).toHaveLength(1);
    expect(paint("Shader").getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector('[data-shader-pane="controls"]'),
    ).not.toBeNull();
  });

  it("leaves the layer alone when the user goes back to Gradient without picking a shader", () => {
    mocks.source = documentWith(LAYER_STYLE);
    render(<Editor initial={mocks.source} />);
    openLayerPicker();

    act(() => paint("Shader").click());
    act(() => paint("Gradient").click());

    expect(mocks.applied).toHaveLength(0);
    expect(layerRows()).toHaveLength(1);
  });
});

describe("Shader beside other fills", () => {
  it("is not offered on a layer while another layer exists", () => {
    render(
      <FillProperties
        element={layerElement([GRADIENT, RADIAL].join(", "))}
        onStyleChange={styleChange}
        glslShaderContext={{ designId: "d1", fileId: "f1", nodeId: "hero" }}
      />,
    );
    openLayerPicker(0);

    expect(paintLabels()).toEqual(["Solid", "Gradient", "Image", "None"]);
  });

  it("is not offered on a layer while the element has a base fill", () => {
    render(
      <FillProperties
        element={element({
          computedStyles: {
            backgroundColor: "rgb(255, 0, 0)",
            backgroundImage: GRADIENT,
            backgroundSize: "",
            backgroundRepeat: "",
            backgroundPosition: "",
          },
          inlineStyles: {
            backgroundColor: "#ff0000",
            backgroundImage: GRADIENT,
          },
        })}
        onStyleChange={styleChange}
        glslShaderContext={{ designId: "d1", fileId: "f1", nodeId: "hero" }}
      />,
    );
    openLayerPicker(0);

    expect(paintLabels()).toEqual(["Solid", "Gradient", "Image", "None"]);
  });
});

describe("the sets that do not change", () => {
  it("a text layer keeps its gradient-only set, with no Shader", () => {
    render(
      <FillProperties
        element={element({
          tagName: "p",
          computedStyles: {
            color: "rgb(0, 0, 0)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage: GRADIENT,
            backgroundClip: "text",
          },
        })}
        onStyleChange={styleChange}
        glslShaderContext={{ designId: "d1", fileId: "f1", nodeId: "hero" }}
      />,
    );
    openLayerPicker(0);

    expect(paint("Shader")).toBeNull();
    expect(paint("Image")).toBeNull();
    expect(paint("Solid")).toBeNull();
  });

  it("a vector fill keeps Solid and Gradient, with no Shader", () => {
    render(
      <FillProperties
        element={element({
          tagName: "rect",
          computedStyles: { fill: "rgb(255, 0, 0)" },
          inlineStyles: { fill: "#ff0000" },
        })}
        onStyleChange={styleChange}
        glslShaderContext={{ designId: "d1", fileId: "f1", nodeId: "hero" }}
      />,
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click(),
    );

    expect(paint("Solid")).not.toBeNull();
    expect(paint("Gradient")).not.toBeNull();
    expect(paint("Shader")).toBeNull();
    expect(paint("Image")).toBeNull();
  });
});
