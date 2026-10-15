// @vitest-environment happy-dom

/**
 * A fill that already has a shader opens its picker on the Shader paint, with
 * the shader's controls in place; a fill without one opens on Solid.
 */

import {
  applyShaderToHtml,
  newShaderId,
  type GlslShaderMode,
} from "@shared/shader-fills";
import { GLSL_SHADER_PRESETS } from "@shared/shader-presets";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

// The pane reads the screen's shaders through the action hooks; the picker
// only decides when to show it.
vi.mock("../inspector/color-picker-shader-pane", () => ({
  ShaderPane: () => <div data-testid="shader-pane" />,
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return { ...actual, FieldTrailer: () => null };
});

import { findFillShader } from "../inspector/GlslShaderPanel";
import type { ElementInfo } from "../types";
import { FillProperties } from "./fill-properties";

const mesh = GLSL_SHADER_PRESETS.find(
  (preset) => preset.name === "mesh-gradient",
)!;
const effect = GLSL_SHADER_PRESETS.find((preset) => preset.mode === "effect")!;
const BASE =
  '<html><body><div data-agent-native-node-id="hero"></div></body></html>';

function withShader(mode: GlslShaderMode) {
  const preset = mode === "fill" ? mesh : effect;
  return applyShaderToHtml(BASE, {
    nodeId: "hero",
    def: {
      id: newShaderId(),
      name: preset.label,
      mode,
      glsl: preset.glsl,
      uniforms: preset.uniforms,
    },
    fallbackColor: "#ff9a9e",
  }).html;
}

function element(): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: {
      backgroundColor: "rgb(255, 154, 158)",
      backgroundImage: "none",
    },
    inlineStyles: { backgroundColor: "#ff9a9e" },
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    sourceId: "hero",
  } as ElementInfo;
}

describe("findFillShader", () => {
  it("finds the shader painted as the node's fill", () => {
    expect(
      findFillShader({ content: withShader("fill"), nodeId: "hero" }),
    ).toMatchObject({ name: "Mesh Gradient" });
  });

  it("is null for an effect, another node, no node, or source it does not hold", () => {
    expect(
      findFillShader({ content: withShader("effect"), nodeId: "hero" }),
    ).toBeNull();
    expect(
      findFillShader({ content: withShader("fill"), nodeId: "other" }),
    ).toBeNull();
    expect(findFillShader({ content: withShader("fill") })).toBeNull();
    expect(findFillShader({ nodeId: "hero" })).toBeNull();
    expect(findFillShader(undefined)).toBeNull();
    expect(findFillShader({ content: BASE, nodeId: "hero" })).toBeNull();
  });
});

describe("FillProperties with a shader fill", () => {
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

  function open(content: string) {
    act(() =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={vi.fn()}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content,
            nodeId: "hero",
          }}
        />,
      ),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Open color picker"]',
        )!
        .click(),
    );
  }

  const shaderPaint = () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Shader"]')!;

  it("opens on the Shader paint with its pane", () => {
    open(withShader("fill"));

    expect(shaderPaint().getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector('[data-testid="shader-pane"]'),
    ).not.toBeNull();
    expect(document.querySelector('input[aria-label="Hex"]')).toBeNull();
  });

  it("opens on the Shader paint when the agent gave the fill a shader after the picker had been used", () => {
    const shaderContext = (content: string) => ({
      designId: "d1",
      fileId: "f1",
      content,
      nodeId: "hero",
    });
    const render = (content: string) =>
      act(() =>
        root.render(
          <FillProperties
            element={element()}
            onStyleChange={vi.fn()}
            glslShaderContext={shaderContext(content)}
          />,
        ),
      );
    const trigger = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open color picker"]',
      )!;

    // The picker is used while the fill has no shader, and closed again.
    render(BASE);
    act(() => trigger().click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="None"]')!.click(),
    );
    act(() => trigger().click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // The agent then gives the same fill a shader.
    render(withShader("fill"));
    act(() => trigger().click());

    expect(shaderPaint().getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector('[data-testid="shader-pane"]'),
    ).not.toBeNull();
  });

  it("removes the shader, not just the color, when the fill row is removed", () => {
    const onStyleChange = vi.fn();
    const onRemoveShaderFill = vi.fn();
    act(() =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={onStyleChange}
          onRemoveShaderFill={onRemoveShaderFill}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content: withShader("fill"),
            nodeId: "hero",
          }}
        />,
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="editPanel.labels.removeLayer"]',
        )!
        .click(),
    );

    expect(onRemoveShaderFill).toHaveBeenCalledTimes(1);
    // Clearing the color alone would leave the shader running.
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it("only clears the color when the fill is not a shader", () => {
    const onStyleChange = vi.fn();
    const onRemoveShaderFill = vi.fn();
    act(() =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={onStyleChange}
          onRemoveShaderFill={onRemoveShaderFill}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content: BASE,
            nodeId: "hero",
          }}
        />,
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="editPanel.labels.removeLayer"]',
        )!
        .click(),
    );

    expect(onRemoveShaderFill).not.toHaveBeenCalled();
    expect(onStyleChange.mock.calls[0]?.slice(0, 2)).toEqual([
      "backgroundColor",
      "transparent",
    ]);
  });

  it("opens on Solid when the fill has no shader", () => {
    open(BASE);

    expect(shaderPaint().getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-testid="shader-pane"]')).toBeNull();
    expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
  });
});
