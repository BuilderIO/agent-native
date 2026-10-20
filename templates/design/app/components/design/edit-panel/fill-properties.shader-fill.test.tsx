// @vitest-environment happy-dom

/**
 * A fill that already has a shader opens its picker on the Shader paint, with
 * the shader's controls in place; a fill without one opens on Solid.
 */

import { applyVisualEdit } from "@shared/code-layer";
import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
  updateNativeInstanceInHtml,
} from "@shared/native-effects";
import {
  applyShaderToHtml,
  newShaderId,
  type GlslShaderMode,
} from "@shared/shader-fills";
import { GLSL_SHADER_PRESETS } from "@shared/shader-presets";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: (...args: unknown[]) => mockCallAction(...args),
  useActionQuery: () => ({ data: undefined, error: null }),
}));

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

vi.mock("../inspector/NativeShaderCatalogPreview", () => ({
  NativeShaderCatalogPreviewProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => children,
  NativeShaderCatalogPreview: () => <div data-native-shader-preview />,
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
const NATIVE_BASE =
  '<html><body><div data-agent-native-node-id="hero" style="background-color:#ff9a9e"></div></body></html>';

function withNativeFill(enabled = true): string {
  const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
    (item) => item.name === "Mesh Gradient",
  );
  if (!definition) throw new Error("Mesh Gradient definition is missing");
  const applied = applyNativeEffectToHtml(NATIVE_BASE, {
    nodeId: "hero",
    definition,
    placement: "fill",
  });
  if (applied.errors.length) throw new Error(applied.errors[0]);
  if (enabled) return applied.html;
  const instanceId = parseEffectsFromHtml(applied.html).document?.instances[0]
    ?.id;
  if (!instanceId) throw new Error("Native fill instance is missing");
  const updated = updateNativeInstanceInHtml(applied.html, instanceId, {
    enabled: false,
  });
  if (updated.errors.length) throw new Error(updated.errors[0]);
  return updated.html;
}

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
    mockCallAction.mockReset();
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
    expect(onStyleChange.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["background", ""],
      ["backgroundColor", ""],
    ]);
  });

  it("keeps each native Fill separate from a CSS Linear overlay and removes only the addressed slot", async () => {
    const gradient = "linear-gradient(180deg, #000000 0%, #666666 100%)";
    const native = withNativeFill();
    const transparent = applyVisualEdit(native, {
      kind: "style",
      target: { nodeId: "hero" },
      property: "background-color",
      value: "transparent",
    });
    expect(transparent.result.status).toBe("applied");
    const overlaid = applyVisualEdit(transparent.content, {
      kind: "style",
      target: { nodeId: "hero" },
      property: "background-image",
      value: gradient,
    });
    expect(overlaid.result.status).toBe("applied");
    const instanceId = parseEffectsFromHtml(overlaid.content).document!
      .instances[0]!.id;
    const onStyleChange = vi.fn();
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({
          content: overlaid.content,
          versionHash: "v1",
        });
      if (name === "edit-native-shader")
        return Promise.resolve({ content: overlaid.content, instanceIds: [] });
      throw new Error(`unexpected action ${name}`);
    });
    await act(async () =>
      root.render(
        <FillProperties
          element={{
            ...element(),
            computedStyles: {
              ...element().computedStyles,
              backgroundColor: "rgba(0, 0, 0, 0)",
              backgroundImage: gradient,
            },
            inlineStyles: {
              backgroundColor: "transparent",
              backgroundImage: gradient,
            },
          }}
          onStyleChange={onStyleChange}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content: overlaid.content,
            nodeId: "hero",
          }}
        />,
      ),
    );
    const nativeRow = container.querySelector(
      `[data-native-fill-id="${instanceId}"]`,
    )!;
    expect(nativeRow.textContent).toContain("100%");
    expect(nativeRow.textContent).toContain(
      "editPanel.shaders.nativeCatalog.definitions.mesh-anchors",
    );
    expect(container.textContent).toContain("Linear");
    await act(async () => {
      nativeRow
        .querySelector<HTMLButtonElement>(
          'button[aria-label="editPanel.labels.removeLayer"]',
        )!
        .click();
      await Promise.resolve();
    });
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toEqual({ kind: "remove", instanceId });
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it("renders two native slots front-to-back and addresses their visibility independently", async () => {
    const first = withNativeFill();
    const secondDefinition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) => item.name === "Gradient Field",
    );
    expect(secondDefinition).toBeDefined();
    const stacked = applyNativeEffectToHtml(first, {
      nodeId: "hero",
      definition: secondDefinition!,
      placement: "fill",
    });
    expect(stacked.errors).toEqual([]);
    const ids = parseEffectsFromHtml(stacked.html).document!.instances.map(
      (instance) => instance.id,
    );
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({ content: stacked.html, versionHash: "v2" });
      if (name === "edit-native-shader")
        return Promise.resolve({ content: stacked.html, instanceIds: ids });
      throw new Error(`unexpected action ${name}`);
    });
    await act(async () =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={vi.fn()}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content: stacked.html,
            nodeId: "hero",
          }}
        />,
      ),
    );
    expect(
      [...container.querySelectorAll("[data-native-fill-id]")].map((row) =>
        row.getAttribute("data-native-fill-id"),
      ),
    ).toEqual([...ids].reverse());
    await act(async () => {
      container
        .querySelector(
          `[data-native-fill-id="${ids[1]}"] button[aria-label="editPanel.labels.hideLayer"]`,
        )!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      mockCallAction.mock.calls.find(
        ([name]) => name === "edit-native-shader",
      )?.[1].operation,
    ).toEqual({
      kind: "set-instance",
      instanceId: ids[1],
      enabled: false,
    });
  });

  it("opens a native Liquid Metal Fill with the shared Solid and Gradient choices", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) => item.id === "an-native-liquid-metal",
    );
    if (!definition) throw new Error("Liquid Metal definition is missing");
    const applied = applyNativeEffectToHtml(NATIVE_BASE, {
      nodeId: "hero",
      definition,
      placement: "fill",
    });
    expect(applied.errors).toEqual([]);
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({
          content: applied.html,
          versionHash: "v-metal",
        });
      if (name === "edit-native-shader")
        return Promise.resolve({ content: applied.html, instanceIds: [] });
      throw new Error(`Unexpected action ${name}`);
    });
    await act(async () =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={vi.fn()}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content: applied.html,
            nodeId: "hero",
          }}
        />,
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-native-fill-id] button")!
        .click(),
    );
    const fill = document.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.shaders.nativeCatalog.properties.fill"]',
    );
    expect(fill).not.toBeNull();
    await act(async () => fill!.click());
    const gradient = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Gradient"]',
    );
    expect(document.querySelector('button[aria-label="Solid"]')).not.toBeNull();
    expect(gradient).not.toBeNull();
    await act(async () => gradient!.click());
    expect(
      document.querySelector('[role="combobox"][aria-label="Type"]'),
    ).not.toBeNull();
    expect(
      document.querySelector(
        'button[aria-label="editPanel.colorPicker.reverseStops"]',
      ),
    ).toBeNull();
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation.params.fill).toMatchObject({
      kind: "linear",
      angle: 180,
    });
    expect(write?.[1].operation.params.fill.stops).toHaveLength(2);
  });

  it("opens + as a new native Fill chooser without first writing a CSS layer", async () => {
    const content = withNativeFill();
    const onStyleChange = vi.fn();
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({ content, versionHash: "v-add" });
      if (name === "edit-native-shader")
        return Promise.resolve({ content, instanceIds: [] });
      throw new Error(`unexpected action ${name}`);
    });
    await act(async () =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={onStyleChange}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content,
            nodeId: "hero",
          }}
        />,
      ),
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="editPanel.labels.addFill"]',
        )!
        .click();
    });
    expect(
      document.querySelector(
        '[data-native-shader-panel="fill"] input[aria-label="editPanel.shaders.searchShaders"]',
      ),
    ).not.toBeNull();
    expect(onStyleChange).not.toHaveBeenCalled();
    expect(mockCallAction).not.toHaveBeenCalled();
    const entry = document.querySelector<HTMLButtonElement>(
      '[data-native-shader-panel="fill"] .grid-cols-2 > button',
    );
    expect(entry).not.toBeNull();
    await act(async () => {
      entry!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    )?.[1];
    expect(write?.expectedVersionHash).toBe("v-add");
    expect(write?.operation).toMatchObject({
      kind: "apply",
      nodeId: "hero",
      placement: "fill",
    });
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it("reorders native Fill slots by their stable instance IDs", async () => {
    const first = withNativeFill();
    const secondDefinition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) => item.name === "Gradient Field",
    )!;
    const stacked = applyNativeEffectToHtml(first, {
      nodeId: "hero",
      definition: secondDefinition,
      placement: "fill",
    });
    expect(stacked.errors).toEqual([]);
    const ids = parseEffectsFromHtml(stacked.html).document!.instances.map(
      (instance) => instance.id,
    );
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({ content: stacked.html, versionHash: "v3" });
      if (name === "edit-native-shader")
        return Promise.resolve({ content: stacked.html, instanceIds: ids });
      throw new Error(`unexpected action ${name}`);
    });
    await act(async () =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={vi.fn()}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content: stacked.html,
            nodeId: "hero",
          }}
        />,
      ),
    );
    const frontRow = container.querySelector(
      `[data-native-fill-id="${ids[1]}"]`,
    )!;
    const backRow = container.querySelector(
      `[data-native-fill-id="${ids[0]}"]`,
    )!;
    const handle = frontRow.querySelector(
      '[aria-label="editPanel.labels.reorderLayer"]',
    )!;
    const start = new Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", {
      value: { setData: vi.fn(), effectAllowed: "" },
    });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { dropEffect: "" } });
    act(() => handle.dispatchEvent(start));
    await act(async () => {
      backRow.dispatchEvent(drop);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      mockCallAction.mock.calls.find(
        ([name]) => name === "edit-native-shader",
      )?.[1].operation,
    ).toEqual({
      kind: "reorder",
      instanceId: ids[1],
      beforeInstanceId: ids[0],
    });
  });

  it("reads a disabled native Fill as 0% even with an opaque CSS fallback", async () => {
    const content = withNativeFill(false);
    const instanceId = parseEffectsFromHtml(content).document!.instances[0]!.id;
    await act(async () =>
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
    const nativeRow = container.querySelector(
      `[data-native-fill-id="${instanceId}"]`,
    )!;
    expect(nativeRow.textContent).toContain("0%");
    expect(
      nativeRow.querySelector('[aria-label="editPanel.labels.showLayer"]'),
    ).not.toBeNull();
  });

  it("toggles only the native instance while preserving the CSS fallback in the same versioned edit", async () => {
    const content = withNativeFill();
    const instanceId = parseEffectsFromHtml(content).document!.instances[0]!.id;
    const onApplied = vi.fn();
    const onStyleChange = vi.fn();
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({ content, versionHash: "version-1" });
      if (name === "edit-native-shader")
        return Promise.resolve({
          content,
          updatedAt: "updated-1",
          instanceIds: [instanceId],
        });
      throw new Error(`unexpected action ${name}`);
    });
    await act(async () =>
      root.render(
        <FillProperties
          element={element()}
          onStyleChange={onStyleChange}
          glslShaderContext={{
            designId: "d1",
            fileId: "f1",
            content,
            nodeId: "hero",
            onApplied,
          }}
        />,
      ),
    );
    await act(async () => {
      container
        .querySelector(
          `[data-native-fill-id="${instanceId}"] button[aria-label="editPanel.labels.hideLayer"]`,
        )!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    )?.[1];
    expect(write?.expectedVersionHash).toBe("version-1");
    expect(write?.operation).toEqual({
      kind: "set-instance",
      instanceId,
      enabled: false,
    });
    expect(onApplied).toHaveBeenCalledWith("f1", content, "updated-1", content);
    expect(onStyleChange).not.toHaveBeenCalled();
  });

  it("opens on Solid when the fill has no shader", () => {
    open(BASE);

    expect(shaderPaint().getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector('[data-testid="shader-pane"]')).toBeNull();
    expect(document.querySelector('input[aria-label="Hex"]')).not.toBeNull();
  });
});
