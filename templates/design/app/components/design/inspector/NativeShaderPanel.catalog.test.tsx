// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());
const mockApprovalQuery = vi.hoisted(() => ({
  data: { approvedDefinitionHashes: [] as string[] },
  error: null,
}));
const mockSendToAgentChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: (...args: unknown[]) => mockSendToAgentChat(...args),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  useActionQuery: () => mockApprovalQuery,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

type NumericSliderHandlers = {
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  onPointerCancel?: () => void;
};
const numericSliders = vi.hoisted(
  () => new Map<string, NumericSliderHandlers>(),
);
vi.mock("@/components/ui/slider", async (original) => {
  const module = await original<typeof import("@/components/ui/slider")>();
  return {
    Slider: (props: React.ComponentProps<typeof module.Slider>) => {
      numericSliders.set(
        String(props["aria-label"]),
        props as NumericSliderHandlers,
      );
      return <module.Slider {...props} />;
    },
  };
});

vi.mock("@/components/ui/switch", () => ({
  Switch: () => null,
}));

vi.mock("../edit-panel/inspector-controls", () => ({
  SectionIconButton: ({
    label,
    disabled,
    onClick,
    children,
  }: {
    label: string;
    disabled?: boolean;
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label="placement"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="layer">layer</option>
      <option value="backdrop">backdrop</option>
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./InspectorControlPopover", () => ({
  InspectorControlPopoverContent: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div>{children}</div>,
}));

vi.mock("./NativeShaderCatalogPreview", () => ({
  NativeShaderCatalogPreviewProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <>{children}</>,
  NativeShaderCatalogPreview: () => <div data-native-shader-preview />,
}));

vi.mock("./NativeShaderColorControls", () => ({
  NativeShaderColorControls: () => <div data-native-shader-color-controls />,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { LIQUID_GLASS_EFFECT } from "@shared/native-effect-liquid-glass-v3";
import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
  updateNativeInstanceInHtml,
} from "@shared/native-effects";

import { runShaderSourceEdit } from "@/pages/design-editor/commands/shader-source-edit";

import { isShaderWriteInFlight } from "./GlslShaderPanel";
import {
  NativeShaderEffectSection,
  NativeShaderPanel,
  NumericField,
} from "./NativeShaderPanel";

describe("NativeShaderPanel catalog", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mockCallAction.mockReset();
    mockApprovalQuery.data = { approvedDefinitionHashes: [] };
    mockCallAction.mockImplementation((name: string) => {
      if (name === "read-source-file")
        return Promise.resolve({ content: "<html></html>", versionHash: "v1" });
      if (name === "edit-native-shader")
        return Promise.resolve({
          content: "<html></html>",
          instanceIds: ["i1"],
        });
      throw new Error(`unexpected action: ${name}`);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each(["fill", "layer"] as const)(
    "prefills native %s creation in the visible agent chat",
    async (placement) => {
      mockSendToAgentChat.mockReset();
      await act(async () =>
        root.render(
          <NativeShaderPanel
            context={{
              designId: "design-1",
              fileId: "file-1",
              nodeId: "node-1",
              selector: "#target",
              content: "<html></html>",
            }}
            placement={placement}
            effectCatalog={placement === "layer"}
          />,
        ),
      );
      const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "editPanel.shaders.createWithAi",
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(mockSendToAgentChat).toHaveBeenCalledOnce();
      const request = mockSendToAgentChat.mock.calls[0]![0];
      expect(request).toMatchObject({
        submit: false,
        openSidebar: true,
        message:
          placement === "fill"
            ? "editPanel.shaders.createNativeFillPrompt"
            : "editPanel.shaders.createNativeEffectPrompt",
      });
      expect(JSON.parse(request.context)).toMatchObject({
        workflow: "native-effects",
        backend: "WebGPU",
        language: "WGSL",
        designId: "design-1",
        fileId: "file-1",
        nodeId: "node-1",
        placement,
      });
      expect(mockCallAction).not.toHaveBeenCalled();
    },
  );

  it("lists a saved custom native shader in its supported picker placement", async () => {
    const custom = {
      ...LIQUID_GLASS_EFFECT,
      id: "custom-painted-glass",
      name: "Painted Glass",
      version: 1,
    };
    const content = `<html><body><div data-agent-native-node-id="node-1"></div><script type="application/x-agent-native-effects">${JSON.stringify({ schemaVersion: 2, definitions: [custom, { ...custom, version: 2 }], instances: [] })}</script></body></html>`;
    const context = {
      designId: "design-1",
      fileId: "file-1",
      nodeId: "node-1",
      content,
    };
    await act(async () =>
      root.render(
        <NativeShaderPanel context={context} placement="layer" effectCatalog />,
      ),
    );
    const entry = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Painted Glass"]',
    );
    expect(entry).not.toBeNull();
    expect(entry!.disabled).toBe(true);
    entry!.click();
    expect(mockCallAction).not.toHaveBeenCalled();
    expect(
      host.querySelectorAll('button[aria-label="Painted Glass"]'),
    ).toHaveLength(1);
    mockApprovalQuery.data = {
      approvedDefinitionHashes: [
        await hashEffectDefinition({ ...custom, version: 2 }),
      ],
    };
    await act(async () =>
      root.render(
        <NativeShaderPanel context={context} placement="layer" effectCatalog />,
      ),
    );
    await vi.waitFor(() => {
      expect(
        host.querySelector<HTMLButtonElement>(
          'button[aria-label="Painted Glass"]',
        )?.disabled,
      ).toBe(false);
    });
    const approvedEntry = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Painted Glass"]',
    );
    await act(async () => {
      approvedEntry!.click();
      await Promise.resolve();
    });
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toMatchObject({
      definitionId: custom.id,
      definitionVersion: 2,
      placement: "backdrop",
    });
    await act(async () =>
      root.render(<NativeShaderPanel context={context} placement="fill" />),
    );
    expect(host.querySelector('button[aria-label="Painted Glass"]')).toBeNull();
  });

  it("previews numeric slider values immediately and restores committed values on cancel or failed save", async () => {
    const onPreview = vi.fn();
    let resolveSave: ((saved: boolean) => void) | undefined;
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await act(async () =>
      root.render(
        <NumericField
          label="Roughness"
          value={0.12}
          min={0}
          max={1}
          step={0.01}
          presentation={{ displayScale: 100, unit: "%", step: 1 }}
          disabled={false}
          onPreview={onPreview}
          onCommit={onCommit}
        />,
      ),
    );
    await act(async () =>
      numericSliders.get("Roughness")!.onValueChange!([45]),
    );
    expect(onPreview).toHaveBeenLastCalledWith(0.45);
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => numericSliders.get("Roughness")!.onPointerCancel!());
    expect(onPreview).toHaveBeenLastCalledWith(0.12);
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Roughness"]')!
        .value,
    ).toBe("12%");
    await act(async () =>
      numericSliders.get("Roughness")!.onValueChange!([65]),
    );
    await act(async () =>
      numericSliders.get("Roughness")!.onValueCommit!([65]),
    );
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.65);
    await act(async () => resolveSave!(false));
    expect(onPreview).toHaveBeenLastCalledWith(0.12);
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Roughness"]')!
        .value,
    ).toBe("12%");
  });

  it("restores an unfinished numeric preview when its property field closes", async () => {
    const onPreview = vi.fn();
    await act(async () =>
      root.render(
        <NumericField
          label="Amount"
          value={0.2}
          min={0}
          max={1}
          disabled={false}
          onPreview={onPreview}
          onCommit={vi.fn()}
        />,
      ),
    );
    await act(async () => numericSliders.get("Amount")!.onValueChange!([0.8]));
    expect(onPreview).toHaveBeenLastCalledWith(0.8);
    await act(async () => root.render(<div />));
    expect(onPreview).toHaveBeenLastCalledWith(0.2);
  });

  it("does not roll back a numeric commit when the field closes before canonical save completes", async () => {
    const onPreview = vi.fn();
    let resolveSave: ((saved: boolean) => void) | undefined;
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    await act(async () =>
      root.render(
        <NumericField
          label="Amount"
          value={0.2}
          min={0}
          max={1}
          disabled={false}
          onPreview={onPreview}
          onCommit={onCommit}
        />,
      ),
    );
    await act(async () => numericSliders.get("Amount")!.onValueChange!([0.8]));
    await act(async () => numericSliders.get("Amount")!.onValueCommit!([0.8]));
    const calls = onPreview.mock.calls.length;
    await act(async () => root.render(<div />));
    await act(async () => resolveSave!(true));
    expect(onPreview).toHaveBeenCalledTimes(calls);
    expect(onPreview).toHaveBeenLastCalledWith(0.8);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.8);
  });

  it("keeps numeric transient previews across callback-only rerenders", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const render = (onPreview: (value: number) => void) =>
      root.render(
        <NumericField
          label="Amount"
          value={0.2}
          min={0}
          max={1}
          disabled={false}
          onPreview={onPreview}
          onCommit={vi.fn()}
        />,
      );
    await act(async () => render(first));
    await act(async () => numericSliders.get("Amount")!.onValueChange!([0.8]));
    await act(async () => render(second));
    expect(first).toHaveBeenCalledExactlyOnceWith(0.8);
    expect(second).not.toHaveBeenCalled();
    await act(async () => root.render(<div />));
    expect(second).toHaveBeenCalledExactlyOnceWith(0.2);
  });

  it("commits typed percentages and keeps the submitted value until the save resolves", async () => {
    let resolveSave: ((saved: boolean) => void) | undefined;
    const onCommit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const render = (value: number) =>
      root.render(
        <NumericField
          label="Roughness"
          value={value}
          min={0}
          max={1}
          step={0.01}
          presentation={{ displayScale: 100, unit: "%", step: 1 }}
          disabled={false}
          onCommit={onCommit}
        />,
      );
    await act(async () => render(0.12));
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Roughness"]',
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe("12%");

    await act(async () => {
      input!.focus();
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "1");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.01);
    expect(input!.value).toBe("1%");
    await act(async () => render(0.12));
    expect(input!.value).toBe("1%");

    await act(async () => {
      resolveSave?.(true);
    });
    expect(input!.value).toBe("1%");
    await act(async () => render(0.01));
    expect(input!.value).toBe("1%");
  });

  it("restores the previous value when a numeric save fails", async () => {
    let resolveSave: ((saved: boolean) => void) | undefined;
    await act(async () =>
      root.render(
        <NumericField
          label="Roughness"
          value={0.12}
          min={0}
          max={1}
          step={0.01}
          presentation={{ displayScale: 100, unit: "%", step: 1 }}
          disabled={false}
          onCommit={() =>
            new Promise<boolean>((resolve) => {
              resolveSave = resolve;
            })
          }
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Roughness"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      input!.focus();
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "1");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(input!.value).toBe("1%");
    await act(async () => {
      resolveSave?.(false);
    });
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="Roughness"]')
        ?.value,
    ).toBe("12%");
  });

  it("shows one fill entry per definition and applies MeshGradient by definition", async () => {
    const context = {
      designId: "design-1",
      fileId: "file-1",
      content: "<html></html>",
      nodeId: "node-1",
      selector: "#target",
      onApplied: vi.fn(),
    };

    await act(async () => {
      root.render(<NativeShaderPanel context={context} placement="fill" />);
    });

    const fillDefinitions = NATIVE_EFFECT_LATEST_DEFINITIONS.filter((item) =>
      item.placements.includes("fill"),
    );
    const entries = host.querySelectorAll(
      '[data-native-shader-panel="fill"] .grid-cols-2 > button',
    );
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((item) => item.id)).size,
    ).toBe(NATIVE_EFFECT_LATEST_DEFINITIONS.length);
    expect(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter((item) =>
        [
          "an-native-liquid-metal",
          "an-native-fluted-glass",
          "an-native-image-dithering",
          "an-native-waves",
          "an-native-nebula",
          "an-native-glowing-waves",
        ].includes(item.id),
      ).map((item) => item.id),
    ).toEqual([
      "an-native-liquid-metal",
      "an-native-fluted-glass",
      "an-native-image-dithering",
      "an-native-waves",
      "an-native-nebula",
      "an-native-glowing-waves",
    ]);
    expect(entries).toHaveLength(fillDefinitions.length);
    expect(host.querySelectorAll("[data-native-shader-preview]")).toHaveLength(
      fillDefinitions.length,
    );
    expect(host.textContent).not.toMatch(/Dawn Silk|Lagoon Veil|Amethyst Fog/);

    const meshGradient = fillDefinitions.find(
      (item) => item.name === "Mesh Gradient",
    );
    expect(meshGradient).toBeDefined();
    const meshIndex = fillDefinitions.indexOf(meshGradient!);
    const meshButton = entries.item(meshIndex) as HTMLButtonElement | null;
    expect(meshButton).toBeDefined();

    await act(async () => {
      meshButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toEqual({
      kind: "apply",
      nodeId: "node-1",
      targetSelector: "#target",
      placement: "fill",
      definitionId: meshGradient!.id,
      definitionVersion: meshGradient!.version,
    });
  });

  it("shows only properties for an existing selected Fill shader", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) =>
        item.name === "Mesh Gradient" && item.placements.includes("fill"),
    );
    expect(definition).toBeDefined();
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>',
      { nodeId: "node-1", definition: definition!, placement: "fill" },
    );
    expect(applied.errors).toEqual([]);

    await act(async () => {
      root.render(
        <NativeShaderPanel
          context={{
            designId: "design-1",
            fileId: "file-1",
            content: applied.html,
            nodeId: "node-1",
          }}
          placement="fill"
        />,
      );
    });

    expect(
      host.querySelector('[data-native-shader-panel="fill"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('input[aria-label="editPanel.shaders.searchShaders"]'),
    ).toBeNull();
    expect(
      host.querySelectorAll(
        '[data-native-shader-panel="fill"] .grid-cols-2 > button',
      ),
    ).toHaveLength(0);
    expect(
      host.querySelector("[data-native-shader-color-controls]"),
    ).not.toBeNull();
  });

  it("opens an empty Fill chooser for a new slot on a layer with an existing native Fill", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) =>
        item.name === "Mesh Gradient" && item.placements.includes("fill"),
    )!;
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>',
      { nodeId: "node-1", definition, placement: "fill" },
    );
    expect(applied.errors).toEqual([]);
    await act(async () =>
      root.render(
        <NativeShaderPanel
          context={{
            designId: "design-1",
            fileId: "file-1",
            content: applied.html,
            nodeId: "node-1",
          }}
          placement="fill"
          catalogOnly
        />,
      ),
    );
    expect(
      host.querySelector('input[aria-label="editPanel.shaders.searchShaders"]'),
    ).not.toBeNull();
    expect(
      host.querySelectorAll(
        '[data-native-shader-panel="fill"] .grid-cols-2 > button',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      host.querySelector("[data-native-shader-color-controls]"),
    ).toBeNull();
  });

  it("shows one Effects catalog including Backdrop-only definitions and applies a Layer definition", async () => {
    const context = {
      designId: "design-1",
      fileId: "file-1",
      content: "<html></html>",
      nodeId: "node-1",
      selector: "#target",
      onApplied: vi.fn(),
    };

    await act(async () => {
      root.render(
        <NativeShaderEffectSection
          context={context}
          pickerOpen
          onPickerOpenChange={vi.fn()}
        />,
      );
    });

    const layerDefinitions = NATIVE_EFFECT_LATEST_DEFINITIONS.filter((item) =>
      item.placements.includes("layer"),
    );
    const entries = host.querySelectorAll(
      '[data-native-shader-panel="layer"] .grid-cols-2 > button',
    );
    const labels = [...entries].map((button) => button.textContent);
    expect(layerDefinitions.length).toBeGreaterThan(0);
    expect(entries).toHaveLength(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
        (item) =>
          item.placements.includes("layer") ||
          item.placements.includes("backdrop"),
      ).length,
    );
    expect(new Set(labels).size).toBe(entries.length);
    expect(
      host.querySelector('[data-native-shader-panel="backdrop"]'),
    ).toBeNull();

    await act(async () => {
      (entries[0] as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toMatchObject({
      kind: "apply",
      placement: "layer",
      definitionId: layerDefinitions[0].id,
      definitionVersion: layerDefinitions[0].version,
    });
    expect(write?.[1].operation).not.toHaveProperty("presetId");
  });

  it("applies an Effects catalog definition through the editor-owned board source", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find((item) =>
      item.placements.includes("layer"),
    )!;
    let board =
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>';
    const editSource = vi.fn(
      (transform: (html: string) => { html: string; errors: string[] }) =>
        runShaderSourceEdit(
          {
            getScreenContent: () => board,
            applyFileContentUpdate: (_fileId, content) => {
              if (isShaderWriteInFlight("board-file"))
                return { status: "refused" };
              board = content;
              return { status: "accepted" };
            },
            saveFailedMessage: "Could not save the shader",
          },
          "board-file",
          transform,
        ),
    );

    await act(async () => {
      root.render(
        <NativeShaderEffectSection
          context={{
            designId: "design-1",
            fileId: "board-file",
            content: board,
            nodeId: "node-1",
            editSource,
          }}
          pickerOpen
          onPickerOpenChange={vi.fn()}
        />,
      );
    });

    const entry = host.querySelector<HTMLButtonElement>(
      '[data-native-shader-panel="layer"] .grid-cols-2 > button',
    );
    expect(entry).not.toBeNull();
    await act(async () => {
      entry!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const parsed = parseEffectsFromHtml(board);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "node-1",
          definitionId: definition.id,
          placement: "layer",
        }),
      ]),
    );
    expect(editSource).toHaveBeenCalledTimes(1);
    expect(mockCallAction).not.toHaveBeenCalled();
  });

  it("applies Liquid Glass from the shared Effects catalog as Backdrop on an SVG", async () => {
    await act(async () => {
      root.render(
        <NativeShaderEffectSection
          context={{
            designId: "design-1",
            fileId: "file-1",
            content:
              '<html><body><svg data-agent-native-node-id="logo"><path d="M0 0h10v10H0z"/></svg></body></html>',
            nodeId: "logo",
          }}
          pickerOpen
          onPickerOpenChange={vi.fn()}
        />,
      );
    });
    const glass = [
      ...host.querySelectorAll<HTMLButtonElement>(".grid-cols-2 > button"),
    ].find((button) =>
      button.getAttribute("aria-label")?.endsWith("liquid-glass"),
    );
    expect(glass).toBeDefined();
    await act(async () => glass!.click());
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toEqual({
      kind: "apply",
      nodeId: "logo",
      targetSelector: undefined,
      placement: "backdrop",
      definitionId: LIQUID_GLASS_EFFECT.id,
      definitionVersion: 3,
    });
  });

  it("keeps Liquid Glass available beside an existing Layer effect", async () => {
    const layer = NATIVE_EFFECT_LATEST_DEFINITIONS.find((definition) =>
      definition.placements.includes("layer"),
    )!;
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>',
      { nodeId: "node-1", definition: layer, placement: "layer" },
    );
    expect(applied.errors).toEqual([]);
    await act(async () => {
      root.render(
        <NativeShaderEffectSection
          context={{
            designId: "design-1",
            fileId: "file-1",
            content: applied.html,
            nodeId: "node-1",
          }}
          pickerOpen
          onPickerOpenChange={vi.fn()}
        />,
      );
    });
    const entries = host.querySelectorAll<HTMLButtonElement>(
      ".grid-cols-2 > button",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].getAttribute("aria-label")).toMatch(/liquid-glass$/);
    await act(async () => entries[0].click());
    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toMatchObject({
      kind: "apply",
      placement: "backdrop",
      definitionId: LIQUID_GLASS_EFFECT.id,
    });
  });

  it("uses shared property controls for saved Liquid Glass without placement or animation controls", async () => {
    const applied = applyNativeEffectToHtml(
      '<html><body><svg data-agent-native-node-id="logo"><path d="M0 0h10v10H0z"/></svg></body></html>',
      {
        nodeId: "logo",
        definition: LIQUID_GLASS_EFFECT,
        placement: "backdrop",
      },
    );
    expect(applied.errors).toEqual([]);
    await act(async () => {
      root.render(
        <NativeShaderPanel
          context={{
            designId: "design-1",
            fileId: "file-1",
            content: applied.html,
            nodeId: "logo",
          }}
          placement="backdrop"
          showCatalog={false}
        />,
      );
    });
    expect(host.querySelector("select[aria-label='placement']")).toBeNull();
    expect(
      host.querySelector('input[aria-label="editPanel.shaders.speed"]'),
    ).toBeNull();
    expect(
      host.querySelector("[data-native-shader-color-controls]"),
    ).not.toBeNull();
    expect(
      host.querySelector('input[aria-label="editPanel.labels.opacity"]'),
    ).not.toBeNull();
    expect(
      host.querySelector(
        'input[aria-label="editPanel.shaders.nativeCatalog.properties.thickness"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector('input[aria-label="editPanel.shaders.searchShaders"]'),
    ).toBeNull();
    expect(host.textContent).not.toMatch(/preset|radius/i);
  });

  it("keeps placement editing for an existing Backdrop effect", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) =>
        item.placements.includes("layer") &&
        item.placements.includes("backdrop"),
    );
    expect(definition).toBeDefined();
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>',
      { nodeId: "node-1", definition: definition!, placement: "backdrop" },
    );
    expect(applied.errors).toEqual([]);

    const context = {
      designId: "design-1",
      fileId: "file-1",
      content: applied.html,
      nodeId: "node-1",
      onApplied: vi.fn(),
    };
    await act(async () => {
      root.render(
        <NativeShaderEffectSection
          context={context}
          pickerOpen
          onPickerOpenChange={vi.fn()}
        />,
      );
    });

    expect(
      host.querySelectorAll(
        '[data-native-shader-panel="layer"] .grid-cols-2 > button',
      ),
    ).toHaveLength(
      NATIVE_EFFECT_LATEST_DEFINITIONS.filter(
        (item) =>
          item.placements.includes("layer") ||
          item.placements.includes("backdrop"),
      ).length,
    );
    const placement = host.querySelector("select[aria-label='placement']");
    expect(placement).toBeDefined();

    await act(async () => {
      Object.defineProperty(placement, "value", {
        value: "layer",
        configurable: true,
      });
      placement!.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toMatchObject({
      kind: "set-instance",
      placement: "layer",
    });
  });

  it("shows a saved disabled Backdrop effect with an outer Eye that enables it", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) => item.name === "Frosted Refraction",
    );
    expect(definition).toBeDefined();
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>',
      { nodeId: "node-1", definition: definition!, placement: "backdrop" },
    );
    expect(applied.errors).toEqual([]);
    const instanceId = parseEffectsFromHtml(applied.html).document!.instances[0]
      .id;
    const disabled = updateNativeInstanceInHtml(applied.html, instanceId, {
      enabled: false,
    });
    expect(disabled.errors).toEqual([]);
    const context = {
      designId: "design-1",
      fileId: "file-1",
      content: disabled.html,
      nodeId: "node-1",
      onApplied: vi.fn(),
    };

    await act(async () => {
      root.render(
        <NativeShaderEffectSection
          context={context}
          pickerOpen={false}
          onPickerOpenChange={vi.fn()}
        />,
      );
    });

    expect(host.textContent).toContain(
      "editPanel.shaders.nativeCatalog.definitions.frosted-refraction",
    );
    const show = host.querySelector<HTMLButtonElement>(
      '[aria-label="editPanel.labels.showLayer"]',
    );
    expect(show).not.toBeNull();
    expect(
      host.querySelector('[aria-label="editPanel.shaders.enabled"]'),
    ).toBeNull();
    await act(async () => {
      show!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const write = mockCallAction.mock.calls.find(
      ([name]) => name === "edit-native-shader",
    );
    expect(write?.[1].operation).toEqual({
      kind: "set-instance",
      instanceId,
      enabled: true,
    });
  });

  it("shows existing effect controls without a create catalog", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (item) =>
        item.name === "Frosted Refraction" &&
        item.placements.includes("layer") &&
        item.placements.includes("backdrop"),
    );
    expect(definition).toBeDefined();
    const applied = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="node-1"></div></body></html>',
      { nodeId: "node-1", definition: definition!, placement: "backdrop" },
    );
    expect(applied.errors).toEqual([]);

    await act(async () => {
      root.render(
        <NativeShaderPanel
          context={{
            designId: "design-1",
            fileId: "file-1",
            content: applied.html,
            nodeId: "node-1",
          }}
          placement="backdrop"
          showCatalog={false}
        />,
      );
    });

    expect(
      host.querySelector('input[aria-label="editPanel.shaders.searchShaders"]'),
    ).toBeNull();
    expect(
      host.querySelector('[data-native-shader-panel="backdrop"]'),
    ).not.toBeNull();
    expect(host.querySelector("select[aria-label='placement']")).not.toBeNull();
    expect(
      host.querySelector('input[aria-label="editPanel.shaders.speed"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="editPanel.shaders.enabled"]'),
    ).toBeNull();
    expect(host.textContent).not.toContain("editPanel.shaders.pause");
    expect(host.textContent).not.toContain("editPanel.shaders.play");
  });
});
