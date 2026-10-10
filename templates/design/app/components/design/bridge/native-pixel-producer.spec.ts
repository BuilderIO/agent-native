// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { nativeShaderRuntimeBridgeScript } from "../../../../.generated/bridge/native-shader-runtime.generated";
import { OWNED_PROCESSOR_DEFINITIONS } from "../../../../shared/native-effect-owned-processors";
import {
  GRAIN_GRADIENT_EFFECT,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
} from "../../../../shared/native-effect-presets";
import { planNativeSourceAffine } from "./native-source-affine-geometry";
import { createNativeSceneProvider } from "./native-source-provider";

type PixelRuntime = {
  scan(): Promise<void>;
  pause(): void;
  renderAt(time: number): Promise<unknown>;
  setParameters(
    instanceId: string,
    params: Record<string, unknown>,
  ): Promise<void>;
  setTime(time: number): Promise<void>;
  previewStatus(): {
    requestedQuality: string;
    frameRateTarget: number;
    devicePixelRatio: number;
    effectivePixelRatio: number;
  };
  requestStatusSnapshot(): void;
  compositionSceneDiagnostic(): {
    stage: "not-captured" | "scene-read";
    viewport: { width: number; height: number };
  };
  renderCompositionFramePixels(options: {
    frameIndex: number;
    fps: number;
    viewport: { width: number; height: number };
    pixelRatio: number;
    sourceContract: "declarative-only";
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{
    width: number;
    height: number;
    colorSpace: string;
    alpha: string;
    rgba: Uint8Array;
  }>;
  renderCompositionFrameGolden(
    options: {
      frameIndex: number;
      fps: number;
      viewport: { width: number; height: number };
      pixelRatio: number;
      sourceContract: "declarative-only";
    },
    target: {
      instanceId: string;
      nodeId: string;
      expectedLinearSamples: readonly {
        x: number;
        y: number;
        expected: readonly [number, number, number, number];
        tolerance: number;
      }[];
    },
  ): Promise<{
    pixels: { width: number; height: number; rgba: Uint8Array };
    linearGolden: { sampleCount: number; maxAbsError: number; passed: boolean };
  }>;
  renderCompositionFrameValidated(
    options: {
      frameIndex: number;
      fps: number;
      viewport: { width: number; height: number };
      pixelRatio: number;
      sourceContract: "declarative-only";
    },
    target: {
      instanceId: string;
      nodeId: string;
      definitionId: string;
      definitionVersion: number;
      executionHash: string;
    },
  ): Promise<{
    pixels: { width: number; height: number; rgba: Uint8Array };
    mountOutput: {
      instanceId: string;
      width: number;
      height: number;
      nonTransparentPixels: number;
      nonZeroRgbaPixels: number;
    };
  }>;
  renderCompositionVectorFrame<T>(
    options: {
      frameIndex: number;
      fps: number;
      viewport: { width: number; height: number };
      pixelRatio: number;
      sourceContract: "declarative-only";
      signal?: AbortSignal;
      timeoutMs?: number;
    },
    consume: (frame: {
      document: Document;
      pixels: { width: number; height: number; rgba: Uint8Array };
      runtimeCanvases: readonly HTMLCanvasElement[];
      viewport: { width: number; height: number };
      pixelRatio: number;
      signal: AbortSignal;
    }) => Promise<T>,
  ): Promise<T>;
  renderCompositionFrame(options: {
    frameIndex: number;
    fps: number;
    sourceContract: "declarative-only";
  }): Promise<unknown>;
  resetDevice(): Promise<void>;
  setColorMode(mode: "srgb" | "display-p3"): Promise<{
    requested: string;
    presented: string;
    reason?: string;
    sourceGamut: string;
    hdr: string;
  }>;
  colorCapability(): {
    requestedDynamicRange?: string;
    presentedDynamicRange?: string;
    dynamicRangeReason?: string;
  };
  dispose(): void;
};

type FakeGpuState = {
  textures: {
    width: number;
    height: number;
    format: string;
    usage: number;
    destroy: ReturnType<typeof vi.fn>;
  }[];
  buffers: { destroy: ReturnType<typeof vi.fn> }[];
  submitted: number;
  copied: number;
  scopePops: number;
  mapped: number;
  canvasWidths: number[];
  shaderCodes: string[];
  uniformWrites: number[][];
  scissors: number[][];
  renderPasses: Array<{ target: unknown; reads: unknown[]; shader: string }>;
};

const original = {
  gpu: Object.getOwnPropertyDescriptor(navigator, "gpu"),
  fonts: Object.getOwnPropertyDescriptor(document, "fonts"),
  animations: Object.getOwnPropertyDescriptor(document, "getAnimations"),
  currentScript: Object.getOwnPropertyDescriptor(document, "currentScript"),
  elementAnimations: Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getAnimations",
  ),
  resize: globalThis.ResizeObserver,
  canvasContext: HTMLCanvasElement.prototype.getContext,
  innerWidth: Object.getOwnPropertyDescriptor(window, "innerWidth"),
  innerHeight: Object.getOwnPropertyDescriptor(window, "innerHeight"),
  devicePixelRatio: Object.getOwnPropertyDescriptor(window, "devicePixelRatio"),
  matchMedia: Object.getOwnPropertyDescriptor(window, "matchMedia"),
  rootWidth: Object.getOwnPropertyDescriptor(
    document.documentElement,
    "offsetWidth",
  ),
  rootHeight: Object.getOwnPropertyDescriptor(
    document.documentElement,
    "offsetHeight",
  ),
  bodyWidth: Object.getOwnPropertyDescriptor(document.body, "offsetWidth"),
  bodyHeight: Object.getOwnPropertyDescriptor(document.body, "offsetHeight"),
  canvasOffsetWidth: Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "offsetWidth",
  ),
  canvasOffsetHeight: Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "offsetHeight",
  ),
  textureUsage: Object.getOwnPropertyDescriptor(globalThis, "GPUTextureUsage"),
  bufferUsage: Object.getOwnPropertyDescriptor(globalThis, "GPUBufferUsage"),
  mapMode: Object.getOwnPropertyDescriptor(globalThis, "GPUMapMode"),
  shaderStage: Object.getOwnPropertyDescriptor(globalThis, "GPUShaderStage"),
};
let runtime: PixelRuntime | undefined;
let p3Supported = false;
let completeCanvasConfiguration = false;
let toneMappingStandard:
  | "observed"
  | "member-not-observed"
  | "unreadable"
  | undefined;

function restoreProperty(
  object: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

afterEach(() => {
  runtime?.dispose();
  runtime = undefined;
  document.head.replaceChildren();
  document.body.replaceChildren();
  restoreProperty(navigator, "gpu", original.gpu);
  restoreProperty(document, "fonts", original.fonts);
  restoreProperty(document, "getAnimations", original.animations);
  restoreProperty(document, "currentScript", original.currentScript);
  restoreProperty(
    Element.prototype,
    "getAnimations",
    original.elementAnimations,
  );
  restoreProperty(globalThis, "GPUTextureUsage", original.textureUsage);
  restoreProperty(globalThis, "GPUBufferUsage", original.bufferUsage);
  restoreProperty(globalThis, "GPUMapMode", original.mapMode);
  restoreProperty(globalThis, "GPUShaderStage", original.shaderStage);
  globalThis.ResizeObserver = original.resize;
  HTMLCanvasElement.prototype.getContext = original.canvasContext;
  restoreProperty(window, "innerWidth", original.innerWidth);
  restoreProperty(window, "innerHeight", original.innerHeight);
  restoreProperty(window, "devicePixelRatio", original.devicePixelRatio);
  restoreProperty(window, "matchMedia", original.matchMedia);
  restoreProperty(document.documentElement, "offsetWidth", original.rootWidth);
  restoreProperty(
    document.documentElement,
    "offsetHeight",
    original.rootHeight,
  );
  restoreProperty(document.body, "offsetWidth", original.bodyWidth);
  restoreProperty(document.body, "offsetHeight", original.bodyHeight);
  restoreProperty(
    HTMLCanvasElement.prototype,
    "offsetWidth",
    original.canvasOffsetWidth,
  );
  restoreProperty(
    HTMLCanvasElement.prototype,
    "offsetHeight",
    original.canvasOffsetHeight,
  );
  vi.restoreAllMocks();
  p3Supported = false;
  completeCanvasConfiguration = false;
  toneMappingStandard = undefined;
});

describe("direct presentation during an unrelated backdrop failure", () => {
  it("keeps a successfully presented Fill ready when its sibling Backdrop fails before scene commit", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const fillTarget = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !fillTarget)
      throw new Error("Native fixture unavailable.");
    const sibling = document.createElement("div");
    sibling.setAttribute("data-agent-native-node-id", "failing-sibling");
    Object.defineProperties(sibling, {
      offsetWidth: { configurable: true, value: 2 },
      offsetHeight: { configurable: true, value: 2 },
    });
    document.body.append(sibling);
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Backdrop processor unavailable.");
    source.definitions.push(processor);
    const originalFill = source.instances[0]!;
    source.instances = [
      originalFill,
      {
        ...originalFill,
        id: "failing-sibling-backdrop",
        nodeId: "failing-sibling",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
      },
    ];
    manifest.textContent = JSON.stringify(source);
    const internals = active as unknown as {
      renderMount(...args: unknown[]): Promise<void>;
      scenePresentation: unknown;
      mounts: Map<
        string,
        {
          canvas: HTMLCanvasElement;
          reportedStatus: { status: string } | null;
        }
      >;
    };
    const originalRender = internals.renderMount.bind(internals);
    const failingBackdrop = vi
      .spyOn(internals, "renderMount")
      .mockImplementation(async (...args) => {
        if (
          (args[0] as { instance?: { id?: string } }).instance?.id ===
          "failing-sibling-backdrop"
        )
          throw new Error("sibling backdrop unavailable");
        await originalRender(...args);
      });
    await active.scan();
    await expect(active.renderAt(0)).rejects.toThrow(
      "sibling backdrop unavailable",
    );
    const fill = internals.mounts.get(String(originalFill.id));
    expect(internals.scenePresentation).toBeNull();
    expect(fill?.canvas.style.visibility).toBe("visible");
    expect(fill?.reportedStatus?.status).toBe("ready");
    expect(fillTarget.getAttribute("data-an-native-status")).toBe("ready");
    failingBackdrop.mockRestore();
  });
});

function fakeGpu(
  options: {
    validationError?: boolean;
    mapError?: boolean;
    waitForAbort?: boolean;
    holdPreviewRestore?: boolean;
    p3Supported?: boolean;
    toneMappingStandard?: "observed" | "member-not-observed" | "unreadable";
    linearSampleBits?: readonly number[];
    mountedReadbackZero?: boolean;
    completeCanvasConfiguration?: boolean;
    assertNoTextureAlias?: boolean;
  } = {},
): {
  state: FakeGpuState;
  mapStarted: Promise<void>;
  previewRestoreEntered: Promise<void>;
  releasePreviewRestore: () => void;
} {
  p3Supported = !!options.p3Supported;
  completeCanvasConfiguration = !!options.completeCanvasConfiguration;
  toneMappingStandard = options.toneMappingStandard;
  const state: FakeGpuState = {
    textures: [],
    buffers: [],
    submitted: 0,
    copied: 0,
    scopePops: 0,
    mapped: 0,
    canvasWidths: [],
    shaderCodes: [],
    uniformWrites: [],
    scissors: [],
    renderPasses: [],
  };
  let notifyMap!: () => void;
  const mapStarted = new Promise<void>((resolve) => {
    notifyMap = resolve;
  });
  let notifyPreviewRestore!: () => void;
  let releasePreviewRestore!: () => void;
  const previewRestoreEntered = new Promise<void>((resolve) => {
    notifyPreviewRestore = resolve;
  });
  const previewRestoreGate = new Promise<void>((resolve) => {
    releasePreviewRestore = resolve;
  });
  let pendingMapReject: ((error: Error) => void) | undefined;
  const device = {
    features: new Set<string>(),
    lost: new Promise(() => {}),
    queue: {
      writeTexture() {},
      writeBuffer(_buffer: unknown, _offset: number, data: ArrayBufferView) {
        if (data instanceof Float32Array)
          state.uniformWrites.push(Array.from(data));
      },
      copyExternalImageToTexture() {},
      onSubmittedWorkDone: async () => {},
      submit() {
        state.submitted += 1;
        state.canvasWidths.push(
          document.querySelector<HTMLCanvasElement>(
            "canvas[data-an-native-canvas]",
          )?.width ?? 0,
        );
      },
    },
    createSampler: () => ({}),
    createTexture({
      size,
      format,
      usage,
    }: {
      size: number[];
      format: string;
      usage: number;
    }) {
      const texture = {
        width: size[0],
        height: size[1],
        format,
        usage,
        createView: (): { texture: unknown } => ({ texture }),
        destroy: vi.fn(),
      };
      state.textures.push(texture);
      return texture;
    },
    createBuffer({ usage, size }: { usage: number; size: number }) {
      const isReadback = (usage & 1) !== 0;
      const pixels = new Uint8Array(size);
      if (isReadback) {
        if (
          size >= 264 &&
          !(options.mountedReadbackZero && state.buffers.length > 0)
        ) {
          pixels.set([10, 20, 30, 255, 40, 50, 60, 128], 0);
          pixels.set([70, 80, 90, 64, 100, 110, 120, 0], 256);
        }
        if (size === 256 && options.linearSampleBits) {
          const view = new DataView(pixels.buffer);
          options.linearSampleBits.forEach((bits, channel) =>
            view.setUint16(channel * 2, bits, true),
          );
        }
      }
      const buffer = {
        destroy: vi.fn(() => {
          pendingMapReject?.(new Error("Mapped buffer was cancelled."));
        }),
        unmap: vi.fn(),
        getMappedRange: () => pixels.buffer,
        mapAsync: () => {
          state.mapped += 1;
          notifyMap();
          if (options.mapError)
            return Promise.reject(new Error("GPU map failed"));
          if (options.waitForAbort)
            return new Promise<void>((_resolve, reject) => {
              pendingMapReject = reject;
            });
          return Promise.resolve();
        },
      };
      if (isReadback) state.buffers.push(buffer);
      return buffer;
    },
    createShaderModule({ code }: { code: string }) {
      state.shaderCodes.push(code);
      return { code, getCompilationInfo: async () => ({ messages: [] }) };
    },
    createBindGroupLayout: ({
      entries,
    }: {
      entries: { binding: number }[];
    }) => ({ entries }),
    createPipelineLayout: ({
      bindGroupLayouts,
    }: {
      bindGroupLayouts: { entries: { binding: number }[] }[];
    }) => ({ bindGroupLayouts }),
    createRenderPipelineAsync: async ({
      layout,
      fragment,
    }: {
      layout:
        | "auto"
        | { bindGroupLayouts: { entries: { binding: number }[] }[] };
      fragment?: { module?: { code?: string } };
    }) => ({
      shader: fragment?.module?.code ?? "",
      getBindGroupLayout: (index: number) =>
        layout === "auto" ? {} : layout.bindGroupLayouts[index],
    }),
    createBindGroup: ({
      layout,
      entries,
    }: {
      layout: { entries?: { binding: number }[] };
      entries: { binding: number; resource: unknown }[];
    }) => {
      if (layout.entries) {
        expect(entries.map((entry) => entry.binding).sort()).toEqual(
          layout.entries.map((entry) => entry.binding).sort(),
        );
        expect(
          entries.every(
            (entry) => entry.resource !== undefined && entry.resource !== null,
          ),
        ).toBe(true);
      }
      return {
        reads: entries.flatMap(({ resource }) =>
          resource && typeof resource === "object" && "texture" in resource
            ? [resource.texture]
            : [],
        ),
      };
    },
    createCommandEncoder: () => ({
      beginRenderPass: (descriptor: {
        colorAttachments: Array<{ view?: { texture?: unknown } }>;
      }) => {
        const pass = {
          target: descriptor.colorAttachments[0]?.view?.texture,
          reads: [] as unknown[],
          shader: "",
        };
        return {
          setPipeline(pipeline: { shader?: string }) {
            pass.shader = pipeline.shader ?? "";
          },
          setBindGroup(_index: number, group: { reads?: unknown[] }) {
            pass.reads = group.reads ?? [];
          },
          setScissorRect(...rect: number[]) {
            state.scissors.push(rect);
          },
          draw() {
            if (
              options.assertNoTextureAlias &&
              pass.reads.includes(pass.target)
            )
              throw new Error("Fake GPU read/write texture alias");
            state.renderPasses.push({ ...pass, reads: [...pass.reads] });
          },
          end() {},
        };
      },
      copyTextureToBuffer() {
        state.copied += 1;
      },
      finish: () => ({}),
    }),
    pushErrorScope() {},
    async popErrorScope() {
      state.scopePops += 1;
      if (
        options.holdPreviewRestore &&
        state.canvasWidths.includes(4) &&
        state.canvasWidths[state.canvasWidths.length - 1] === 2
      ) {
        notifyPreviewRestore();
        await previewRestoreGate;
      }
      return options.validationError
        ? { message: "Fake GPU validation failure" }
        : null;
    },
    destroy() {},
  };
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: {
      requestAdapter: async () => ({
        features: new Set<string>(),
        requestDevice: async () => device,
      }),
      getPreferredCanvasFormat: () => "rgba8unorm",
    },
  });
  return {
    state,
    mapStarted,
    previewRestoreEntered,
    releasePreviewRestore,
  };
}

async function startRuntime(
  withEffect = false,
  preview?: {
    quality: "auto" | "performance" | "quality";
    frameRateTarget: 60 | 120;
    colorMode?: "srgb" | "display-p3";
    dynamicRange?: "sdr" | "hdr";
  },
  exportInitialPixelRatio?: string,
): Promise<PixelRuntime> {
  for (const element of [document.documentElement, document.body]) {
    Object.defineProperty(element, "offsetWidth", {
      configurable: true,
      value: 2,
    });
    Object.defineProperty(element, "offsetHeight", {
      configurable: true,
      value: 2,
    });
  }
  Object.defineProperty(HTMLCanvasElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLCanvasElement) {
      return this.hasAttribute("data-an-native-canvas") ? 2 : 0;
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLCanvasElement) {
      return this.hasAttribute("data-an-native-canvas") ? 2 : 0;
    },
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 2 });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 2,
  });
  Object.defineProperty(globalThis, "GPUTextureUsage", {
    configurable: true,
    value: {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      RENDER_ATTACHMENT: 16,
    },
  });
  Object.defineProperty(globalThis, "GPUBufferUsage", {
    configurable: true,
    value: { MAP_READ: 1, COPY_DST: 8, UNIFORM: 64 },
  });
  Object.defineProperty(globalThis, "GPUMapMode", {
    configurable: true,
    value: { READ: 1 },
  });
  Object.defineProperty(globalThis, "GPUShaderStage", {
    configurable: true,
    value: { VERTEX: 1, FRAGMENT: 2 },
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      status: "loaded",
      [Symbol.iterator]: function* () {},
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(document, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = function (kind: string) {
    if (kind === "2d")
      return {
        clearRect() {},
        drawImage() {},
        save() {},
        restore() {},
        scale() {},
        fillText() {},
        measureText: () => ({
          actualBoundingBoxAscent: 1,
          actualBoundingBoxDescent: 0,
        }),
      } as unknown as CanvasRenderingContext2D;
    if (kind !== "webgpu") return null;
    let colorSpace = "srgb";
    let format = "rgba8unorm";
    let alphaMode = "premultiplied";
    let standardRequested = false;
    return {
      configure(configuration: {
        format?: string;
        alphaMode?: string;
        colorSpace?: string;
        toneMapping?: { mode: string };
      }) {
        format = configuration.format ?? format;
        alphaMode = configuration.alphaMode ?? alphaMode;
        if (configuration.toneMapping && toneMappingStandard === "unreadable")
          throw new Error("Canvas tone mapping cannot be configured.");
        standardRequested = configuration.toneMapping?.mode === "standard";
        colorSpace =
          configuration.colorSpace === "display-p3" && p3Supported
            ? "display-p3"
            : "srgb";
      },
      unconfigure() {},
      getConfiguration: () => ({
        ...(completeCanvasConfiguration ? { format, alphaMode } : {}),
        colorSpace,
        ...(standardRequested && toneMappingStandard === "observed"
          ? { toneMapping: { mode: "standard" } }
          : {}),
      }),
      getCurrentTexture: () => ({ createView: () => ({}) }),
    };
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  const bounds = (element: Element) =>
    element === document.documentElement || element === document.body
      ? new DOMRect(0, 0, 2, 2)
      : element.hasAttribute("data-agent-native-node-id") ||
          element.hasAttribute("data-an-native-canvas")
        ? new DOMRect(0, 0, 2, 2)
        : new DOMRect(0, 0, 0, 0);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return bounds(this);
    },
  );
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    if (pseudo) return { content: "none" } as CSSStyleDeclaration;
    return {
      imageRendering: "auto",
      display:
        element instanceof HTMLScriptElement ||
        element instanceof HTMLHeadElement
          ? "none"
          : "block",
      visibility:
        element instanceof HTMLElement && element.style.visibility
          ? element.style.visibility
          : "visible",
      opacity: "1",
      mixBlendMode: "normal",
      filter: "none",
      backdropFilter: "none",
      transform: "none",
      transformOrigin: "50% 50%",
      transformStyle: "flat",
      perspective: "none",
      rotate: "none",
      scale: "none",
      translate: "none",
      position: "static",
      isolation: "auto",
      zIndex: "auto",
      width: `${bounds(element).width}px`,
      height: `${bounds(element).height}px`,
      boxSizing: "border-box",
      objectFit: "fill",
      objectPosition: "50% 50%",
      writingMode: "horizontal-tb",
      direction: "ltr",
      textTransform: "none",
      textDecorationLine: "none",
      textShadow: "none",
      fontVariantCaps: "normal",
      fontStyle: "normal",
      fontWeight: "400",
      fontSize: "12px",
      fontFamily: "sans-serif",
      letterSpacing: "normal",
      backgroundImage: "none",
      backgroundColor: "rgba(0, 0, 0, 0)",
      boxShadow: "none",
      outlineStyle: "none",
      borderTopColor: "rgba(0, 0, 0, 0)",
      borderRightColor: "rgba(0, 0, 0, 0)",
      borderBottomColor: "rgba(0, 0, 0, 0)",
      borderLeftColor: "rgba(0, 0, 0, 0)",
      borderImageSource: "none",
      borderTopWidth: "0px",
      borderRightWidth: "0px",
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      borderTopLeftRadius: "0px",
      borderTopRightRadius: "0px",
      borderBottomRightRadius: "0px",
      borderBottomLeftRadius: "0px",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
      overflowX: "visible",
      overflowY: "visible",
      maskImage: "none",
      clipPath: "none",
      getPropertyValue: () => "0px",
    } as unknown as CSSStyleDeclaration;
  });
  const script = document.createElement("script");
  if (exportInitialPixelRatio !== undefined)
    script.setAttribute(
      "data-agent-native-export-initial-pixel-ratio",
      exportInitialPixelRatio,
    );
  if (withEffect) {
    const target = document.createElement("div");
    target.setAttribute("data-agent-native-node-id", "test-target");
    Object.defineProperties(target, {
      offsetWidth: { configurable: true, value: 2 },
      offsetHeight: { configurable: true, value: 2 },
    });
    document.body.append(target);
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    manifest.textContent = JSON.stringify({
      schemaVersion: 2,
      ...(preview ? { preview } : {}),
      definitions: [GRAIN_GRADIENT_EFFECT],
      instances: [
        {
          id: "test-instance",
          nodeId: "test-target",
          definitionId: GRAIN_GRADIENT_EFFECT.id,
          definitionVersion: GRAIN_GRADIENT_EFFECT.version,
          placement: "fill",
          params: {},
          enabled: true,
          opacity: 1,
          seed: 1,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: false, time: 0 },
        },
      ],
    });
    document.body.append(manifest);
  }
  document.body.append(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    value: script,
  });
  new Function(nativeShaderRuntimeBridgeScript)();
  runtime = (window as Window & { __anNativeShaders?: PixelRuntime })
    .__anNativeShaders;
  if (!runtime) throw new Error("Native runtime did not start.");
  await runtime.scan();
  return runtime;
}

const frame = {
  frameIndex: 0,
  fps: 30,
  pixelRatio: 1,
  viewport: { width: 2, height: 2 },
  sourceContract: "declarative-only" as const,
};

describe("atomic backdrop scene presentation", () => {
  const nestedClipFixture = async (initiallyClipped: boolean) => {
    const gpu = fakeGpu({ completeCanvasConfiguration: true });
    const active = await startRuntime(true);
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 8 },
      innerHeight: { configurable: true, value: 8 },
    });
    const parent = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!parent || !manifest?.textContent)
      throw new Error("Nested clip fixture unavailable.");
    const child = document.createElement("div");
    child.dataset.agentNativeNodeId = "clip-child";
    Object.defineProperties(child, {
      offsetWidth: { configurable: true, value: 2 },
      offsetHeight: { configurable: true, value: 2 },
    });
    parent.append(child);
    const position = { x: initiallyClipped ? 4 : 0 };
    Object.defineProperty(child, "offsetLeft", {
      configurable: true,
      get: () => position.x,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "offsetLeft", {
      configurable: true,
      get(this: HTMLCanvasElement) {
        return this.dataset.anNativeCanvas === "clip-backdrop" ? position.x : 0;
      },
    });
    const rect = vi
      .mocked(Element.prototype.getBoundingClientRect)
      .getMockImplementation();
    const style = vi.mocked(window.getComputedStyle).getMockImplementation();
    if (!rect || !style) throw new Error("Nested clip DOM model unavailable.");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return this === child ||
          this.getAttribute("data-an-native-canvas") === "clip-backdrop"
          ? new DOMRect(position.x, 0, 2, 2)
          : rect.call(this);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...style(element, pseudo),
          overflowX: element === parent ? "hidden" : "visible",
          overflowY: element === parent ? "hidden" : "visible",
        }) as CSSStyleDeclaration,
    );
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Nested clip processor unavailable.");
    source.definitions.push(processor);
    source.instances = [
      {
        ...source.instances[0],
        id: "clip-backdrop",
        nodeId: "clip-child",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
      },
      {
        ...source.instances[0],
        id: "clip-layer",
        nodeId: "test-target",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      },
    ];
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          canvas: HTMLCanvasElement;
          outputTexture: unknown;
          frameCount: number;
          groupLocalNoncontributingChildren: Set<string>;
          provider: {
            readScene(): Promise<Array<{ nativeInstanceId?: string }>>;
            groupLocalBackdropClipState(
              canvas: HTMLCanvasElement,
            ): "empty" | "nonempty";
          };
        }
      >;
    };
    const parentMount = internals.mounts.get("clip-layer");
    const childMount = internals.mounts.get("clip-backdrop");
    if (!parentMount || !childMount)
      throw new Error("Nested clip mounts unavailable.");
    return { gpu, active, parent, child, position, parentMount, childMount };
  };

  it.each([false, true])(
    "completes a fully clipped child without output or rendered-count inflation (initially clipped: %s)",
    async (initiallyClipped) => {
      const fixture = await nestedClipFixture(initiallyClipped);
      const { active, parentMount, childMount, position } = fixture;
      const initialChildStatus = fixture.child.getAttribute(
        "data-an-native-status",
      );
      await active.renderAt(0);
      if (initiallyClipped) {
        expect(childMount.outputTexture).toBeNull();
        expect(childMount.frameCount).toBe(0);
        expect(fixture.child.getAttribute("data-an-native-status")).toBe(
          initialChildStatus,
        );
      }
      const priorChild = childMount.outputTexture;
      const priorFrames = childMount.frameCount;
      position.x = 4;
      expect(
        parentMount.provider.groupLocalBackdropClipState(childMount.canvas),
      ).toBe("empty");
      expect(childMount.canvas.getBoundingClientRect().right).toBeLessThan(
        window.innerWidth,
      );
      const result = await active.renderAt(1);
      expect(result).toMatchObject({ rendered: 1 });
      expect(childMount.outputTexture).toBe(priorChild);
      expect(childMount.frameCount).toBe(priorFrames);
      expect(
        parentMount.groupLocalNoncontributingChildren.has("clip-backdrop"),
      ).toBe(true);
      expect(fixture.parent.getAttribute("data-an-native-status")).toBe(
        "ready",
      );
      position.x = 0;
      await active.renderAt(2);
      expect(childMount.outputTexture).toBeTruthy();
      expect(childMount.frameCount).toBe(priorFrames + 1);
      expect(parentMount.groupLocalNoncontributingChildren.size).toBe(0);
    },
  );

  it("refuses an omitted nonempty child before parent submission or publication", async () => {
    const { active, gpu, parent, parentMount, childMount } =
      await nestedClipFixture(false);
    await active.renderAt(0);
    const priorParent = parentMount.outputTexture;
    const priorChild = childMount.outputTexture;
    const priorFrames = [parentMount.frameCount, childMount.frameCount];
    const priorSubmits = gpu.state.submitted;
    const readScene = parentMount.provider.readScene.bind(parentMount.provider);
    const omission = vi
      .spyOn(parentMount.provider, "readScene")
      .mockImplementation(async () =>
        (await readScene()).filter(
          (record) => record.nativeInstanceId !== "clip-backdrop",
        ),
      );
    await expect(active.renderAt(1)).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    expect(parent.getAttribute("data-an-native-error")).toBe(
      "native-dependency-missing",
    );
    expect(gpu.state.submitted).toBe(priorSubmits);
    expect(parentMount.outputTexture).toBe(priorParent);
    expect(childMount.outputTexture).toBe(priorChild);
    expect([parentMount.frameCount, childMount.frameCount]).toEqual(
      priorFrames,
    );
    omission.mockRestore();
    await active.renderAt(2);
    expect([parentMount.frameCount, childMount.frameCount]).toEqual(
      priorFrames.map((count) => count + 1),
    );
  });

  it("refuses expanded nested Backdrop staging before encoding or publication", async () => {
    const fixture = await nestedClipFixture(false);
    const { childMount, parentMount, gpu, active } = fixture;
    const expandedChild = childMount as typeof childMount & {
      outputExtent: { expanded: boolean } | null;
    };
    expandedChild.outputExtent = {
      ...expandedChild.outputExtent,
      expanded: true,
    };
    const internals = active as unknown as {
      device: { createCommandEncoder(): unknown };
      stageGroupLocalBackdrop(...args: unknown[]): Promise<unknown>;
    };
    const transaction = {
      active: new Set<string>(),
      staged: new Map(),
      retired: new Set(),
    };
    const prior = {
      submitted: gpu.state.submitted,
      textures: gpu.state.textures.length,
      writes: gpu.state.uniformWrites.length,
      output: childMount.outputTexture,
      frames: childMount.frameCount,
    };
    await expect(
      internals.stageGroupLocalBackdrop(
        parentMount,
        childMount,
        { width: 2, height: 2 },
        0,
        0,
        2,
        2,
        false,
        internals.device.createCommandEncoder(),
        transaction,
      ),
    ).rejects.toMatchObject({
      code: "source-group-local-geometry-unsupported",
    });
    expect(gpu.state.submitted).toBe(prior.submitted);
    expect(gpu.state.textures).toHaveLength(prior.textures);
    expect(gpu.state.uniformWrites).toHaveLength(prior.writes);
    expect(childMount.outputTexture).toBe(prior.output);
    expect(childMount.frameCount).toBe(prior.frames);
    expect(transaction.active.size).toBe(0);
    expect(transaction.staged.size).toBe(0);
  });

  const containedExpandedFixture = async (density: number) => {
    const options = {
      validationError: false,
      completeCanvasConfiguration: true,
    };
    const gpu = fakeGpu(options);
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: density,
    });
    const active = await startRuntime(true, {
      quality: "quality",
      frameRateTarget: 60,
    });
    const parent = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!parent || !manifest?.textContent)
      throw new Error("Contained expanded fixture unavailable.");
    const child = document.createElement("div");
    child.dataset.agentNativeNodeId = "contained-child";
    const position = { x: 8, y: 6 };
    Object.defineProperties(parent, {
      offsetWidth: { configurable: true, value: 20 },
      offsetHeight: { configurable: true, value: 16 },
    });
    Object.defineProperties(child, {
      offsetWidth: { configurable: true, value: 4 },
      offsetHeight: { configurable: true, value: 4 },
      offsetLeft: { configurable: true, get: () => position.x },
      offsetTop: { configurable: true, get: () => position.y },
    });
    parent.append(child);
    for (const element of [document.documentElement, document.body]) {
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: 20 },
        offsetHeight: { configurable: true, value: 16 },
      });
    }
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 20 },
      innerHeight: { configurable: true, value: 16 },
    });
    Object.defineProperties(HTMLCanvasElement.prototype, {
      offsetWidth: {
        configurable: true,
        get(this: HTMLCanvasElement) {
          return Number.parseFloat(this.style.width) || 2;
        },
      },
      offsetHeight: {
        configurable: true,
        get(this: HTMLCanvasElement) {
          return Number.parseFloat(this.style.height) || 2;
        },
      },
    });
    const rect = vi
      .mocked(Element.prototype.getBoundingClientRect)
      .getMockImplementation();
    const style = vi.mocked(window.getComputedStyle).getMockImplementation();
    if (!rect || !style)
      throw new Error("Contained expanded DOM model unavailable.");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === child) return new DOMRect(position.x, position.y, 4, 4);
        if (
          this === parent ||
          this === document.documentElement ||
          this === document.body
        )
          return new DOMRect(0, 0, 20, 16);
        if (
          this instanceof HTMLCanvasElement &&
          this.hasAttribute("data-an-native-canvas")
        )
          return new DOMRect(
            Number.parseFloat(this.style.left) || 0,
            Number.parseFloat(this.style.top) || 0,
            this.offsetWidth,
            this.offsetHeight,
          );
        return rect.call(this);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const base = style(element, pseudo);
        return {
          ...base,
          width:
            element === child
              ? "4px"
              : element === parent
                ? "20px"
                : base.width,
          height:
            element === child
              ? "4px"
              : element === parent
                ? "16px"
                : base.height,
          overflowX:
            element === child
              ? "clip"
              : element === parent
                ? "hidden"
                : "visible",
          overflowY:
            element === child
              ? "clip"
              : element === parent
                ? "hidden"
                : "visible",
          overflowClipMargin: element === child ? "2px" : "0px",
          getPropertyValue: (name: string) =>
            name === "overflow-clip-margin"
              ? element === child
                ? "2px"
                : "0px"
              : base.getPropertyValue(name),
        } as CSSStyleDeclaration;
      },
    );
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor)
      throw new Error("Contained expanded processor unavailable.");
    source.definitions.push(processor);
    source.instances = [
      {
        ...source.instances[0],
        id: "contained-backdrop",
        nodeId: "contained-child",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
        opacity: 0.35,
      },
      {
        ...source.instances[0],
        id: "contained-layer",
        nodeId: "test-target",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      },
    ];
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    )) {
      Object.defineProperties(canvas, {
        offsetLeft: {
          configurable: true,
          get: () => Number.parseFloat(canvas.style.left),
        },
        offsetTop: {
          configurable: true,
          get: () => Number.parseFloat(canvas.style.top),
        },
      });
    }
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          width: number;
          height: number;
          outputExtent: { expanded: boolean };
          outputTexture: unknown;
          frameCount: number;
          provider: {
            readScene(): Promise<
              Array<{
                nativeInstanceId?: string;
                rect: { x: number; y: number; width: number; height: number };
                localBox: {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                };
                localToTarget: {
                  a: number;
                  b: number;
                  c: number;
                  d: number;
                  e: number;
                  f: number;
                };
                clip: { x: number; y: number; width: number; height: number };
              }>
            >;
          };
        }
      >;
    };
    const parentMount = internals.mounts.get("contained-layer");
    const childMount = internals.mounts.get("contained-backdrop");
    if (!parentMount || !childMount)
      throw new Error("Contained expanded mounts unavailable.");
    return {
      active,
      gpu,
      options,
      position,
      parent,
      child,
      parentMount,
      childMount,
    };
  };

  it.each([1, 1.3, 2])(
    "stages a contained expanded child at density %s while replacing only receiver coverage",
    async (density) => {
      const fixture = await containedExpandedFixture(density);
      const { active, gpu, childMount, parentMount } = fixture;
      const pendingCanvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-an-native-canvas="contained-backdrop"]',
      );
      if (!pendingCanvas)
        throw new Error("Contained expanded pending canvas unavailable.");
      expect(pendingCanvas.style.visibility).toBe("hidden");
      await expect(active.renderAt(0)).resolves.toMatchObject({ rendered: 2 });
      expect(childMount.outputExtent.expanded).toBe(true);
      expect(childMount.outputTexture).toBeTruthy();
      expect(parentMount.outputTexture).toBeTruthy();
      const record = (await parentMount.provider.readScene()).find(
        (entry) => entry.nativeInstanceId === "contained-backdrop",
      );
      if (!record)
        throw new Error("Contained expanded source record unavailable.");
      expect(record.rect.width).toBeGreaterThan(record.clip.width);
      expect(record.rect.height).toBeGreaterThan(record.clip.height);
      expect(record.clip).toEqual({ x: 8, y: 6, width: 4, height: 4 });
      const capture = gpu.state.uniformWrites.find(
        (values) =>
          values.length === 8 &&
          values[0] === childMount.width &&
          values[1] === childMount.height,
      );
      if (!capture)
        throw new Error("Contained expanded capture uniform unavailable.");
      const scaleX = parentMount.width / 20;
      const scaleY = parentMount.height / 16;
      const affine = planNativeSourceAffine({
        localBox: record.localBox,
        localToTarget: record.localToTarget,
        physicalScale: { x: scaleX, y: scaleY },
      });
      if (!affine.ok) throw new Error("Contained expanded affine unavailable.");
      expect(capture.slice(4)).toEqual([
        Math.fround(affine.physicalBounds.x),
        Math.fround(affine.physicalBounds.y),
        Math.fround(affine.physicalBounds.width),
        Math.fround(affine.physicalBounds.height),
      ]);
      expect(
        gpu.state.uniformWrites.some(
          (values) =>
            values.length > 36 &&
            Math.abs(values[8]! - 0.35) < 1e-6 &&
            values
              .slice(0, 4)
              .every(
                (value, index) =>
                  value ===
                  Math.fround(
                    [
                      record.rect.x,
                      record.rect.y,
                      record.rect.width,
                      record.rect.height,
                    ][index]! * (index % 2 === 0 ? scaleX : scaleY),
                  ),
              ),
        ),
      ).toBe(true);
      const prior = {
        child: childMount.outputTexture,
        parent: parentMount.outputTexture,
        childFrames: childMount.frameCount,
        parentFrames: parentMount.frameCount,
      };
      fixture.options.validationError = true;
      await expect(active.renderAt(1)).rejects.toMatchObject({
        code: "native-render-incomplete",
      });
      expect(childMount.outputTexture).toBe(prior.child);
      expect(parentMount.outputTexture).toBe(prior.parent);
      expect(childMount.frameCount).toBe(prior.childFrames);
      expect(parentMount.frameCount).toBe(prior.parentFrames);
    },
  );

  it("refuses a visible receiver whose expanded capture is unavailable and preserves the last good transaction", async () => {
    const fixture = await containedExpandedFixture(1);
    await fixture.active.renderAt(0);
    const prior = {
      submitted: fixture.gpu.state.submitted,
      child: fixture.childMount.outputTexture,
      parent: fixture.parentMount.outputTexture,
      childFrames: fixture.childMount.frameCount,
      parentFrames: fixture.parentMount.frameCount,
      captures: fixture.gpu.state.uniformWrites.filter(
        (values) => values.length === 8,
      ).length,
    };
    fixture.position.x = 0;
    await expect(fixture.active.renderAt(1)).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    expect(fixture.parent.getAttribute("data-an-native-error")).toBe(
      "source-group-local-geometry-unsupported",
    );
    expect(fixture.gpu.state.submitted).toBe(prior.submitted);
    expect(
      fixture.gpu.state.uniformWrites.filter((values) => values.length === 8),
    ).toHaveLength(prior.captures);
    expect(fixture.childMount.outputTexture).toBe(prior.child);
    expect(fixture.parentMount.outputTexture).toBe(prior.parent);
    expect(fixture.childMount.frameCount).toBe(prior.childFrames);
    expect(fixture.parentMount.frameCount).toBe(prior.parentFrames);
  });

  it.each(["hidden", "clipped"] as const)(
    "completes an inactive expanded receiver (%s) even when its pending capture window is present",
    async (state) => {
      const fixture = await containedExpandedFixture(1);
      if (state === "hidden") fixture.child.style.visibility = "hidden";
      else fixture.position.x = 20;
      await expect(fixture.active.renderAt(0)).resolves.toMatchObject({
        rendered: 1,
      });
      expect(fixture.childMount.outputTexture).toBeNull();
      expect(fixture.childMount.frameCount).toBe(0);
      expect(fixture.parentMount.outputTexture).toBeTruthy();
      const records = await fixture.parentMount.provider.readScene();
      expect(
        records.some(
          (record) => record.nativeInstanceId === "contained-backdrop",
        ),
      ).toBe(false);
    },
  );

  it("refuses a group-local transaction without a Layer owner before GPU composition", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    await active.scan();
    const internals = active as unknown as {
      mounts: Map<string, Record<string, unknown>>;
      composeScene(...args: unknown[]): Promise<unknown>;
    };
    const mount = [...internals.mounts.values()][0];
    if (!mount) throw new Error("Nested owner fixture unavailable.");
    await expect(
      internals.composeScene(
        { ...mount, instance: undefined },
        [],
        {},
        "source",
        "linear",
        { time: 0, deterministic: true, active: new Set(), staged: new Map() },
      ),
    ).rejects.toMatchObject({ code: "source-group-local-chain-unsupported" });
  });

  it.each(["auto", "pixelated", "crisp-edges"])(
    "stages a descendant Backdrop with %s sampling before either output commits",
    async (imageRendering) => {
      const gpuOptions = { validationError: false };
      const gpu = fakeGpu(gpuOptions);
      const active = await startRuntime(true);
      const manifest = document.querySelector<HTMLScriptElement>(
        'script[type="application/x-agent-native-effects"]',
      );
      const parent = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="test-target"]',
      );
      if (!manifest?.textContent || !parent)
        throw new Error("Nested native fixture unavailable.");
      const child = document.createElement("div");
      child.setAttribute("data-agent-native-node-id", "nested-child");
      Object.defineProperties(child, {
        offsetWidth: { configurable: true, value: 2 },
        offsetHeight: { configurable: true, value: 2 },
      });
      parent.append(child);
      const source = JSON.parse(manifest.textContent) as {
        definitions: unknown[];
        instances: Array<Record<string, unknown>>;
      };
      const processor = OWNED_PROCESSOR_DEFINITIONS.find(
        (definition) => definition.id === "an-native-owned-directional-smear",
      );
      if (!processor) throw new Error("Owned processor missing.");
      source.definitions.push(processor);
      source.instances = [
        {
          ...source.instances[0],
          id: "nested-child-backdrop",
          nodeId: "nested-child",
          definitionId: processor.id,
          definitionVersion: processor.version,
          placement: "backdrop",
          params: { mix: 0 },
        },
        {
          ...source.instances[0],
          id: "nested-parent-layer",
          nodeId: "test-target",
          definitionId: processor.id,
          definitionVersion: processor.version,
          placement: "layer",
          params: { mix: 0 },
        },
      ];
      manifest.textContent = JSON.stringify(source);
      await active.scan();
      const childCanvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-an-native-canvas="nested-child-backdrop"]',
      );
      const computedStyle = vi
        .mocked(window.getComputedStyle)
        .getMockImplementation();
      if (!childCanvas || !computedStyle)
        throw new Error("Nested child presentation style unavailable.");
      vi.spyOn(window, "getComputedStyle").mockImplementation(
        (element, pseudo) =>
          ({
            ...computedStyle(element, pseudo),
            imageRendering: element === childCanvas ? imageRendering : "auto",
          }) as CSSStyleDeclaration,
      );
      await active.renderAt(0);
      const mounts = (
        active as unknown as {
          mounts: Map<string, { outputTexture?: unknown; frameCount: number }>;
        }
      ).mounts;
      expect(mounts.get("nested-child-backdrop")?.outputTexture).toBeTruthy();
      expect(mounts.get("nested-parent-layer")?.outputTexture).toBeTruthy();
      expect(mounts.get("nested-child-backdrop")?.frameCount).toBeGreaterThan(
        0,
      );
      const committedScene = (
        active as unknown as {
          scenePresentation?: { committedInstances: Set<string> };
        }
      ).scenePresentation;
      expect(
        committedScene?.committedInstances.has("nested-child-backdrop"),
      ).toBe(true);
      await active.renderCompositionFramePixels(frame);
      expect(active.compositionSceneDiagnostic()).toMatchObject({
        missingVisibleMountIds: [],
      });
      expect(
        parent.hasAttribute("data-an-native-layer-group-local-source"),
      ).toBe(true);
      expect(
        gpu.state.shaderCodes.some((code) =>
          code.includes("struct Draw { extent: vec4f, sourceBox: vec4f }"),
        ),
      ).toBe(true);
      const childPublished = mounts.get("nested-child-backdrop")?.outputTexture;
      const parentPublished = mounts.get("nested-parent-layer")?.outputTexture;
      const childFrames = mounts.get("nested-child-backdrop")?.frameCount;
      gpuOptions.validationError = true;
      await expect(active.renderAt(1)).rejects.toMatchObject({
        code: "native-render-incomplete",
      });
      expect(mounts.get("nested-child-backdrop")?.outputTexture).toBe(
        childPublished,
      );
      expect(mounts.get("nested-parent-layer")?.outputTexture).toBe(
        parentPublished,
      );
      expect(mounts.get("nested-child-backdrop")?.frameCount).toBe(childFrames);
      expect(child.getAttribute("data-an-native-status")).toBe("last-good");
      gpuOptions.validationError = false;
      const rejectedChild = mounts.get("nested-child-backdrop") as
        | {
            frozenReason: {
              code: string;
              message: string;
              instanceId: string;
            } | null;
          }
        | undefined;
      if (!rejectedChild) throw new Error("Mounted child disappeared.");
      rejectedChild.frozenReason = {
        code: "definition-hash-unavailable",
        message: "definition-hash-unavailable",
        instanceId: "nested-child-backdrop",
      };
      const submitsBeforeRejection = gpu.state.submitted;
      await expect(active.renderAt(2)).rejects.toMatchObject({
        code: "native-render-incomplete",
      });
      expect(gpu.state.submitted).toBe(submitsBeforeRejection);
      expect(mounts.get("nested-child-backdrop")?.outputTexture).toBe(
        childPublished,
      );
      expect(mounts.get("nested-parent-layer")?.outputTexture).toBe(
        parentPublished,
      );
    },
  );

  it("rejects a Backdrop with two enclosing Layer owners before staging either parent", async () => {
    const gpu = fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const outer = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !outer)
      throw new Error("Nested ownership fixture unavailable.");
    const inner = document.createElement("div");
    inner.setAttribute("data-agent-native-node-id", "nested-inner-layer");
    const child = document.createElement("div");
    child.setAttribute("data-agent-native-node-id", "nested-deep-backdrop");
    for (const element of [inner, child])
      Object.defineProperties(element, {
        offsetWidth: { configurable: true, value: 2 },
        offsetHeight: { configurable: true, value: 2 },
      });
    outer.append(inner);
    inner.append(child);
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances = [
      {
        ...source.instances[0],
        id: "nested-deep-effect",
        nodeId: "nested-deep-backdrop",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
      },
      ...(
        [
          ["nested-inner-effect", "nested-inner-layer"],
          ["nested-outer-effect", "test-target"],
        ] as const
      ).map(([id, nodeId]) => ({
        ...source.instances[0],
        id,
        nodeId,
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      })),
    ];
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const submissionsBefore = gpu.state.submitted;
    await expect(active.renderAt(0)).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    const mounts = (
      active as unknown as {
        mounts: Map<string, { outputTexture?: unknown }>;
      }
    ).mounts;
    expect(mounts.get("nested-deep-effect")?.outputTexture).toBeFalsy();
    expect(gpu.state.submitted).toBe(submissionsBefore);
    expect(
      [inner, outer].map((element) =>
        element.getAttribute("data-an-native-error"),
      ),
    ).toContain("source-group-local-chain-unsupported");
  });

  it("keeps a committed Layer chain last-good only while its scene remains", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !target)
      throw new Error("Backdrop fixture unavailable.");
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const first = {
      ...source.instances[0],
      id: "status-first-layer",
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "layer",
      params: { mix: 0 },
    };
    source.definitions.push(processor);
    source.instances = [
      first,
      { ...first, id: "status-top-layer" },
      { ...first, id: "status-backdrop", placement: "backdrop" },
    ];
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    await active.renderAt(0);
    const internals = active as unknown as {
      renderMount(...args: unknown[]): Promise<void>;
      releaseScenePresentation(): void;
      scenePresentation: {
        committedInstances: Set<string>;
        canvas: HTMLCanvasElement;
      } | null;
      mounts: Map<string, { reportedStatus: { status: string } | null }>;
    };
    const scene = internals.scenePresentation;
    expect(scene?.committedInstances).toEqual(
      new Set(["status-first-layer", "status-top-layer", "status-backdrop"]),
    );
    const originalRender = internals.renderMount.bind(internals);
    const failingTop = vi
      .spyOn(internals, "renderMount")
      .mockImplementation(async (...args) => {
        if (
          (args[0] as { instance?: { id?: string } }).instance?.id ===
          "status-top-layer"
        )
          throw new Error("top source unavailable");
        await originalRender(...args);
      });
    await expect(active.renderAt(0)).rejects.toThrow("top source unavailable");
    expect(internals.scenePresentation).toBe(scene);
    expect(scene?.canvas.style.visibility).toBe("visible");
    expect(
      internals.mounts.get("status-top-layer")?.reportedStatus?.status,
    ).toBe("last-good");
    expect(
      internals.mounts.get("status-first-layer")?.reportedStatus?.status,
    ).toBe("last-good");
    expect(target.getAttribute("data-an-native-status")).toBe("last-good");

    internals.releaseScenePresentation();
    await expect(active.renderAt(0)).rejects.toThrow("top source unavailable");
    expect(internals.scenePresentation).toBeNull();
    expect(
      internals.mounts.get("status-top-layer")?.reportedStatus?.status,
    ).toBe("error");
    expect(
      internals.mounts.get("status-first-layer")?.reportedStatus?.status,
    ).toBe("error");
    expect(target.getAttribute("data-an-native-status")).toBe("error");
    failingTop.mockRestore();
  });
  it("moves receiver opacity outside a paired Layer while preserving solo Layer capture", async () => {
    fakeGpu({ completeCanvasConfiguration: true });
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !target)
      throw new Error("Layer fixture unavailable.");
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    const style = vi.mocked(window.getComputedStyle).getMockImplementation();
    if (!style) throw new Error("Style mock unavailable.");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...style(element, pseudo),
          opacity: element === target ? "0.5" : "1",
          backgroundColor:
            element === target ? "rgb(100, 100, 100)" : "rgba(0, 0, 0, 0)",
        }) as CSSStyleDeclaration,
    );
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const layer = {
      ...source.instances[0],
      id: "paired-layer",
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "layer",
      params: { mix: 0 },
    };
    const backdrop = {
      ...layer,
      id: "paired-backdrop",
      placement: "backdrop",
    };
    source.definitions.push(processor);
    source.instances = [layer];
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      renderMount(...args: unknown[]): Promise<void>;
      showOriginal(mount: unknown): void;
      mounts: Map<
        string,
        {
          canvas: HTMLCanvasElement;
          provider: {
            readScene(): Promise<
              Array<{
                node: Element;
                isolationPath: Array<{ opacity?: number }>;
              }>
            >;
          };
          layerSourceOpacityDeferred: boolean;
          suppressed: boolean;
          reportedStatus: { status: string } | null;
        }
      >;
    };
    const layerMount = internals.mounts.get("paired-layer");
    if (!layerMount) throw new Error("Layer mount unavailable.");
    const ownOpacity = async () =>
      (await layerMount.provider.readScene())
        .filter((record) => record.node === target)
        .flatMap((record) => record.isolationPath)
        .filter((entry) => entry.opacity === 0.5).length;
    expect(layerMount.layerSourceOpacityDeferred).toBe(false);
    expect(await ownOpacity()).toBeGreaterThan(0);
    expect(layerMount.canvas.style.opacity).toBe("");

    const secondLayer = { ...layer, id: "paired-layer-second" };
    source.instances = [layer, secondLayer, backdrop];
    manifest.textContent = JSON.stringify(source);
    const originalRender = internals.renderMount.bind(internals);
    const blockedTopLayer = vi
      .spyOn(internals, "renderMount")
      .mockImplementation(async (...args) => {
        if (
          (args[0] as { instance?: { id?: string } }).instance?.id ===
          "paired-layer-second"
        )
          throw new Error("paired top Layer unavailable");
        await originalRender(...args);
      });
    await active.scan();
    expect(layerMount.canvas.style.visibility).toBe("hidden");
    expect(target.hasAttribute("data-an-native-layer-suppressed")).toBe(false);
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBeNull();
    blockedTopLayer.mockRestore();
    await active.renderAt(0);
    expect(layerMount.layerSourceOpacityDeferred).toBe(true);
    expect(await ownOpacity()).toBe(0);
    expect(layerMount.canvas.style.opacity).toBe("0.5");
    expect(
      layerMount.canvas.getAttribute("data-an-native-layer-opacity-owner"),
    ).toBe("receiver");
    expect(
      document.querySelector<HTMLCanvasElement>(
        "canvas[data-an-native-scene-presentation]",
      )?.style.visibility,
    ).toBe("visible");

    const second = internals.mounts.get("paired-layer-second");
    if (!second) throw new Error("Second Layer mount unavailable.");
    expect(second.layerSourceOpacityDeferred).toBe(true);
    expect(second.canvas.style.opacity).toBe("0.5");
    expect(
      second.canvas.getAttribute("data-an-native-layer-opacity-owner"),
    ).toBe("receiver");
    expect(layerMount.suppressed).toBe(true);
    const heldScene = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-scene-presentation]",
    );
    const failedCommittedTop = vi
      .spyOn(internals, "renderMount")
      .mockImplementation(async (...args) => {
        if (
          (args[0] as { instance?: { id?: string } }).instance?.id ===
          "paired-layer-second"
        )
          throw new Error("committed top source unavailable");
        await originalRender(...args);
      });
    await expect(active.renderAt(0)).rejects.toThrow(
      "committed top source unavailable",
    );
    expect(second.reportedStatus?.status).toBe("last-good");
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBe(heldScene);
    expect(layerMount.canvas.style.visibility).toBe("hidden");
    failedCommittedTop.mockRestore();
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "paired-layer-second",
    );
    internals.showOriginal(second);
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "paired-layer",
    );
    expect(layerMount.canvas.style.visibility).toBe("visible");

    source.instances = [layer];
    manifest.textContent = JSON.stringify(source);
    const failedSolo = vi
      .spyOn(layerMount.provider, "readScene")
      .mockRejectedValue(new Error("solo source unavailable"));
    await active.scan();
    expect(layerMount.canvas.style.visibility).toBe("hidden");
    expect(target.hasAttribute("data-an-native-layer-suppressed")).toBe(false);
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBeNull();
    failedSolo.mockRestore();
    await active.renderAt(0);
    expect(layerMount.layerSourceOpacityDeferred).toBe(false);
    expect(await ownOpacity()).toBeGreaterThan(0);
    expect(layerMount.canvas.style.opacity).toBe("");
    expect(
      layerMount.canvas.hasAttribute("data-an-native-layer-opacity-owner"),
    ).toBe(false);
    expect(target.getAttribute("data-an-native-status")).toBe("ready");
  });
  it("wakes a paused backdrop after viewport invalidation without recommitting the old scene", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    await active.renderAt(0);
    active.pause();
    const internals = active as unknown as {
      scenePresentation: { canvas: HTMLCanvasElement } | null;
    };
    const oldScene = internals.scenePresentation;
    if (!oldScene) throw new Error("Scene presentation unavailable.");
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!target) throw new Error("Target unavailable.");
    let scheduled: FrameRequestCallback | undefined;
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        scheduled = callback;
        return 17;
      });
    window.dispatchEvent(new Event("resize"));
    expect(internals.scenePresentation).toBeNull();
    expect(oldScene.canvas.isConnected).toBe(false);
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(target.getAttribute("data-an-native-error")).toBe(
      "scene-viewport-changed",
    );
    expect(raf).toHaveBeenCalledTimes(1);
    if (!scheduled) throw new Error("Viewport recovery frame was not queued.");
    scheduled(0);
    await vi.waitFor(() => {
      expect(internals.scenePresentation).not.toBeNull();
      expect(internals.scenePresentation).not.toBe(oldScene);
    });
    expect(oldScene.canvas.isConnected).toBe(false);
    expect(target.getAttribute("data-an-native-status")).toBe("ready");
  });
  it("runs a full-viewport square clip without allocating a deferred group surface", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const surface = (
      active as unknown as {
        scenePresentation?: {
          surface: { isolationTextures: Map<string, unknown> };
        };
      }
    ).scenePresentation?.surface;
    const priorDeferred = [
      ...(surface?.isolationTextures.entries() ?? []),
    ].filter(([key]) => key.includes(":deferred:") && key.endsWith(":working"));
    const baselineStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation();
    if (!baselineStyle) throw new Error("Style mock unavailable.");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...baselineStyle(element, pseudo),
          overflowX: element === document.documentElement ? "clip" : "visible",
          overflowY: element === document.documentElement ? "clip" : "visible",
        }) as CSSStyleDeclaration,
    );
    await active.renderAt(0);
    expect(
      [...(surface?.isolationTextures.entries() ?? [])].filter(
        ([key]) => key.includes(":deferred:") && key.endsWith(":working"),
      ),
    ).toEqual(priorDeferred);
    expect(
      document.querySelector<HTMLCanvasElement>(
        "canvas[data-an-native-scene-presentation]",
      )?.style.visibility,
    ).toBe("visible");
  });

  it("renders a backdrop through an isolated viewport clip before committing the shared scene", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const baselineStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation();
    if (!baselineStyle) throw new Error("Style mock unavailable.");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...baselineStyle(element, pseudo),
          overflowX: element === document.documentElement ? "clip" : "visible",
          overflowY: element === document.documentElement ? "clip" : "visible",
          borderTopLeftRadius:
            element === document.documentElement ? "0.25px" : "0px",
          borderRightWidth:
            element === document.documentElement ? "1px" : "0px",
          borderBottomWidth:
            element === document.documentElement ? "1px" : "0px",
        }) as CSSStyleDeclaration,
    );
    await active.renderAt(0);
    expect(
      document.querySelector<HTMLCanvasElement>(
        "canvas[data-an-native-scene-presentation]",
      )?.style.visibility,
    ).toBe("visible");
    expect(
      document
        .querySelector<HTMLElement>('[data-agent-native-node-id="test-target"]')
        ?.hasAttribute("data-an-native-scene-suppressed"),
    ).toBe(true);
    const surface = (
      active as unknown as {
        scenePresentation?: {
          surface: {
            isolationTextures: Map<
              string,
              {
                width: number;
                height: number;
                texture: { destroy: ReturnType<typeof vi.fn> };
              }
            >;
          };
        };
      }
    ).scenePresentation?.surface;
    const groupEntries = [...(surface?.isolationTextures.entries() ?? [])]
      .filter(([key]) => key.includes(":deferred:") && key.endsWith(":working"))
      .map(([, entry]) => entry);
    expect(groupEntries).toEqual([
      expect.objectContaining({ width: 1, height: 1 }),
    ]);
    active.dispose();
    for (const entry of groupEntries)
      expect(entry.texture.destroy).toHaveBeenCalled();
  });

  it("groups receiver paint with its preceding backdrop at one authored opacity", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!target) throw new Error("Target unavailable.");
    const baselineStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation();
    if (!baselineStyle) throw new Error("Style mock unavailable.");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...baselineStyle(element, pseudo),
          opacity: element === target ? "0.5" : "1",
          backgroundColor:
            element === target ? "rgb(180, 90, 45)" : "rgba(0, 0, 0, 0)",
        }) as CSSStyleDeclaration,
    );
    const scene = (
      active as unknown as {
        scenePresentation?: {
          provider: {
            readScene(): Promise<
              Array<{
                node: Element;
                nativeInstanceId?: string;
                isolationPath: Array<{
                  id: string;
                  kind: string;
                  opacity?: number;
                }>;
              }>
            >;
          };
        };
      }
    ).scenePresentation;
    if (!scene) throw new Error("Scene presentation unavailable.");
    await active.renderAt(0);
    const records = await scene.provider.readScene();
    const native = records.find(
      (record) => record.nativeInstanceId === "test-instance",
    );
    const foreground = records.find((record) => record.node === target);
    const receiverGroup = native?.isolationPath.find((entry) =>
      entry.id.startsWith("receiver:"),
    );
    expect(receiverGroup).toMatchObject({ kind: "opacity", opacity: 0.5 });
    expect(foreground?.isolationPath).toContainEqual(receiverGroup);
    await active.renderAt(0);
    expect(
      document.querySelector<HTMLCanvasElement>(
        "canvas[data-an-native-scene-presentation]",
      )?.style.visibility,
    ).toBe("visible");
  });

  it("keeps an owned hidden backdrop source eligible after the shared scene is released", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const baselineStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation();
    if (!baselineStyle) throw new Error("Style mock unavailable.");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = baselineStyle(element, pseudo);
        return {
          ...style,
          opacity:
            element instanceof HTMLCanvasElement &&
            element.hasAttribute("data-an-native-backdrop-presentation")
              ? element.style.opacity || "1"
              : style.opacity,
        } as CSSStyleDeclaration;
      },
    );
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const backdrop = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-instance"]',
    );
    if (!backdrop) throw new Error("Backdrop canvas unavailable.");
    await active.renderAt(0);
    expect(Number(getComputedStyle(backdrop).opacity)).toBe(0);
    expect(backdrop.getAttribute("data-an-native-authored-opacity")).toBe("1");
    expect(backdrop.hasAttribute("data-an-native-scene-suppressed")).toBe(
      false,
    );
    (
      active as unknown as { releaseScenePresentation(): void }
    ).releaseScenePresentation();
    expect(backdrop.getAttribute("data-an-native-authored-opacity")).toBe("1");
    await active.renderAt(0);
    await active.renderCompositionFramePixels(frame);
    expect(active.compositionSceneDiagnostic()).toMatchObject({
      expectedVisibleMountIds: ["test-instance"],
      nativeRecordIds: ["test-instance"],
      missingVisibleMountIds: [],
    });
  });

  it("commits a full scene before hiding authored paint and restores detached nodes on disposal", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const backdrop = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-instance"]',
    );
    if (!target || !backdrop) throw new Error("Backdrop mount unavailable.");
    expect(backdrop.style.opacity).toBe("0");
    await active.renderAt(0);
    const scene = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-scene-presentation]",
    );
    expect(scene?.style.visibility).toBe("visible");
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });
    expect(active.compositionSceneDiagnostic()).toMatchObject({
      stage: "scene-read",
      viewport: { width: 2, height: 2 },
    });
    await expect(
      active.renderCompositionFramePixels({ ...frame, pixelRatio: 2 }),
    ).resolves.toMatchObject({ width: 4, height: 4 });
    const authoredCanvas = document.createElement("canvas");
    document.body.append(authoredCanvas);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await expect(
      active.renderCompositionFramePixels(frame),
    ).rejects.toMatchObject({
      code: "composition-canvas-source",
    });
    authoredCanvas.remove();
    target.remove();
    active.dispose();
    document.body.append(target);
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
  });

  it("preserves inert export records after full-scene presentation while restoring painted source opacity", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !target)
      throw new Error("Authored fixture unavailable.");
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    target.style.opacity = "0.4";
    const computed = vi.mocked(window.getComputedStyle).getMockImplementation();
    if (!computed) throw new Error("Computed style fixture unavailable.");
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        const style = computed(element, pseudo);
        return element === target
          ? ({
              ...style,
              opacity: target.hasAttribute("data-an-native-scene-suppressed")
                ? "0"
                : target.style.opacity,
            } as CSSStyleDeclaration)
          : style;
      },
    );
    const assets = document.createElement("script");
    assets.type = "application/x-agent-native-effect-assets";
    assets.setAttribute("data-agent-native-export-assets", "");
    assets.textContent = JSON.stringify({
      schemaVersion: 1,
      assets: [
        {
          path: "/api/design-native-texture/00000000-0000-4000-8000-000000000000.png",
          mimeType: "image/png",
          byteLength: 137,
          sha256:
            "b5d466547546522cc582be9d6f3b5d76c28cfd8963f70551ca0a56dd91cec86d",
          base64:
            "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAUElEQVR42u3QQQ0AIAwAsclBBGKQggAk8pgTEEH2Ib3kDDRmcXv1U3kb+XQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wNcLUK4D+nGW4EAAAAASUVORK5CYII=",
        },
      ],
    });
    const approvals = document.createElement("script");
    approvals.type = "application/x-agent-native-effect-approvals";
    approvals.textContent = JSON.stringify({ schemaVersion: 1, hashes: [] });
    const licenses = document.createElement("script");
    licenses.type = "text/plain";
    licenses.setAttribute("data-agent-native-export-font-licenses", "");
    licenses.textContent = JSON.stringify([
      { path: "/fonts/example.woff2", text: "Example font copyright" },
    ]);
    const inert = [assets, approvals, licenses];
    const snapshot = inert.map((script) => script.outerHTML);
    document.body.append(...inert);
    await active.scan();
    await active.renderAt(0);
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    expect(target.getAttribute("data-an-native-authored-opacity")).toBe("0.4");
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({ width: 2, height: 2 });
    await expect(
      active.renderCompositionFramePixels({ ...frame, frameIndex: 1 }),
    ).resolves.toMatchObject({ width: 2, height: 2 });
    expect(inert.map((script) => script.outerHTML)).toEqual(snapshot);
    expect(
      inert.every(
        (script) =>
          !script.hasAttribute("data-an-native-scene-suppressed") &&
          !script.hasAttribute("data-an-native-authored-opacity"),
      ),
    ).toBe(true);
    active.dispose();
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(target.hasAttribute("data-an-native-authored-opacity")).toBe(false);
    expect(getComputedStyle(target).opacity).toBe("0.4");
    expect(inert.map((script) => script.outerHTML)).toEqual(snapshot);
  });

  it("restores detached authored paint immediately while disposal waits for preview work", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!target) throw new Error("Backdrop target unavailable.");
    await active.renderAt(0);
    const scene = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-scene-presentation]",
    );
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    const engine = active as PixelRuntime & {
      running: Promise<void> | null;
    };
    let releasePreview!: () => void;
    engine.running = new Promise<void>((resolve) => {
      releasePreview = () => {
        engine.running = null;
        resolve();
      };
    });
    target.remove();
    active.dispose();
    document.body.append(target);
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(target.hasAttribute("data-an-native-authored-opacity")).toBe(false);
    expect(scene?.isConnected).toBe(false);
    expect(
      (active as PixelRuntime & { scenePresentation: unknown })
        .scenePresentation,
    ).not.toBeNull();
    releasePreview();
    await vi.waitFor(() =>
      expect(
        (active as PixelRuntime & { scenePresentation: unknown })
          .scenePresentation,
      ).toBeNull(),
    );
  });

  it.each(["style", "text"])(
    "aborts a backdrop export for an authored %s mutation",
    async (kind) => {
      const { mapStarted } = fakeGpu({ waitForAbort: true });
      const active = await startRuntime(true);
      const manifest = document.querySelector<HTMLScriptElement>(
        'script[type="application/x-agent-native-effects"]',
      );
      const target = document.querySelector<HTMLElement>(
        '[data-agent-native-node-id="test-target"]',
      );
      const processor = OWNED_PROCESSOR_DEFINITIONS.find(
        (definition) => definition.id === "an-native-owned-directional-smear",
      );
      if (!manifest?.textContent || !target || !processor)
        throw new Error("Backdrop mutation fixture unavailable.");
      const source = JSON.parse(manifest.textContent) as {
        definitions: unknown[];
        instances: Array<Record<string, unknown>>;
      };
      source.definitions.push(processor);
      source.instances[0] = {
        ...source.instances[0],
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
      };
      manifest.textContent = JSON.stringify(source);
      await active.scan();
      await active.renderAt(0);
      const pending = active.renderCompositionFramePixels(frame);
      await mapStarted;
      if (kind === "style") target.style.color = "red";
      else target.append(document.createTextNode("Authored change"));
      await expect(pending).rejects.toMatchObject({
        code: "composition-aborted",
      });
    },
  );

  it.each(["mixed-body", "retired-reattach"])(
    "aborts an export when an authored node accompanies a %s scene mutation",
    async (kind) => {
      const { mapStarted } = fakeGpu({ waitForAbort: true });
      const active = await startRuntime(true);
      const manifest = document.querySelector<HTMLScriptElement>(
        'script[type="application/x-agent-native-effects"]',
      );
      const processor = OWNED_PROCESSOR_DEFINITIONS.find(
        (definition) => definition.id === "an-native-owned-directional-smear",
      );
      if (!manifest?.textContent || !processor)
        throw new Error("Backdrop mutation fixture unavailable.");
      const source = JSON.parse(manifest.textContent) as {
        definitions: unknown[];
        instances: Array<Record<string, unknown>>;
      };
      source.definitions.push(processor);
      source.instances[0] = {
        ...source.instances[0],
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
      };
      manifest.textContent = JSON.stringify(source);
      await active.scan();
      await active.renderAt(0);
      const scene = document.querySelector<HTMLCanvasElement>(
        "canvas[data-an-native-scene-presentation]",
      );
      if (!scene) throw new Error("Scene canvas unavailable.");
      if (kind === "retired-reattach") {
        (
          active as unknown as { releaseScenePresentation(): void }
        ).releaseScenePresentation();
        await active.renderAt(0);
        expect(
          document.querySelector("canvas[data-an-native-scene-presentation]"),
        ).not.toBe(scene);
      }
      const pending = active.renderCompositionFramePixels(frame);
      await mapStarted;
      if (kind === "mixed-body") {
        const authored = document.createElement("span");
        authored.textContent = "Authored body addition";
        document.body.append(scene, authored);
      } else document.body.append(scene);
      await expect(pending).rejects.toMatchObject({
        code: "composition-aborted",
      });
    },
  );

  it("clears shared authored opacity after a Fill owner leaves the held scene", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!target) throw new Error("Target unavailable.");
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    target.setAttribute("data-an-native-fill-suppressed", "");
    target.removeAttribute("data-an-native-fill-suppressed");
    active.dispose();
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(target.hasAttribute("data-an-native-authored-opacity")).toBe(false);
  });

  it("rejects a missing backdrop record before suppressing authored paint or exporting", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-instance"]',
    );
    if (!target || !canvas) throw new Error("Backdrop mount unavailable.");
    expect(canvas.style.opacity).toBe("0");
    const sceneState = (
      active as unknown as {
        scenePresentation?: {
          provider: {
            readScene(): Promise<Array<{ nativeInstanceId?: string }>>;
          };
        };
      }
    ).scenePresentation;
    if (!sceneState) throw new Error("Scene presentation unavailable.");
    const originalRead = sceneState.provider.readScene.bind(
      sceneState.provider,
    );
    vi.spyOn(sceneState.provider, "readScene").mockImplementation(async () =>
      (await originalRead()).filter(
        (record) => record.nativeInstanceId !== "test-instance",
      ),
    );
    await expect(active.renderAt(0)).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBeNull();
  });

  it("restores authored paint if the document grows during an awaited scene read", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const scene = (
      active as unknown as {
        scenePresentation?: {
          provider: { readScene(): Promise<unknown[]> };
        };
      }
    ).scenePresentation;
    if (!scene) throw new Error("Scene presentation unavailable.");
    let notifyEntered!: () => void;
    let resume!: () => void;
    const entered = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const prior = scene.provider.readScene.bind(scene.provider);
    vi.spyOn(scene.provider, "readScene").mockImplementation(async () => {
      notifyEntered();
      await gate;
      return prior();
    });
    const rendering = active.renderAt(0);
    await entered;
    const priorScrolling = Object.getOwnPropertyDescriptor(
      document,
      "scrollingElement",
    );
    const priorHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "scrollHeight",
    );
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: document.documentElement,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: innerHeight + 100,
    });
    resume();
    await expect(rendering).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    expect(target?.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBeNull();
    if (priorScrolling)
      Object.defineProperty(document, "scrollingElement", priorScrolling);
    else Reflect.deleteProperty(document, "scrollingElement");
    if (priorHeight)
      Object.defineProperty(
        document.documentElement,
        "scrollHeight",
        priorHeight,
      );
    else Reflect.deleteProperty(document.documentElement, "scrollHeight");
  });

  it("does not commit a scene after its authored source changes during composition", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      composeScene: (...args: unknown[]) => Promise<unknown>;
      scenePresentation?: { provider: { authoredSourceEpoch?(): number } };
    };
    const scene = internals.scenePresentation;
    if (!scene) throw new Error("Scene presentation unavailable.");
    const priorCompose = internals.composeScene.bind(internals);
    let entered!: () => void;
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    vi.spyOn(internals, "composeScene").mockImplementation(async (...args) => {
      const result = await priorCompose(...args);
      if (
        (args[0] as { target?: Element }).target === document.documentElement
      ) {
        entered();
        await gate;
      }
      return result;
    });
    const rendering = active.renderAt(0);
    await paused;
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!target) throw new Error("Target unavailable.");
    target.style.backgroundColor = "rgb(19, 27, 43)";
    const added = document.createElement("div");
    added.textContent = "new authored sibling";
    const sourceEpoch = scene.provider.authoredSourceEpoch?.();
    document.body.append(added);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(scene.provider.authoredSourceEpoch?.()).toBeGreaterThan(
      sourceEpoch!,
    );
    resume();
    await expect(rendering).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBeNull();
  });

  it("prunes scene suppression before reading a reparented authored child", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const scene = (
      active as unknown as {
        scenePresentation?: { provider: { readScene(): Promise<unknown[]> } };
      }
    ).scenePresentation;
    if (!target || !scene) throw new Error("Scene target unavailable.");
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-agent-native-editor-chrome-host", "");
    document.body.append(overlay);
    overlay.append(target);
    const priorRead = scene.provider.readScene.bind(scene.provider);
    vi.spyOn(scene.provider, "readScene").mockImplementation(async () => {
      expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(
        false,
      );
      expect(target.hasAttribute("data-an-native-authored-opacity")).toBe(
        false,
      );
      return priorRead();
    });
    await expect(active.renderAt(0)).rejects.toThrow(
      "source-composition-unsupported",
    );
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
  });

  it("restores authored paint when a new direct SVG invalidates a committed scene", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances[0] = {
      ...source.instances[0],
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "backdrop",
      params: { mix: 0 },
    };
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    await active.renderAt(0);
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!target) throw new Error("Backdrop target unavailable.");
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    document.body.append(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    );
    await expect(active.renderAt(0)).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    expect(
      document.querySelector("canvas[data-an-native-scene-presentation]"),
    ).toBeNull();
    expect(target.hasAttribute("data-an-native-scene-suppressed")).toBe(false);
    expect(target.getAttribute("data-an-native-error")).toBe(
      "scene-direct-element-unsupported",
    );
  });
});

describe("native full-scene GPU pixel producer lifecycle", () => {
  it("detaches a replaced graph texture before a refused allocation and retries without a destroyed cache entry", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    active.pause();
    await active.renderAt(0);
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          resourceTextures: Map<
            string,
            { format: string; destroy: ReturnType<typeof vi.fn> }
          >;
        }
      >;
      textureBytes: Map<object, number>;
      texture(
        width: number,
        height: number,
        format?: string,
        usage?: number,
        mipLevels?: number,
      ): object;
    };
    const mount = internals.mounts.get("test-instance");
    const previous = mount?.resourceTextures.get("color");
    const wood = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-c-wood-endgrain",
    );
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!mount || !previous || !wood || !manifest?.textContent)
      throw new Error("Graph replacement fixture unavailable.");
    expect(previous.format).toBe("rgba8unorm");
    const authored = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: { definitionId: string; definitionVersion: number }[];
    };
    authored.definitions = [wood];
    authored.instances[0]!.definitionId = wood.id;
    authored.instances[0]!.definitionVersion = wood.version;
    manifest.textContent = JSON.stringify(authored);
    const allocate = internals.texture.bind(internals);
    const refusal = new Error("Test replacement allocation refused.");
    let refused = false;
    const allocation = vi
      .spyOn(internals, "texture")
      .mockImplementation((width, height, format, usage, mipLevels) => {
        if (format === "rgba16float" && !mount.resourceTextures.has("color")) {
          refused = true;
          expect(internals.textureBytes.has(previous)).toBe(false);
          throw refusal;
        }
        return allocate(width, height, format, usage, mipLevels);
      });
    await active.scan();
    await expect(active.renderAt(0)).rejects.toMatchObject({
      code: "native-render-incomplete",
    });
    expect(refused).toBe(true);
    expect(mount.resourceTextures.has("color")).toBe(false);
    expect(previous.destroy).toHaveBeenCalledOnce();
    allocation.mockRestore();
    await expect(active.renderAt(0)).resolves.toMatchObject({ failures: [] });
    const replacement = mount.resourceTextures.get("color");
    expect(replacement?.format).toBe("rgba16float");
    expect(replacement).not.toBe(previous);
    expect(internals.textureBytes.has(replacement!)).toBe(true);
    expect(previous.destroy).toHaveBeenCalledOnce();
  });

  it("rejects missing synthetic-scene bytes before GPU submission and permits a later clean export", async () => {
    const { state } = fakeGpu();
    const active = await startRuntime();
    const internals = active as unknown as {
      ensureCompositionBudget(
        surface: {
          instance?: unknown;
          resourceTextures: Map<string, unknown>;
        },
        bytes: number,
      ): void;
    };
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalBudget = internals.ensureCompositionBudget.bind(internals);
    const unregistered = { destroy: vi.fn() };
    const budget = vi
      .spyOn(internals, "ensureCompositionBudget")
      .mockImplementation((surface, bytes) => {
        if (!surface.instance)
          surface.resourceTextures.set("unregistered", unregistered);
        originalBudget(surface, bytes);
      });
    await expect(
      active.renderCompositionFramePixels(frame),
    ).rejects.toMatchObject({
      name: "NativeSourceError",
      code: "source-composition-bytes-unavailable",
      message: "source-composition-bytes-unavailable",
    });
    expect(state.submitted).toBe(0);
    expect(state.mapped).toBe(0);
    expect(diagnostic.mock.calls[0]).toHaveLength(1);
    const incompleteLine = diagnostic.mock.calls[0]![0];
    if (typeof incompleteLine !== "string")
      throw new Error("Budget diagnostic is not a serialized string.");
    const incompletePrefix = "native-composition-bytes-unavailable: ";
    expect(incompleteLine.startsWith(incompletePrefix)).toBe(true);
    expect(
      JSON.parse(incompleteLine.slice(incompletePrefix.length)),
    ).toMatchObject({
      surface: "scene",
      instanceId: null,
      width: 2,
      height: 2,
      status: "incomplete",
      currentBytes: null,
      exceeds: null,
      missingTextures: 1,
      familyMissingTextures: {
        resource: 1,
        feedback: 0,
        source: 0,
        asset: 0,
        isolation: 0,
      },
    });
    expect(unregistered.destroy).toHaveBeenCalledOnce();
    budget.mockRestore();
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({ width: 2, height: 2 });
    expect(state.submitted).toBe(1);
  });

  it("preserves the known cap error and accepts a registered zero through the global runtime", async () => {
    fakeGpu();
    const active = await startRuntime();
    const internals = active as unknown as {
      textureBytes: Map<object, number>;
      ensureCompositionBudget(
        surface: Record<string, unknown>,
        bytes: number,
      ): void;
    };
    const zero = {};
    const known = {};
    internals.textureBytes.set(zero, 0);
    internals.textureBytes.set(known, 17);
    const surface = {
      target: document.documentElement,
      width: 2,
      height: 2,
      pixelRatio: 1,
      resourceTextures: new Map([
        ["zero", zero],
        ["known", known],
      ]),
      sourceTextures: new Map(),
      isolationTextures: new Map(),
    };
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      internals.ensureCompositionBudget(surface, 134_217_728 - 17),
    ).not.toThrow();
    expect(diagnostic).not.toHaveBeenCalled();
    expect(() =>
      internals.ensureCompositionBudget(surface, 134_217_728 - 16),
    ).toThrowError(
      expect.objectContaining({
        name: "NativeSourceError",
        code: "source-composition-budget-exceeded",
        message:
          "The source and isolated groups exceed the per-instance texture budget.",
      }),
    );
    expect(diagnostic.mock.calls[0]).toHaveLength(1);
    const exceededLine = diagnostic.mock.calls[0]![0];
    if (typeof exceededLine !== "string")
      throw new Error("Budget diagnostic is not a serialized string.");
    const exceededPrefix = "native-composition-budget-exceeded: ";
    expect(exceededLine.startsWith(exceededPrefix)).toBe(true);
    expect(JSON.parse(exceededLine.slice(exceededPrefix.length))).toMatchObject(
      {
        surface: "scene",
        status: "complete",
        currentBytes: 17,
        missingTextures: 0,
        limitBytes: 134_217_728,
        exceeds: true,
      },
    );
    internals.textureBytes.delete(zero);
    expect(() => internals.ensureCompositionBudget(surface, 0)).toThrowError(
      expect.objectContaining({ code: "source-composition-bytes-unavailable" }),
    );
    internals.textureBytes.delete(known);
  });

  it("presents a final same-target Layer instead of its consumed Fill", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    source.instances.push({
      ...source.instances[0],
      id: "test-final-layer",
      definitionId: processor.id,
      definitionVersion: processor.version,
      placement: "layer",
      params: { mix: 0 },
    });
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const fill = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-instance"]',
    );
    const layer = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-final-layer"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!fill || !layer || !target)
      throw new Error("The Fill and Layer were not mounted.");
    expect(fill.style.visibility).toBe("hidden");
    expect(layer.style.visibility).toBe("visible");
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "test-final-layer",
    );
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });
    const setAttribute = target.setAttribute.bind(target);
    const layerMarker = vi
      .spyOn(target, "setAttribute")
      .mockImplementation((name, value) => {
        if (name !== "data-an-native-layer-instance") setAttribute(name, value);
      });
    target.removeAttribute("data-an-native-layer-instance");
    await expect(
      active.renderCompositionFramePixels(frame),
    ).rejects.toMatchObject({
      code: "composition-native-record-missing",
    });
    layerMarker.mockRestore();
    source.instances.pop();
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(fill.style.visibility).toBe("visible");
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });
  });

  it("keeps the surviving same-target Layer and Fill status after another mount is removed", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !target)
      throw new Error("Same-target lifecycle fixture unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    for (const id of ["test-first-layer", "test-final-layer"])
      source.instances.push({
        ...source.instances[0],
        id,
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      });
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(target.getAttribute("data-an-native-backend")).toBe("webgpu");
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          previousLayerId?: string;
          previousFillId?: string;
          isTopLayer: boolean;
        }
      >;
    };
    expect(internals.mounts.get("test-final-layer")).toMatchObject({
      previousLayerId: "test-first-layer",
      previousFillId: undefined,
      isTopLayer: true,
    });

    source.instances.splice(1, 1);
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(target.getAttribute("data-an-native-status")).toBe("ready");
    expect(target.getAttribute("data-an-native-backend")).toBe("webgpu");
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "test-final-layer",
    );
    expect(internals.mounts.get("test-final-layer")).toMatchObject({
      previousLayerId: undefined,
      previousFillId: undefined,
      isTopLayer: true,
    });
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });

    source.instances.pop();
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(target.getAttribute("data-an-native-status")).toBe("ready");
    expect(target.getAttribute("data-an-native-backend")).toBe("webgpu");
    expect(target.hasAttribute("data-an-native-fill-suppressed")).toBe(true);
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });

    source.instances.pop();
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(target.hasAttribute("data-an-native-status")).toBe(false);
    expect(target.hasAttribute("data-an-native-backend")).toBe(false);
  });

  it("reveals the prior same-target Layer after removing the top Layer, then the Fill", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !target)
      throw new Error("Same-target lifecycle fixture unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    for (const id of ["test-first-layer", "test-final-layer"])
      source.instances.push({
        ...source.instances[0],
        id,
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      });
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          previousLayerId?: string;
          previousFillId?: string;
          isTopLayer: boolean;
        }
      >;
    };
    expect(internals.mounts.get("test-final-layer")).toMatchObject({
      previousLayerId: "test-first-layer",
      previousFillId: undefined,
      isTopLayer: true,
    });

    source.instances.pop();
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(internals.mounts.has("test-final-layer")).toBe(false);
    expect(internals.mounts.get("test-first-layer")).toMatchObject({
      previousLayerId: undefined,
      previousFillId: undefined,
      isTopLayer: true,
    });
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "test-first-layer",
    );
    expect(target.getAttribute("data-an-native-status")).toBe("ready");
    expect(target.getAttribute("data-an-native-backend")).toBe("webgpu");
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });

    source.instances.pop();
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(target.hasAttribute("data-an-native-layer-instance")).toBe(false);
    expect(target.getAttribute("data-an-native-fill-instance")).toBe(
      "test-instance",
    );
    expect(target.getAttribute("data-an-native-status")).toBe("ready");
    expect(target.getAttribute("data-an-native-backend")).toBe("webgpu");
    await expect(
      active.renderCompositionFramePixels(frame),
    ).resolves.toMatchObject({
      width: 2,
      height: 2,
    });
  });

  it("reports a surviving top Layer source failure without restoring a ready status", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    if (!manifest?.textContent || !target)
      throw new Error("Same-target lifecycle fixture unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    for (const id of ["test-first-layer", "test-final-layer"])
      source.instances.push({
        ...source.instances[0],
        id,
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      });
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          provider: { readScene: () => Promise<unknown[]> } | null;
          previousLayerId?: string;
        }
      >;
    };
    const surviving = internals.mounts.get("test-first-layer");
    if (!surviving?.provider)
      throw new Error("The surviving Layer source is unavailable.");
    const readScene = surviving.provider.readScene;
    surviving.provider.readScene = async () => {
      throw new Error("Deliberate surviving Layer source failure.");
    };

    source.instances.pop();
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    expect(internals.mounts.get("test-first-layer")?.previousLayerId).toBe(
      undefined,
    );
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "test-first-layer",
    );
    expect(target.getAttribute("data-an-native-status")).toBe("last-good");
    expect(target.getAttribute("data-an-native-error")).toBe("render-failed");
    expect(target.getAttribute("data-an-native-backend")).toBe("webgpu");
    const observed: Array<{
      instanceId: string;
      status: string;
      backend: string;
      code?: string;
    }> = [];
    const onStatus = (event: Event) => {
      observed.push((event as CustomEvent<(typeof observed)[number]>).detail);
    };
    window.addEventListener("native-shader-status", onStatus);
    try {
      active.requestStatusSnapshot();
      expect(observed).toContainEqual(
        expect.objectContaining({
          instanceId: "test-first-layer",
          status: "last-good",
          backend: "webgpu",
          code: "render-failed",
        }),
      );
      surviving.provider.readScene = readScene;
      await active.renderAt(0);
      observed.length = 0;
      active.requestStatusSnapshot();
      const recovered = observed.find(
        (status) => status.instanceId === "test-first-layer",
      );
      expect(recovered).toMatchObject({ status: "ready", backend: "webgpu" });
      expect(recovered?.code).toBeUndefined();
    } finally {
      window.removeEventListener("native-shader-status", onStatus);
    }
  });

  it("keeps a consumed Fill hidden when a failed final Layer reveals the prior Layer", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest unavailable.");
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Owned processor missing.");
    source.definitions.push(processor);
    for (const id of ["test-first-layer", "test-final-layer"])
      source.instances.push({
        ...source.instances[0],
        id,
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "layer",
        params: { mix: 0 },
      });
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const fill = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-instance"]',
    );
    const first = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-first-layer"]',
    );
    const final = document.querySelector<HTMLCanvasElement>(
      'canvas[data-an-native-canvas="test-final-layer"]',
    );
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const internals = active as unknown as {
      mounts: Map<string, unknown>;
      showOriginal(mount: unknown): void;
    };
    if (!fill || !first || !final || !target)
      throw new Error("The Fill and both Layers were not mounted.");
    expect(fill.style.visibility).toBe("hidden");
    expect(final.style.visibility).toBe("visible");
    internals.showOriginal(internals.mounts.get("test-final-layer"));
    expect(target.getAttribute("data-an-native-layer-instance")).toBe(
      "test-first-layer",
    );
    expect(first.style.visibility).toBe("visible");
    expect(final.style.visibility).toBe("hidden");
    expect(fill.style.visibility).toBe("hidden");
  });

  it("compiles CSS-domain Fill phases from the generated runtime", async () => {
    const { state } = fakeGpu();
    await startRuntime(true);
    expect(
      state.shaderCodes.some((code) =>
        code.includes("fn cssSourceOver(front: vec4f, back: vec4f)"),
      ),
    ).toBe(true);
    expect(
      state.shaderCodes.some((code) =>
        code.includes("let sampledInner = textureSample(innerCoverage"),
      ),
    ).toBe(true);
  });

  it("compiles SDR CSS scene blend and linear decode for held composition", async () => {
    const { state } = fakeGpu();
    const active = await startRuntime(true);
    await active.renderCompositionFramePixels(frame);
    expect(
      state.shaderCodes.some((code) => code.includes("fn cssEncode(v: f32)")),
    ).toBe(true);
    expect(
      state.shaderCodes.some((code) =>
        code.includes("let encoded = textureSample(source, samp, input.uv)"),
      ),
    ).toBe(true);
  });

  it("does not activate SDR CSS scene decode for Display P3", async () => {
    const { state } = fakeGpu({ p3Supported: true });
    const active = await startRuntime(true, {
      quality: "quality",
      frameRateTarget: 60,
      colorMode: "display-p3",
      dynamicRange: "sdr",
    });
    await active.renderCompositionFramePixels(frame);
    expect(
      state.shaderCodes.some((code) =>
        code.includes("let encoded = textureSample(source, samp, input.uv)"),
      ),
    ).toBe(false);
  });

  it("renders interactive Performance density and restores it after exact-density export", async () => {
    fakeGpu();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });
    const active = await startRuntime(true, {
      quality: "performance",
      frameRateTarget: 120,
    });
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    if (!canvas) throw new Error("Native presentation canvas was not mounted.");
    expect(active.previewStatus()).toMatchObject({
      requestedQuality: "performance",
      frameRateTarget: 120,
      devicePixelRatio: 2,
      effectivePixelRatio: 1.5,
    });
    expect(canvas.width).toBe(3);
    const pixels = await active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
    });
    expect(pixels.width).toBe(4);
    expect(canvas.width).toBe(3);
    expect(
      document.documentElement.getAttribute(
        "data-an-native-preview-pixel-ratio",
      ),
    ).toBe("1.5");
  });
  it("uses the trusted export ratio for its first mount and keeps exact density after a held frame", async () => {
    fakeGpu();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });
    const active = await startRuntime(
      true,
      { quality: "performance", frameRateTarget: 120 },
      "1",
    );
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    if (!canvas) throw new Error("Native presentation canvas was not mounted.");
    expect(active.previewStatus()).toMatchObject({
      devicePixelRatio: 2,
      effectivePixelRatio: 1,
      requestedQuality: "performance",
    });
    expect(canvas.width).toBe(2);
    const pixels = await active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 1,
    });
    expect(pixels.width).toBe(2);
    expect(canvas.width).toBe(2);
  });

  it("rejects a present but malformed export ratio before mounting", async () => {
    fakeGpu();
    await expect(
      startRuntime(true, undefined, "Infinity"),
    ).rejects.toMatchObject({
      code: "export-initial-density-invalid",
    });
  });
  it("reallocates the native presentation when an authored preview policy changes", async () => {
    fakeGpu();
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });
    const active = await startRuntime(true, {
      quality: "quality",
      frameRateTarget: 60,
    });
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!canvas || !manifest?.textContent)
      throw new Error("Native preview fixture was not mounted.");
    expect(canvas.width).toBe(4);
    const authored = JSON.parse(manifest.textContent) as {
      preview: {
        quality: "quality" | "performance";
        frameRateTarget: 60 | 120;
      };
    };
    authored.preview = { quality: "performance", frameRateTarget: 120 };
    manifest.textContent = JSON.stringify(authored);
    await active.scan();
    expect(canvas.width).toBe(3);
    expect(active.previewStatus()).toMatchObject({
      requestedQuality: "performance",
      effectivePixelRatio: 1.5,
      frameRateTarget: 120,
    });
  });
  it("replays persisted color policy on a fresh runtime and reconfigures a mounted preview once when it changes", async () => {
    const { state } = fakeGpu({ p3Supported: true });
    const active = await startRuntime(true, {
      quality: "quality",
      frameRateTarget: 60,
      colorMode: "display-p3",
      dynamicRange: "sdr",
    });
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent)
      throw new Error("Native preview fixture has no manifest.");
    expect(
      document.documentElement.getAttribute("data-an-native-color-requested"),
    ).toBe("display-p3");
    expect(
      document.documentElement.getAttribute("data-an-native-color-presented"),
    ).toBe("display-p3");
    expect(
      state.textures.some((texture) => texture.format === "rgba16float"),
    ).toBe(true);
    const exported = await active.renderCompositionFramePixels(frame);
    expect(exported).toMatchObject({
      width: 2,
      height: 2,
      colorSpace: "srgb",
      alpha: "straight",
    });
    const authored = JSON.parse(manifest.textContent) as {
      preview: {
        quality: "quality";
        frameRateTarget: 60;
        colorMode: "display-p3" | "srgb";
        dynamicRange: "sdr";
      };
    };
    authored.preview.colorMode = "srgb";
    manifest.textContent = JSON.stringify(authored);
    await active.scan();
    expect(
      document.documentElement.getAttribute("data-an-native-color-presented"),
    ).toBe("srgb");
    expect(
      document.querySelector('[data-an-native-status="ready"]'),
    ).not.toBeNull();
    const textureCount = state.textures.length;
    await active.scan();
    expect(state.textures.length).toBe(textureCount);
  });
  it("keeps an authored HDR request visible when the canvas falls back to SDR", async () => {
    fakeGpu({ toneMappingStandard: "observed" });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (media: string) => ({
        matches: media === "(dynamic-range: high)",
      }),
    });
    const active = await startRuntime(true, {
      quality: "quality",
      frameRateTarget: 60,
      dynamicRange: "hdr",
    });
    expect(active.colorCapability()).toMatchObject({
      requestedDynamicRange: "hdr",
      presentedDynamicRange: "sdr",
      dynamicRangeReason: "float-canvas-unavailable",
    });
    expect(
      document.documentElement.getAttribute(
        "data-an-native-dynamic-range-requested",
      ),
    ).toBe("hdr");
    expect(
      document.documentElement.getAttribute(
        "data-an-native-dynamic-range-presented",
      ),
    ).toBe("sdr");
  });
  it("reports top-level native status and replays it to a late standalone listener", async () => {
    fakeGpu();
    const observed: Array<{
      runtimeEpoch: string;
      instanceId: string;
      nodeId: string;
      status: string;
      backend: string;
      code?: string;
    }> = [];
    const onStatus = (event: Event) => {
      observed.push((event as CustomEvent<(typeof observed)[number]>).detail);
    };
    window.addEventListener("native-shader-status", onStatus);
    try {
      const active = await startRuntime(true);
      expect(observed).toContainEqual(
        expect.objectContaining({
          instanceId: "test-instance",
          nodeId: "test-target",
          status: "ready",
          backend: "webgpu",
        }),
      );
      observed.length = 0;
      active.requestStatusSnapshot();
      expect(observed).toContainEqual(
        expect.objectContaining({
          instanceId: "test-instance",
          status: "ready",
          backend: "webgpu",
        }),
      );
      const epoch = observed[0]?.runtimeEpoch;
      expect(epoch).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
      observed.length = 0;
      (
        active as unknown as {
          clearDeviceResources(code: string, message: string): void;
        }
      ).clearDeviceResources("device-lost", "GPU device lost");
      expect(observed).toContainEqual(
        expect.objectContaining({
          runtimeEpoch: epoch,
          instanceId: "test-instance",
          status: "error",
          backend: "unavailable",
          code: "device-lost",
        }),
      );
    } finally {
      window.removeEventListener("native-shader-status", onStatus);
    }
  });

  it("reads zero exact mount output separately from an opaque full-scene held frame", async () => {
    const { state } = fakeGpu({ mountedReadbackZero: true });
    const active = await startRuntime(true);
    const mount = (
      active as unknown as {
        mounts: Map<string, { definitionHash: string }>;
      }
    ).mounts.get("test-instance");
    if (!mount) throw new Error("Expected the mounted native Fill.");
    const held = await active.renderCompositionFrameValidated(frame, {
      instanceId: "test-instance",
      nodeId: "test-target",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: mount.definitionHash,
    });
    expect(held.pixels.rgba.some((value) => value > 0)).toBe(true);
    expect(held.mountOutput).toMatchObject({
      instanceId: "test-instance",
      width: 2,
      height: 2,
      nonTransparentPixels: 0,
      nonZeroRgbaPixels: 0,
    });
    expect(
      state.buffers.every((buffer) => buffer.destroy.mock.calls.length),
    ).toBe(true);
  });

  it("rejects a pending or changed exact mount instead of validating last-good pixels", async () => {
    fakeGpu({ mountedReadbackZero: true });
    const active = await startRuntime(true);
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          definitionHash: string;
          reportedStatus: { status: string } | null;
        }
      >;
      readMountedOutput(
        target: {
          instanceId: string;
          nodeId: string;
          definitionId: string;
          definitionVersion: number;
          executionHash: string;
        },
        signal: AbortSignal,
      ): Promise<unknown>;
    };
    const mount = internals.mounts.get("test-instance");
    if (!mount) throw new Error("Expected the mounted native Fill.");
    const target = {
      instanceId: "test-instance",
      nodeId: "test-target",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      executionHash: mount.definitionHash,
    };
    mount.reportedStatus = { status: "last-good" };
    await expect(
      internals.readMountedOutput(target, new AbortController().signal),
    ).rejects.toMatchObject({ code: "mounted-output-target-unready" });
    mount.reportedStatus = { status: "ready" };
    await expect(
      internals.readMountedOutput(
        { ...target, executionHash: "a".repeat(64) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "mounted-output-target-unready" });
  });

  it("uses float composition for a verified P3 canvas and reports sRGB-limited DOM sources", async () => {
    const { state } = fakeGpu({
      p3Supported: true,
      toneMappingStandard: "observed",
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (media: string) => ({
        matches: media === "(dynamic-range: high)",
      }),
    });
    const active = await startRuntime(true);
    const capability = await active.setColorMode("display-p3");
    expect(capability).toEqual({
      requested: "display-p3",
      presented: "display-p3",
      sourceGamut: "dom-srgb-only",
      hdr: "unavailable",
      outputDynamicRange: "sdr",
      requestedDynamicRange: "sdr",
      presentedDynamicRange: "sdr",
      displayDynamicRangeCapability: "high-capable",
      canvasToneMappingStandard: "observed",
    });
    expect(
      state.textures.some((texture) => texture.format === "rgba16float"),
    ).toBe(true);
    expect(
      document.documentElement.getAttribute("data-an-native-color-presented"),
    ).toBe("display-p3");
  });

  it("samples the exact held rgba16float final mount with aligned GPU copies and releases its map", async () => {
    const { state } = fakeGpu({
      p3Supported: true,
      toneMappingStandard: "observed",
      linearSampleBits: [0x3800, 0xc000, 0x4000, 0x3c00],
    });
    const active = await startRuntime(true);
    await active.setColorMode("display-p3");
    const internals = active as unknown as {
      mounts: Map<string, object>;
      activeMounts: Set<object>;
      readLinearGoldenMount(
        target: {
          instanceId: string;
          nodeId: string;
          expectedLinearSamples: readonly {
            x: number;
            y: number;
            expected: readonly [number, number, number, number];
            tolerance: number;
          }[];
        },
        signal: AbortSignal,
      ): Promise<{ passed: boolean }>;
    };
    const result = await active.renderCompositionFrameGolden(frame, {
      instanceId: "test-instance",
      nodeId: "test-target",
      expectedLinearSamples: [
        { x: 1, y: 0, expected: [0.5, -2, 2, 1], tolerance: 0.001 },
      ],
    });
    expect(result.linearGolden).toEqual({
      sampleCount: 1,
      maxAbsError: 0,
      passed: true,
    });
    expect(result.pixels).toMatchObject({ width: 2, height: 2 });
    const existingMount = internals.mounts.get("test-instance")!;
    internals.activeMounts.add(existingMount);
    const nested = await internals.readLinearGoldenMount(
      {
        instanceId: "test-instance",
        nodeId: "test-target",
        expectedLinearSamples: [
          { x: 1, y: 0, expected: [0.5, -2, 2, 1], tolerance: 0.001 },
        ],
      },
      new AbortController().signal,
    );
    expect(nested.passed).toBe(true);
    expect(internals.activeMounts.has(existingMount)).toBe(true);
    expect(state.copied).toBeGreaterThanOrEqual(2);
    expect(
      state.textures.some(
        (texture) =>
          texture.format === "rgba16float" && (texture.usage & 1) !== 0,
      ),
    ).toBe(true);
    expect(
      state.buffers.filter((buffer) => buffer.destroy.mock.calls.length),
    ).toHaveLength(state.buffers.length);
  });

  it("reports a typed SDR fallback when P3 canvas configuration cannot be verified", async () => {
    fakeGpu({ toneMappingStandard: "member-not-observed" });
    const active = await startRuntime(true);
    const capability = await active.setColorMode("display-p3");
    expect(capability).toMatchObject({
      requested: "display-p3",
      presented: "srgb",
      reason: "p3-canvas-unavailable",
      hdr: "unavailable",
      outputDynamicRange: "sdr",
      canvasToneMappingStandard: "member-not-observed",
    });
  });

  it("does not call a failed standard tone-mapping probe HDR support", async () => {
    fakeGpu({ toneMappingStandard: "unreadable" });
    const active = await startRuntime(true);
    await expect(active.setColorMode("srgb")).resolves.toMatchObject({
      outputDynamicRange: "sdr",
      hdr: "unavailable",
      canvasToneMappingStandard: "unreadable",
    });
  });

  it("holds the live native canvas and export density until a trusted vector consumer settles", async () => {
    const { state } = fakeGpu();
    const active = await startRuntime(true);
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    if (!canvas) throw new Error("Native presentation canvas was not mounted.");
    let entered!: () => void;
    let release!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = active.renderCompositionVectorFrame(
      { ...frame, pixelRatio: 2 },
      async (held) => {
        expect(held.document).toBe(document);
        expect(held.runtimeCanvases).toEqual([canvas]);
        expect(held.pixels).toMatchObject({ width: 4, height: 4 });
        expect(held.viewport).toEqual({ width: 2, height: 2 });
        expect(held.pixelRatio).toBe(2);
        expect(held.signal.aborted).toBe(false);
        expect(canvas.width).toBe(4);
        entered();
        await hold;
        return "<svg/>";
      },
    );
    await called;
    await expect(active.renderCompositionFrame(frame)).rejects.toMatchObject({
      code: "composition-busy",
    });
    release();
    await expect(pending).resolves.toBe("<svg/>");
    expect(canvas.width).toBe(2);
    expect(state.copied).toBe(1);
  });

  it("restores preview density after a held vector consumer rejects", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    if (!canvas) throw new Error("Native presentation canvas was not mounted.");
    const failure = new Error("vector assembly failed");
    await expect(
      active.renderCompositionVectorFrame(
        { ...frame, pixelRatio: 2 },
        async (held) => {
          expect(held.signal.aborted).toBe(false);
          expect(canvas.width).toBe(4);
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(canvas.width).toBe(2);
    await expect(active.renderCompositionFrame(frame)).resolves.toMatchObject({
      frameIndex: 0,
    });
  });

  it("rejects an unready native presentation canvas instead of returning incomplete vector pixels", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const canvas = document.querySelector("canvas[data-an-native-canvas]");
    if (!canvas) throw new Error("Native presentation canvas was not mounted.");
    Object.defineProperty(canvas, "isConnected", { value: false });
    const consume = vi.fn(async () => "<svg/>");
    await expect(
      active.renderCompositionVectorFrame(frame, consume),
    ).rejects.toMatchObject({ code: "composition-instance-unready" });
    expect(consume).not.toHaveBeenCalled();
  });

  it("returns only tight straight-sRGB rows after a completed GPU map and releases transient resources", async () => {
    const { state } = fakeGpu();
    const active = await startRuntime();
    const result = await active.renderCompositionFramePixels(frame);
    expect(result).toMatchObject({
      width: 2,
      height: 2,
      colorSpace: "srgb",
      alpha: "straight",
    });
    expect([...result.rgba]).toEqual([
      10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 64, 100, 110, 120, 0,
    ]);
    expect(state.submitted).toBe(1);
    expect(state.copied).toBe(1);
    expect(state.mapped).toBe(1);
    expect(state.buffers[0].destroy).toHaveBeenCalledOnce();
    expect(
      state.textures
        .slice(2)
        .every((texture) => texture.destroy.mock.calls.length === 1),
    ).toBe(true);
  });

  it("preserves validation and map failures, restores the frame clock, and releases buffers/textures", async () => {
    for (const config of [{ validationError: true }, { mapError: true }]) {
      const { state } = fakeGpu(config);
      const active = await startRuntime();
      await expect(
        active.renderCompositionFramePixels(frame),
      ).rejects.toMatchObject({
        code: config.validationError ? "gpu-validation" : "gpu-readback-failed",
      });
      expect(state.buffers[0].destroy).toHaveBeenCalledOnce();
      expect(
        state.textures
          .slice(2)
          .every((texture) => texture.destroy.mock.calls.length === 1),
      ).toBe(true);
      await expect(active.renderCompositionFrame(frame)).resolves.toMatchObject(
        {
          value: { failures: [] },
        },
      );
      active.dispose();
      document.body.replaceChildren();
    }
  });

  it("cancels a pending GPU map before restoring the source clock", async () => {
    const { state, mapStarted } = fakeGpu({ waitForAbort: true });
    const active = await startRuntime();
    const controller = new AbortController();
    const pending = active.renderCompositionFramePixels({
      ...frame,
      signal: controller.signal,
    });
    await mapStarted;
    controller.abort(new Error("cancel export"));
    await expect(pending).rejects.toMatchObject({
      code: "composition-aborted",
    });
    expect(state.buffers[0].destroy).toHaveBeenCalled();
    await expect(active.renderCompositionFrame(frame)).resolves.toMatchObject({
      value: { failures: [] },
    });
  });

  it("rejects another export density while the first synchronized frame owns the runtime", async () => {
    const { state, mapStarted } = fakeGpu({ waitForAbort: true });
    const active = await startRuntime(true);
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    const controller = new AbortController();
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
      signal: controller.signal,
    });
    await mapStarted;
    expect(canvas?.width).toBe(4);
    await expect(
      active.renderCompositionFramePixels({ ...frame, pixelRatio: 3 }),
    ).rejects.toMatchObject({ code: "composition-busy" });
    expect(canvas?.width).toBe(4);
    controller.abort(new Error("cancel first export"));
    await expect(pending).rejects.toMatchObject({
      code: "composition-aborted",
    });
    expect(canvas?.width).toBe(2);
    expect(state.canvasWidths[state.canvasWidths.length - 1]).toBe(2);
  });

  it("keeps the pixel operation locked until preview density restoration settles", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    active.pause();
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    const engine = active as PixelRuntime & {
      renderInternal(time: number, strict: boolean): Promise<unknown>;
    };
    const originalRender = engine.renderInternal.bind(engine);
    let releasePreview!: () => void;
    let previewEntered!: () => void;
    const previewGate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    const previewStarted = new Promise<void>((resolve) => {
      previewEntered = resolve;
    });
    let renders = 0;
    engine.renderInternal = async (time, strict) => {
      renders += 1;
      if (renders === 2) {
        previewEntered();
        await previewGate;
      }
      return originalRender(time, strict);
    };
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
    });
    await previewStarted;
    expect(canvas?.width).toBe(4);
    await expect(
      active.renderCompositionFramePixels({ ...frame, pixelRatio: 3 }),
    ).rejects.toMatchObject({ code: "composition-busy" });
    await expect(active.renderCompositionFrame(frame)).rejects.toMatchObject({
      code: "composition-busy",
    });
    expect(canvas?.width).toBe(4);
    releasePreview();
    await expect(pending).resolves.toMatchObject({ width: 4, height: 4 });
    expect(canvas?.width).toBe(2);
  });

  it("fails a nonsettling preview restore and defers disposal until its GPU work settles", async () => {
    const { state, previewRestoreEntered, releasePreviewRestore } = fakeGpu({
      holdPreviewRestore: true,
    });
    const active = await startRuntime(true);
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
      timeoutMs: 20,
    });
    await previewRestoreEntered;
    await expect(pending).rejects.toMatchObject({
      code: "composition-render-unsettled",
    });
    await expect(active.renderCompositionFrame(frame)).rejects.toMatchObject({
      code: "composition-restore-failed",
    });
    const retained = state.textures.filter(
      (texture) => texture.destroy.mock.calls.length === 0,
    );
    active.dispose();
    expect(
      retained.every((texture) => texture.destroy.mock.calls.length === 0),
    ).toBe(true);
    releasePreviewRestore();
    await vi.waitFor(() => {
      expect(
        retained.every((texture) => texture.destroy.mock.calls.length > 0),
      ).toBe(true);
    });
  });

  it("holds resources when an abort interrupts preview restoration before reset", async () => {
    const { state, previewRestoreEntered, releasePreviewRestore } = fakeGpu({
      holdPreviewRestore: true,
    });
    const active = await startRuntime(true);
    const controller = new AbortController();
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
      signal: controller.signal,
    });
    await previewRestoreEntered;
    controller.abort(new Error("cancel during preview restoration"));
    await expect(pending).rejects.toMatchObject({
      code: "composition-render-unsettled",
    });
    const retained = state.textures.filter(
      (texture) => texture.destroy.mock.calls.length === 0,
    );
    const resetting = active.resetDevice();
    expect(
      retained.every((texture) => texture.destroy.mock.calls.length === 0),
    ).toBe(true);
    releasePreviewRestore();
    await expect(resetting).rejects.toMatchObject({
      code: "composition-restore-failed",
    });
    expect(
      retained.every((texture) => texture.destroy.mock.calls.length > 0),
    ).toBe(true);
  });

  it("retains a readback failure alongside a later preview restore timeout", async () => {
    const { previewRestoreEntered, releasePreviewRestore } = fakeGpu({
      mapError: true,
      holdPreviewRestore: true,
    });
    const active = await startRuntime(true);
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
      timeoutMs: 20,
    });
    await previewRestoreEntered;
    await expect(pending).rejects.toMatchObject({
      code: "gpu-cleanup-failed",
      causes: [
        { code: "gpu-readback-failed" },
        { code: "composition-render-unsettled" },
      ],
    });
    releasePreviewRestore();
  });

  it("keeps an animated authored source paused until preview density restoration finishes", async () => {
    const { previewRestoreEntered, releasePreviewRestore } = fakeGpu({
      holdPreviewRestore: true,
    });
    const active = await startRuntime(true);
    const target = document.querySelector("[data-agent-native-node-id]");
    const pause = vi.fn();
    const play = vi.fn();
    const animation = {
      effect: { target, getComputedTiming: () => ({ endTime: 1_000 }) },
      timeline: document.timeline,
      currentTime: 500,
      playState: "running",
      playbackRate: 1,
      ready: Promise.resolve(),
      pause,
      play,
    } as unknown as Animation;
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [animation],
    });
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
    });
    await previewRestoreEntered;
    expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(animation.currentTime).toBe(0);
    releasePreviewRestore();
    await expect(pending).resolves.toMatchObject({ width: 4, height: 4 });
    expect(animation.currentTime).toBe(500);
    expect(play).toHaveBeenCalledOnce();
  });

  it("resumes ordinary playback only after preview density is restored", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    const engine = active as PixelRuntime & {
      compositionPixelBusy: boolean;
      compositionPixelRatio: number | null;
      renderInternal(time: number, strict: boolean): Promise<unknown>;
    };
    const originalRender = engine.renderInternal.bind(engine);
    const renders: Array<{
      strict: boolean;
      busy: boolean;
      ratio: number | null;
      width: number | undefined;
    }> = [];
    engine.renderInternal = async (time, strict) => {
      renders.push({
        strict,
        busy: engine.compositionPixelBusy,
        ratio: engine.compositionPixelRatio,
        width: canvas?.width,
      });
      return originalRender(time, strict);
    };
    await active.renderCompositionFramePixels({ ...frame, pixelRatio: 2 });
    expect(renders).toContainEqual({
      strict: true,
      busy: true,
      ratio: null,
      width: 4,
    });
    const ordinary = renders.filter((render) => !render.strict);
    expect(ordinary.length).toBeGreaterThan(0);
    expect(
      ordinary.every(
        (render) => !render.busy && render.ratio === null && render.width === 2,
      ),
    ).toBe(true);
    active.pause();
  });

  it("reserves export, drains an active preview and scan, then renders within one deadline", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    active.pause();
    const engine = active as PixelRuntime & {
      running: Promise<unknown> | null;
      scanning: Promise<void> | null;
    };
    let releaseRender!: () => void;
    let releaseScan!: () => void;
    engine.running = new Promise<void>((resolve) => {
      releaseRender = () => {
        engine.running = null;
        resolve();
      };
    });
    engine.scanning = new Promise<void>((resolve) => {
      releaseScan = () => {
        engine.scanning = null;
        resolve();
      };
    });
    const pending = active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
      timeoutMs: 1_000,
    });
    await expect(active.renderCompositionFrame(frame)).rejects.toMatchObject({
      code: "composition-busy",
    });
    releaseRender();
    releaseScan();
    await expect(pending).resolves.toMatchObject({ width: 4, height: 4 });
  });

  it("reports a bounded timeout and holds the runtime if an in-flight preview never settles", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const engine = active as PixelRuntime & {
      running: Promise<unknown> | null;
    };
    engine.running = new Promise(() => {});
    await expect(
      active.renderCompositionFramePixels({
        ...frame,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "composition-timeout" });
    await expect(active.renderCompositionFrame(frame)).rejects.toMatchObject({
      code: "composition-restore-failed",
    });
  });

  it("renders a native mount at requested export density and restores preview density", async () => {
    const { state } = fakeGpu();
    const active = await startRuntime(true);
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas[data-an-native-canvas]",
    );
    expect(canvas?.width).toBe(2);
    const result = await active.renderCompositionFramePixels({
      ...frame,
      pixelRatio: 2,
    });
    expect(result).toMatchObject({ width: 4, height: 4 });
    expect(state.canvasWidths).toContain(4);
    expect(canvas?.width).toBe(2);
    expect(state.canvasWidths[state.canvasWidths.length - 1]).toBe(2);
  });
});

it("stops static RAF after ready, retries paused dirty frames, wakes late sources, and disposes its poll", async () => {
  fakeGpu();
  const active = await startRuntime(true);
  const wood = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
    (definition) => definition.id === "an-native-owned-c-wood-endgrain",
  );
  expect(wood).toBeDefined();
  const manifest = document.querySelector<HTMLScriptElement>(
    'script[type="application/x-agent-native-effects"]',
  );
  expect(manifest).not.toBeNull();
  const authored = JSON.parse(manifest!.textContent) as {
    definitions: unknown[];
    instances: { definitionId: string; definitionVersion: number }[];
  };
  authored.definitions = [wood];
  authored.instances[0]!.definitionId = wood!.id;
  authored.instances[0]!.definitionVersion = wood!.version;
  manifest!.textContent = JSON.stringify(authored);
  await active.scan();
  await active.renderAt(0);
  expect(
    document.querySelector('[data-an-native-status="ready"]'),
  ).not.toBeNull();

  const internal = active as PixelRuntime & {
    raf: number;
    playing: boolean;
    previewDirty: boolean;
    running: Promise<unknown> | null;
    mounts: Map<
      string,
      { provider: { needsContinuousFrames(): boolean } | null }
    >;
    frame(): void;
    requestSourceFrame(): void;
    clearIdleSourcePoll(): void;
    currentTime(): number;
    renderInternal(time: number, strict: boolean): Promise<unknown>;
    previewPolicy: { shouldSubmit(time: number, dirty: boolean): boolean };
  };
  if (internal.raf) cancelAnimationFrame(internal.raf);
  internal.raf = 0;
  internal.clearIdleSourcePoll();
  internal.previewDirty = false;
  internal.previewPolicy.shouldSubmit = () => true;
  const render = vi.fn().mockResolvedValue({ failures: [] });
  internal.renderInternal = render;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
  const idleChecks: (() => void)[] = [];
  vi.spyOn(window, "setTimeout").mockImplementation((callback) => {
    idleChecks.push(callback as () => void);
    return idleChecks.length as unknown as ReturnType<typeof window.setTimeout>;
  });

  internal.frame();
  expect(render).toHaveBeenCalledTimes(1);
  expect(raf).not.toHaveBeenCalled();
  expect(idleChecks).toHaveLength(1);
  idleChecks[idleChecks.length - 1]!();
  expect(raf).not.toHaveBeenCalled();

  internal.running = Promise.resolve();
  internal.requestSourceFrame();
  expect(raf).toHaveBeenCalledTimes(1);
  internal.frame();
  expect(render).toHaveBeenCalledTimes(1);
  expect(raf).toHaveBeenCalledTimes(2);
  internal.running = null;
  internal.frame();
  expect(render).toHaveBeenCalledTimes(2);

  active.pause();
  const pausedTime = internal.currentTime();
  internal.running = Promise.resolve();
  internal.requestSourceFrame();
  internal.frame();
  expect(render).toHaveBeenCalledTimes(2);
  internal.running = null;
  internal.frame();
  expect(render).toHaveBeenCalledTimes(3);
  expect(render.mock.calls[render.mock.calls.length - 1]?.[0]).toBe(pausedTime);

  internal.clearIdleSourcePoll();
  internal.raf = 0;
  internal.previewDirty = false;
  const mount = [...internal.mounts.values()][0];
  expect(mount?.provider).not.toBeNull();
  const priorNeedsFrames = mount!.provider!.needsContinuousFrames;
  internal.frame();
  const lateSourcePoll = idleChecks[idleChecks.length - 1];
  expect(lateSourcePoll).toBeDefined();
  mount!.provider!.needsContinuousFrames = () => true;
  const beforeWake = raf.mock.calls.length;
  lateSourcePoll!();
  expect(raf).toHaveBeenCalledTimes(beforeWake + 1);
  expect(render).toHaveBeenCalledTimes(3);
  internal.frame();
  expect(render).toHaveBeenCalledTimes(4);
  mount!.provider!.needsContinuousFrames = priorNeedsFrames;
  internal.clearIdleSourcePoll();
  internal.raf = 0;
  internal.previewDirty = false;
  internal.frame();
  const pendingPoll = idleChecks[idleChecks.length - 1];
  expect(pendingPoll).toBeDefined();
  const beforeDispose = raf.mock.calls.length;
  active.dispose();
  pendingPoll!();
  expect(raf).toHaveBeenCalledTimes(beforeDispose);
  expect(render).toHaveBeenCalledTimes(4);
});

describe("reported status sibling boundaries", () => {
  it("holds last-good during parameter and seek controls until a new frame commits", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const internals = active as unknown as {
      renderInternal: (...args: unknown[]) => Promise<unknown>;
    };
    const originalRender = internals.renderInternal.bind(active);
    const statuses: Array<{
      instanceId: string;
      status: string;
      code?: string;
    }> = [];
    const onStatus = (event: Event) =>
      statuses.push((event as CustomEvent<(typeof statuses)[number]>).detail);
    window.addEventListener("native-shader-status", onStatus);
    try {
      for (const invoke of [
        () => active.setParameters("test-instance", { scale: 1.25 }),
        () => active.setTime(1),
      ]) {
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        internals.renderInternal = async (...args) => {
          entered();
          await held;
          return originalRender(...args);
        };
        try {
          const operation = invoke();
          await started;
          statuses.length = 0;
          active.requestStatusSnapshot();
          expect(
            statuses.find((item) => item.instanceId === "test-instance"),
          ).toMatchObject({
            status: "last-good",
            code: "render-pending",
          });
          release();
          await operation;
          statuses.length = 0;
          active.requestStatusSnapshot();
          expect(
            statuses.find((item) => item.instanceId === "test-instance"),
          ).toMatchObject({ status: "ready" });
        } finally {
          release();
          internals.renderInternal = originalRender;
        }
      }
    } finally {
      window.removeEventListener("native-shader-status", onStatus);
    }
  });

  it("does not report ready for a reused mount while a changed instance awaits rendering", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest missing.");
    const source = JSON.parse(manifest.textContent) as {
      instances: Array<Record<string, unknown>>;
    };
    const internals = active as unknown as {
      mounts: Map<string, { instance: { opacity: number } }>;
      renderInternal: (...args: unknown[]) => Promise<unknown>;
    };
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalRender = internals.renderInternal.bind(active);
    internals.renderInternal = async (...args) => {
      entered();
      await held;
      return originalRender(...args);
    };
    const statuses: Array<{
      instanceId: string;
      status: string;
      code?: string;
      message?: string;
    }> = [];
    const onStatus = (event: Event) =>
      statuses.push((event as CustomEvent<(typeof statuses)[number]>).detail);
    window.addEventListener("native-shader-status", onStatus);
    try {
      source.instances[0]!.opacity = 0.5;
      manifest.textContent = JSON.stringify(source);
      const scanning = active.scan();
      await started;
      expect(internals.mounts.get("test-instance")?.instance.opacity).toBe(0.5);
      active.requestStatusSnapshot();
      const pending = statuses
        .filter((item) => item.instanceId === "test-instance")
        .slice(-1)[0];
      expect(pending?.status).toBe("last-good");
      expect(pending?.code).toBe("render-pending");
      expect(pending?.message).toBe("render-pending");
      release();
      await scanning;
      statuses.length = 0;
      active.requestStatusSnapshot();
      expect(
        statuses.find((item) => item.instanceId === "test-instance"),
      ).toMatchObject({ status: "ready" });
    } finally {
      release();
      internals.renderInternal = originalRender;
      window.removeEventListener("native-shader-status", onStatus);
    }
  });

  it("does not report a hidden Fill sibling ready after a later Fill fails", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!manifest?.textContent) throw new Error("Manifest missing.");
    const source = JSON.parse(manifest.textContent) as {
      instances: Array<Record<string, unknown>>;
    };
    source.instances.push({ ...source.instances[0], id: "test-second-fill" });
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      mounts: Map<
        string,
        {
          instance: { id: string };
          canvas: HTMLCanvasElement;
          suppressed: boolean;
        }
      >;
      renderMount: (...args: unknown[]) => Promise<unknown>;
    };
    const originalRender = internals.renderMount.bind(active);
    internals.renderMount = async (...args) => {
      const mount = args[0] as { instance: { id: string } };
      if (mount.instance.id === "test-second-fill")
        throw new Error("Deliberate second Fill failure.");
      return originalRender(...args);
    };
    const statuses: Array<{
      instanceId: string;
      status: string;
      code?: string;
      message?: string;
    }> = [];
    const onStatus = (event: Event) =>
      statuses.push((event as CustomEvent<(typeof statuses)[number]>).detail);
    window.addEventListener("native-shader-status", onStatus);
    try {
      await expect(active.renderAt(0)).rejects.toMatchObject({
        code: "native-render-incomplete",
      });
      const first = internals.mounts.get("test-instance");
      const second = internals.mounts.get("test-second-fill");
      expect(first?.canvas.style.visibility).toBe("hidden");
      expect(second?.canvas.style.visibility).toBe("hidden");
      expect(first?.suppressed).toBe(false);
      active.requestStatusSnapshot();
      const firstStatus = statuses
        .filter((item) => item.instanceId === "test-instance")
        .slice(-1)[0];
      expect(firstStatus).toMatchObject({
        status: "error",
        code: "fill-group-incomplete",
        message: "fill-group-incomplete",
      });
      internals.renderMount = originalRender;
      await active.renderAt(0);
      statuses.length = 0;
      active.requestStatusSnapshot();
      expect(
        statuses.find((item) => item.instanceId === "test-instance"),
      ).toMatchObject({ status: "ready" });
      expect(
        internals.mounts.get("test-second-fill")?.canvas.style.visibility,
      ).toBe("visible");
    } finally {
      internals.renderMount = originalRender;
      window.removeEventListener("native-shader-status", onStatus);
    }
  });
});

describe("Fill presentation status", () => {
  it("marks the first committed Fill presentation as WebGPU ready", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    expect(target).not.toBeNull();
    expect(target?.getAttribute("data-an-native-status")).toBe("ready");
    expect(target?.getAttribute("data-an-native-backend")).toBe("webgpu");
    expect(target?.hasAttribute("data-an-native-error")).toBe(false);
    expect(target?.hasAttribute("data-an-native-error-message")).toBe(false);
    active.dispose();
  });

  it("clears failed Fill diagnostics only after a replacement frame commits", async () => {
    fakeGpu();
    const active = await startRuntime(true);
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const internals = active as unknown as {
      renderMount: (...args: unknown[]) => Promise<unknown>;
    };
    const originalRender = internals.renderMount.bind(active);
    internals.renderMount = async (...args) => {
      const mount = args[0] as { instance: { id: string } };
      if (mount.instance.id === "test-instance")
        throw new Error("Deliberate Fill frame failure.");
      return originalRender(...args);
    };
    try {
      await expect(active.renderAt(0)).rejects.toMatchObject({
        code: "native-render-incomplete",
      });
      expect(target?.getAttribute("data-an-native-status")).toBe("error");
      expect(target?.getAttribute("data-an-native-error")).toBe(
        "render-failed",
      );
      internals.renderMount = originalRender;
      await active.renderAt(0);
      expect(target?.getAttribute("data-an-native-status")).toBe("ready");
      expect(target?.hasAttribute("data-an-native-error")).toBe(false);
      expect(target?.hasAttribute("data-an-native-error-message")).toBe(false);
      expect(target?.getAttribute("data-an-native-backend")).toBe("webgpu");
    } finally {
      internals.renderMount = originalRender;
      active.dispose();
    }
  });
});

describe("native presentation sampling extent", () => {
  it("publishes an expanded Backdrop only after capturing prior negative paint and receiver coverage", async () => {
    const gpu = fakeGpu({ completeCanvasConfiguration: true });
    const active = await startRuntime(true);
    active.pause();
    const target = document.querySelector<HTMLElement>(
      '[data-agent-native-node-id="test-target"]',
    );
    const manifest = document.querySelector<HTMLScriptElement>(
      'script[type="application/x-agent-native-effects"]',
    );
    if (!target || !manifest?.textContent)
      throw new Error("Native fixture unavailable.");
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 1;
    sourceCanvas.height = 1;
    Object.defineProperties(sourceCanvas, {
      offsetWidth: { configurable: true, value: 1 },
      offsetHeight: { configurable: true, value: 1 },
      offsetLeft: { configurable: true, value: -1 },
      offsetTop: { configurable: true, value: 0 },
    });
    document.body.insertBefore(sourceCanvas, target);
    Object.defineProperties(HTMLCanvasElement.prototype, {
      offsetWidth: {
        configurable: true,
        get(this: HTMLCanvasElement) {
          return this.hasAttribute("data-an-native-canvas")
            ? Number.parseFloat(this.style.width)
            : 0;
        },
      },
      offsetHeight: {
        configurable: true,
        get(this: HTMLCanvasElement) {
          return this.hasAttribute("data-an-native-canvas")
            ? Number.parseFloat(this.style.height)
            : 0;
        },
      },
    });
    const priorRect = vi
      .mocked(Element.prototype.getBoundingClientRect)
      .getMockImplementation();
    const priorStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation();
    if (!priorRect || !priorStyle) throw new Error("DOM fixture unavailable.");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this === sourceCanvas) return new DOMRect(-1, 0, 1, 1);
        if (
          this instanceof HTMLCanvasElement &&
          this.hasAttribute("data-an-native-canvas")
        )
          return new DOMRect(
            Number.parseFloat(this.style.left),
            Number.parseFloat(this.style.top),
            this.offsetWidth,
            this.offsetHeight,
          );
        return priorRect.call(this);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) =>
        ({
          ...priorStyle(element, pseudo),
          overflowX: element === target ? "clip" : "visible",
          overflowY: element === target ? "clip" : "visible",
          borderTopLeftRadius: element === target ? "0.5px" : "0px",
          borderTopRightRadius: element === target ? "0.5px" : "0px",
          borderBottomLeftRadius: element === target ? "0.5px" : "0px",
          borderBottomRightRadius: element === target ? "0.5px" : "0px",
          getPropertyValue: (name: string) =>
            name === "overflow-clip-margin" && element === target
              ? "border-box 1px"
              : "0px",
        }) as CSSStyleDeclaration,
    );
    const source = JSON.parse(manifest.textContent) as {
      definitions: unknown[];
      instances: Array<Record<string, unknown>>;
    };
    const processor = OWNED_PROCESSOR_DEFINITIONS.find(
      (definition) => definition.id === "an-native-owned-directional-smear",
    );
    if (!processor) throw new Error("Backdrop processor unavailable.");
    source.definitions.push(processor);
    source.instances = [
      {
        ...source.instances[0],
        id: "expanded-backdrop",
        definitionId: processor.id,
        definitionVersion: processor.version,
        placement: "backdrop",
        params: { mix: 0 },
      },
    ];
    manifest.textContent = JSON.stringify(source);
    await active.scan();
    const internals = active as unknown as {
      scenePresentation: unknown;
      mounts: Map<
        string,
        {
          outputTexture: unknown;
          frameCount: number;
          outputExtent: Record<string, unknown>;
          provider: {
            readScene(): Promise<
              Array<{ node: Element; rect: unknown; coordinateSpace: string }>
            >;
          };
        }
      >;
    };
    const mount = internals.mounts.get("expanded-backdrop");
    if (!mount) throw new Error("Expanded mount unavailable.");
    await active.renderAt(0);
    expect(mount.outputExtent).toMatchObject({
      expanded: true,
      left: 1,
      top: 1,
      width: 4,
      height: 4,
    });
    expect(mount.outputTexture).not.toBeNull();
    expect(mount.frameCount).toBeGreaterThan(0);
    expect(internals.scenePresentation).not.toBeNull();
    expect(
      (await mount.provider.readScene()).find(
        (record) => record.node === sourceCanvas,
      ),
    ).toMatchObject({
      coordinateSpace: "target-local-global",
      rect: { x: -1, y: 0, width: 1, height: 1 },
    });
    expect(
      gpu.state.uniformWrites.some(
        (data) => data.length > 36 && data[20] === -1 && data[21] === -1,
      ),
    ).toBe(true);
    expect(
      gpu.state.uniformWrites.some(
        (data) =>
          data.length > 36 &&
          data[16] === 1 &&
          data
            .slice(36, 40)
            .every((value, index) => value === [0, 0, 2, 2][index]) &&
          data.slice(40, 48).every((radius) => radius === 0.5),
      ),
    ).toBe(true);
  });

  it.each([1, 1.6, 2])(
    "retains an opacity group wholly left of an expanded Backdrop at density %s",
    async (density) => {
      const gpu = fakeGpu();
      const active = await startRuntime(true);
      active.pause();
      const internals = active as unknown as {
        mounts: Map<string, Record<string, unknown>>;
        device: { createCommandEncoder(): unknown };
        composeScene(...args: unknown[]): Promise<unknown>;
      };
      const originalMount = internals.mounts.get("test-instance");
      if (!originalMount) throw new Error("Native fixture unavailable.");
      const source = document.createElement("canvas");
      source.width = 1;
      source.height = 1;
      const left = Math.ceil(2 * density);
      const top = Math.ceil(density);
      const width = Math.ceil(2 * density) + left;
      const height = Math.ceil(2 * density) + top;
      const scene = [
        {
          key: 8701,
          node: source,
          kind: "canvas",
          source,
          width: 1,
          height: 1,
          revision: 1,
          coordinateSpace: "target-local-global",
          rect: { x: -2, y: -1, width: 1, height: 1 },
          localBox: { x: 0, y: 0, width: 1, height: 1 },
          localToTarget: { a: 1, b: 0, c: 0, d: 1, e: -2, f: -1 },
          clip: { x: -2, y: -1, width: 1, height: 1 },
          clips: [],
          groupClips: [],
          isolationPath: [
            { id: "outside-half", kind: "opacity", opacity: 0.5 },
          ],
          opacity: 1,
        },
      ];
      const mount = {
        ...originalMount,
        width,
        height,
        pixelRatio: density,
        outputExtent: {
          left,
          top,
          sourceWidth: Math.ceil(2 * density),
          sourceHeight: Math.ceil(2 * density),
        },
        resourceTextures: new Map(),
        isolationTextures: new Map(),
      };
      const priorWrites = gpu.state.uniformWrites.length;
      await internals.composeScene(
        mount,
        scene,
        internals.device.createCommandEncoder(),
      );
      const writes = gpu.state.uniformWrites
        .slice(priorWrites)
        .filter((data) => data.length > 36);
      expect(writes).toHaveLength(2);
      const groupWidth = Math.ceil(-density) - Math.floor(-2 * density);
      const groupHeight = -Math.floor(-density);
      expect(
        gpu.state.textures.some(
          (texture) =>
            texture.width === groupWidth && texture.height === groupHeight,
        ),
      ).toBe(true);
      expect(writes[0]!.slice(4, 6)).toEqual([groupWidth, groupHeight]);
      expect(writes[0]!.slice(20, 22)).toEqual([
        Math.floor(-2 * density),
        Math.floor(-density),
      ]);
      expect(writes[1]!.slice(4, 6)).toEqual([width, height]);
      expect(writes[1]!.slice(20, 22)).toEqual([-left, -top]);
      expect(writes[1]![8]).toBe(0.5);
      expect(gpu.state.scissors.slice(-2)).toEqual([
        [0, 0, groupWidth, groupHeight],
        [
          left + Math.floor(-2 * density),
          top + Math.floor(-density),
          groupWidth,
          groupHeight,
        ],
      ]);
    },
  );

  it.each(["auto", "pixelated"])(
    "rejects stale physical canvas dimensions under %s before composition",
    async (imageRendering) => {
      fakeGpu();
      const active = await startRuntime(true);
      active.pause();
      await active.renderAt(0);
      const presentation = document.querySelector<HTMLCanvasElement>(
        'canvas[data-an-native-canvas="test-instance"]',
      );
      if (!presentation) throw new Error("Native presentation unavailable");
      const priorStyle = vi
        .mocked(window.getComputedStyle)
        .getMockImplementation();
      if (!priorStyle) throw new Error("Computed style fixture unavailable");
      vi.spyOn(window, "getComputedStyle").mockImplementation(
        (element, pseudo) =>
          ({
            ...priorStyle(element, pseudo),
            imageRendering: element === presentation ? imageRendering : "auto",
          }) as CSSStyleDeclaration,
      );
      const provider = createNativeSceneProvider(
        document.documentElement,
        "layer",
      );
      if (!provider) throw new Error("Scene provider unavailable");
      const internals = active as unknown as {
        mounts: Map<string, unknown>;
        device: { createCommandEncoder(): unknown };
        composeScene(
          mount: unknown,
          scene: unknown[],
          encoder: unknown,
        ): Promise<unknown>;
      };
      const mount = internals.mounts.get("test-instance");
      if (!mount) throw new Error("Native mount unavailable");
      const nativeRecords = async () =>
        (await provider.readScene()).filter(
          (record) => record.nativeInstanceId === "test-instance",
        );
      try {
        expect(await nativeRecords()).toHaveLength(1);
        await expect(
          internals.composeScene(
            mount,
            await nativeRecords(),
            internals.device.createCommandEncoder(),
          ),
        ).resolves.toBeDefined();
        presentation.width += 1;
        await expect(
          internals.composeScene(
            mount,
            await nativeRecords(),
            internals.device.createCommandEncoder(),
          ),
        ).rejects.toMatchObject({ code: "source-image-rendering-geometry" });
      } finally {
        provider.dispose();
        active.dispose();
      }
    },
  );
});

describe("scoped native composition planes", () => {
  async function composeFixture(args: {
    blendMode: "linear" | "srgb-css" | "srgb-css-linear";
    groups: number;
    nested?: boolean;
    ordinary?: boolean;
    width?: number;
    height?: number;
  }) {
    const gpu = fakeGpu({ assertNoTextureAlias: true });
    const active = await startRuntime(true);
    active.pause();
    const internal = active as unknown as {
      mounts: Map<string, Record<string, unknown>>;
      device: { createCommandEncoder(): unknown };
      texture(width: number, height: number): unknown;
      pipeline(...args: unknown[]): Promise<unknown>;
      textureBytes: Map<unknown, number>;
      ensureCompositionBudget(surface: unknown, requested: number): void;
      composeScene(
        surface: unknown,
        scene: unknown[],
        encoder: unknown,
        outputName: string,
        blendMode: string,
      ): Promise<unknown>;
    };
    const mounted = internal.mounts.get("test-instance");
    if (!mounted) throw new Error("Compositor fixture mount unavailable");
    const width = args.width ?? 2880;
    const height = args.height ?? 2048;
    const target = document.createElement("div");
    Object.defineProperties(target, {
      offsetWidth: { configurable: true, value: width / 2 },
      offsetHeight: { configurable: true, value: height / 2 },
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, width / 2, height / 2),
    );
    const surface = {
      target,
      width,
      height,
      pixelRatio: 2,
      resourceTextures: new Map<string, unknown>(),
      isolationTextures: new Map<
        string,
        { texture: unknown; width: number; height: number }
      >(),
      sourceTextures: new Map(),
      drawBindings: new Map(),
    };
    const scene = Array.from({ length: args.groups }, (_, index) => {
      const instanceId = `plane-backdrop-${index}`;
      const outputTexture = internal.texture(2, 2);
      internal.mounts.set(instanceId, {
        ...mounted,
        instance: {
          ...(mounted.instance as object),
          id: instanceId,
          placement: "backdrop",
          opacity: 1,
        },
        outputTexture,
        resourceTextures: new Map(),
        sourceTextures: new Map(),
        isolationTextures: new Map(),
        drawBindings: new Map(),
        assetTextures: new Map(),
        maskTexture: null,
        simulation: null,
        feedback: null,
      });
      const rect = { x: 20 + index * 340, y: 20, width: 240, height: 160 };
      return {
        key: 9800 + index,
        node: target,
        kind: "canvas",
        source: null,
        width: 2,
        height: 2,
        revision: 1,
        coordinateSpace: "target-local",
        nativeInstanceId: instanceId,
        rect,
        localBox: rect,
        localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        clip: rect,
        clips: [],
        groupClips: [],
        opacity: 1,
        isolationPath: [
          ...(args.nested
            ? [{ id: "shared-opacity", kind: "opacity", opacity: 0.5 }]
            : []),
          { id: `receiver-${index}`, kind: "opacity", opacity: 0.5 },
        ],
      };
    });
    if (args.ordinary) {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 2;
      const rect = { x: 10, y: 10, width: 240, height: 160 };
      scene.unshift({
        key: 9799,
        node: target,
        kind: "canvas",
        source: canvas,
        width: 2,
        height: 2,
        revision: 1,
        coordinateSpace: "target-local",
        nativeInstanceId: undefined,
        rect,
        localBox: rect,
        localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        clip: rect,
        clips: [],
        groupClips: [],
        opacity: 1,
        isolationPath: [{ id: "ordinary", kind: "opacity", opacity: 0.5 }],
      } as unknown as (typeof scene)[number]);
    }
    const texturesBefore = gpu.state.textures.length;
    const passesBefore = gpu.state.renderPasses.length;
    const compose = () =>
      internal.composeScene(
        surface,
        scene,
        internal.device.createCommandEncoder(),
        "source",
        args.blendMode,
      );
    const output = await compose();
    return {
      gpu,
      active,
      internal,
      surface,
      scene,
      compose,
      output,
      texturesBefore,
      passesBefore,
    };
  }

  it.each([1, 2, 3])(
    "reuses the two full-size CSS planes and decodes %s sibling groups without aliasing",
    async (groups) => {
      const fixture = await composeFixture({
        blendMode: "srgb-css-linear",
        groups,
      });
      const { gpu, internal, surface, output, texturesBefore, passesBefore } =
        fixture;
      const full = gpu.state.textures
        .slice(texturesBefore)
        .filter((texture) => texture.width === 2880 && texture.height === 2048);
      expect(full).toHaveLength(2);
      expect(surface.resourceTextures.get("source")).toBe(output);
      const css = surface.isolationTextures.get("css-intermediate:source");
      expect(css?.texture).not.toBe(output);
      expect(new Set([output, css?.texture])).toEqual(new Set(full));
      expect(
        [...surface.isolationTextures.keys()].some((key) =>
          key.endsWith(":resolve"),
        ),
      ).toBe(false);
      expect(() => internal.ensureCompositionBudget(surface, 0)).not.toThrow();
      const bytes = [
        ...surface.resourceTextures.values(),
        ...[...surface.isolationTextures.values()].map(
          (entry) => entry.texture,
        ),
      ].reduce<number>(
        (total, texture) => total + internal.textureBytes.get(texture)!,
        0,
      );
      expect(bytes).toBe(2 * 2880 * 2048 * 8 + groups * 2 * 480 * 320 * 8);
      const passes = gpu.state.renderPasses.slice(passesBefore);
      const decode = passes[passes.length - 1]!;
      expect(decode.target).toBe(output);
      expect(decode.reads).toEqual([css?.texture]);
      expect(decode.shader).toContain("struct Draw { viewport: vec4f }");
      for (const pass of passes) expect(pass.reads).not.toContain(pass.target);
      const allocationCount = gpu.state.textures.length;
      const second = await fixture.compose();
      expect(gpu.state.textures).toHaveLength(allocationCount);
      expect(surface.resourceTextures.get("source")).toBe(second);
      expect(
        surface.isolationTextures.get("css-intermediate:source")?.texture,
      ).not.toBe(second);
    },
  );

  it.each(["linear", "srgb-css"] as const)(
    "shares one lazy parent companion in %s through every sibling resolve",
    async (blendMode) => {
      const { gpu, surface, output, texturesBefore, passesBefore } =
        await composeFixture({ blendMode, groups: 3 });
      const full = gpu.state.textures
        .slice(texturesBefore)
        .filter((texture) => texture.width === 2880 && texture.height === 2048);
      expect(full).toHaveLength(2);
      expect(surface.isolationTextures.has("backdrop-replacement:source")).toBe(
        true,
      );
      expect(surface.isolationTextures.has("css-intermediate:source")).toBe(
        false,
      );
      expect(full).toContain(output);
      for (const pass of gpu.state.renderPasses.slice(passesBefore))
        expect(pass.reads).not.toContain(pass.target);
    },
  );

  it("keeps child groups independent while the parent seed is still sampled", async () => {
    const { gpu, surface, texturesBefore, passesBefore } = await composeFixture(
      {
        blendMode: "srgb-css-linear",
        groups: 3,
        nested: true,
      },
    );
    const full = gpu.state.textures
      .slice(texturesBefore)
      .filter((texture) => texture.width === 2880 && texture.height === 2048);
    expect(full).toHaveLength(2);
    const childWorking = [...surface.isolationTextures.entries()].filter(
      ([key]) => key.includes(":receiver-") && key.endsWith(":working"),
    );
    expect(childWorking).toHaveLength(3);
    for (const [, entry] of childWorking)
      expect(full).not.toContain(entry.texture);
    const passes = gpu.state.renderPasses.slice(passesBefore);
    for (const pass of passes) expect(pass.reads).not.toContain(pass.target);
    for (const [, entry] of childWorking) {
      const initial = passes.findIndex((pass) => pass.target === entry.texture);
      const sampled = passes.findIndex(
        (pass, index) => index > initial && pass.reads.includes(entry.texture),
      );
      expect(initial).toBeGreaterThanOrEqual(0);
      expect(sampled).toBeGreaterThan(initial);
      expect(
        passes
          .slice(initial + 1, sampled)
          .some((pass) => pass.target === entry.texture),
      ).toBe(false);
    }
  });

  it("flushes an ordinary group's pending parent sample before a deferred child seed", async () => {
    const { gpu, surface, passesBefore } = await composeFixture({
      blendMode: "srgb-css-linear",
      groups: 1,
      ordinary: true,
    });
    const ordinary = surface.isolationTextures.get(
      "srgb-css-linear:opacity:ordinary",
    )?.texture;
    const child = [...surface.isolationTextures.entries()].find(
      ([key]) => key.includes(":receiver-0") && key.endsWith(":working"),
    )?.[1].texture;
    expect(ordinary).toBeDefined();
    expect(child).toBeDefined();
    const passes = gpu.state.renderPasses.slice(passesBefore);
    const ordinaryWrite = passes.findIndex((pass) => pass.target === ordinary);
    const ordinaryRead = passes.findIndex(
      (pass, index) => index > ordinaryWrite && pass.reads.includes(ordinary),
    );
    const seed = passes.findIndex(
      (pass) =>
        pass.target === child &&
        pass.reads.some(
          (texture) =>
            texture === surface.resourceTextures.get("source") ||
            texture ===
              surface.isolationTextures.get("css-intermediate:source")?.texture,
        ),
    );
    expect(ordinaryWrite).toBeGreaterThanOrEqual(0);
    expect(ordinaryRead).toBeGreaterThan(ordinaryWrite);
    expect(seed).toBeGreaterThan(ordinaryRead);
    expect(
      passes
        .slice(ordinaryWrite + 1, ordinaryRead)
        .some((pass) => pass.target === ordinary),
    ).toBe(false);
  });

  it("retains cached plane roles when decode creation fails before submission and retries without allocation", async () => {
    const fixture = await composeFixture({
      blendMode: "srgb-css-linear",
      groups: 3,
    });
    const { gpu, internal, surface } = fixture;
    const source = surface.resourceTextures.get("source");
    const css = surface.isolationTextures.get(
      "css-intermediate:source",
    )?.texture;
    const allocations = gpu.state.textures.length;
    const nativeOutputs = fixture.scene.map(
      (record) => internal.mounts.get(record.nativeInstanceId!)?.outputTexture,
    );
    const original = internal.pipeline.bind(internal);
    const refusal = vi
      .spyOn(internal, "pipeline")
      .mockImplementation(async (...args) => {
        if (String(args[0]).includes("struct Draw { viewport: vec4f }"))
          throw new Error("decode creation refused");
        return original(...args);
      });
    await expect(fixture.compose()).rejects.toThrow("decode creation refused");
    expect(surface.resourceTextures.get("source")).toBe(source);
    expect(
      surface.isolationTextures.get("css-intermediate:source")?.texture,
    ).toBe(css);
    expect(
      fixture.scene.map(
        (record) =>
          internal.mounts.get(record.nativeInstanceId!)?.outputTexture,
      ),
    ).toEqual(nativeOutputs);
    expect(gpu.state.textures).toHaveLength(allocations);
    refusal.mockRestore();
    const output = await fixture.compose();
    expect(surface.resourceTextures.get("source")).toBe(output);
    expect(
      surface.isolationTextures.get("css-intermediate:source")?.texture,
    ).not.toBe(output);
    expect(gpu.state.textures).toHaveLength(allocations);
  });
});
