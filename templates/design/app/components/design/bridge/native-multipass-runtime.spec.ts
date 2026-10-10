// @vitest-environment happy-dom
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CATALOG_GENERATOR_CANDIDATES } from "../../../../shared/native-effect-catalog-generators";
import { DESIGN_OWNED_STATEFUL_DEFINITIONS } from "../../../../shared/native-effect-owned-dynamics";
import {
  OWNED_INTRINSIC_IMAGE_TEST_EFFECT,
  OWNED_RENDERED_SURFACE_TEST_EFFECT,
} from "../../../../shared/native-effect-owned-source-test-fixtures";
import { OWNED_FEEDBACK_TEST_DEFINITION } from "../../../../shared/native-effect-owned-test-fixtures";
import { planNativeEffectTransform } from "../../../../shared/native-effect-transform";
import { hashEffectDefinition } from "../../../../shared/native-effect-trust";
import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import { hashEffectInstance } from "../../../../shared/native-instance-preview-contract";
import { STATELESS_SORT_TEST_DEFINITION } from "../../../../shared/native-stateless-sort.test-fixture";
import type { NativeGpuSampleWindow } from "./native-gpu-sample-window";
import type { NativeGpuScopeProfiler } from "./native-gpu-scope-profiler";
import type { NativeMountedBenchmarkRun } from "./native-mounted-benchmark";
import type { NativePlaybackClock } from "./native-playback-clock";
import type { NativeSourceRecord } from "./native-source-provider";

const wgsl = `
struct Globals { viewport: vec4f, clock: vec4f, params: array<vec4f, 32> };
@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var sharp: texture_2d<f32>;
@group(0) @binding(3) var blurred: texture_2d<f32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var xy = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: VertexOut;
  out.position = vec4f(xy[index], 0.0, 1.0);
  out.uv = xy[index] * vec2f(0.5, -0.5) + vec2f(0.5);
  return out;
}
@fragment fn fs(input: VertexOut) -> @location(0) vec4f {
  let a = textureSample(sharp, linearSampler, input.uv);
  let b = textureSample(blurred, linearSampler, input.uv);
  return a + b * 0.25;
}`;

const definition: EffectDefinition = {
  id: "two-texture-test",
  name: "Two texture test",
  version: 1,
  kind: "processor",
  placements: ["layer"],
  properties: {},
  extent: { output: { top: 2, right: 2, bottom: 2, left: 2 } },
  resources: [
    { name: "source", kind: "texture-2d", external: true },
    {
      name: "blur",
      kind: "texture-2d",
      format: "rgba16float",
      size: "fixed",
      width: 4,
      height: 4,
      usage: ["render", "sampled"],
    },
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba8unorm",
      size: "viewport",
      usage: ["render", "sampled"],
    },
  ],
  output: "color",
  passes: [
    {
      id: "blur-pass",
      kind: "render",
      wgsl,
      reads: ["source"],
      output: "blur",
    },
    {
      id: "mix-pass",
      kind: "render",
      wgsl,
      reads: ["source", "blur"],
      output: "color",
    },
  ],
  provenance: { origin: "user-authored" },
};

type FakeTexture = {
  id: number;
  width: number;
  height: number;
  format: string;
  mipLevelCount: number;
  createView(): { textureId: number };
  destroy(): void;
};

const saved = {
  gpu: Object.getOwnPropertyDescriptor(navigator, "gpu"),
  currentScript: Object.getOwnPropertyDescriptor(document, "currentScript"),
  fonts: Object.getOwnPropertyDescriptor(document, "fonts"),
  resize: globalThis.ResizeObserver,
  canvasContext: HTMLCanvasElement.prototype.getContext,
  textureUsage: Object.getOwnPropertyDescriptor(globalThis, "GPUTextureUsage"),
  bufferUsage: Object.getOwnPropertyDescriptor(globalThis, "GPUBufferUsage"),
  mapMode: Object.getOwnPropertyDescriptor(globalThis, "GPUMapMode"),
  shaderStage: Object.getOwnPropertyDescriptor(globalThis, "GPUShaderStage"),
};

function restore(
  object: object,
  name: string,
  value: PropertyDescriptor | undefined,
) {
  if (value) Object.defineProperty(object, name, value);
  else Reflect.deleteProperty(object, name);
}

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  restore(navigator, "gpu", saved.gpu);
  restore(document, "currentScript", saved.currentScript);
  restore(document, "fonts", saved.fonts);
  restore(globalThis, "GPUTextureUsage", saved.textureUsage);
  restore(globalThis, "GPUBufferUsage", saved.bufferUsage);
  restore(globalThis, "GPUMapMode", saved.mapMode);
  restore(globalThis, "GPUShaderStage", saved.shaderStage);
  globalThis.ResizeObserver = saved.resize;
  HTMLCanvasElement.prototype.getContext = saved.canvasContext;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native multipass texture bindings", () => {
  it("runs fixed rgba16float blur before viewport mix and binds sharp and blur separately", async () => {
    let nextTexture = 0;
    const simulatedPixels = new Map<number, Uint8Array>();
    let nextPixelVersion = 0;
    let submitCalls = 0;
    const textures: FakeTexture[] = [];
    const bound: { entries: { binding: number; resource: unknown }[] }[] = [];
    const bindLayouts: { entries: { binding: number }[] }[] = [];
    const rendered: number[] = [];
    const computeCommandTrace: string[] = [];
    const destroyed: number[] = [];
    const copied: number[] = [];
    const mipUploads: {
      textureId: number;
      level: number;
      bytes: Uint8Array;
    }[] = [];
    let rejectMipUpload = false;
    let rejectMipSubmit = false;
    let nextValidationError: string | null = null;
    let duringNextValidation: (() => void) | null = null;
    const encodedMipCopies: {
      source: number;
      destination: number;
      level: number;
    }[] = [];
    const chainCopies: {
      source: number;
      destination: number;
      origin: [number, number, number];
      size: [number, number, number];
    }[] = [];
    const timestampPasses: unknown[] = [];
    const requestedFeatures: string[][] = [];
    const writtenUniforms: Float32Array[] = [];
    const samplerConfigurations: GPUSamplerDescriptor[] = [];
    let cornerRadius = 0;
    let invalidDraftCompiles = 0;
    const device = {
      features: new Set(["timestamp-query"]),
      limits: {
        maxTextureDimension2D: 8192,
        maxComputeWorkgroupsPerDimension: 65535,
        maxStorageBufferBindingSize: 134217728,
        maxBufferSize: 268435456,
        maxComputeInvocationsPerWorkgroup: 256,
        maxComputeWorkgroupSizeX: 256,
        maxComputeWorkgroupSizeY: 256,
        maxComputeWorkgroupSizeZ: 64,
        maxComputeWorkgroupStorageSize: 16384,
      },
      lost: new Promise(() => {}),
      queue: {
        writeBuffer(_buffer: unknown, _offset: number, bytes: Float32Array) {
          if (bytes instanceof Float32Array)
            writtenUniforms.push(new Float32Array(bytes));
        },
        writeTexture(
          destination: { texture: FakeTexture; mipLevel?: number },
          bytes: Uint8Array,
        ) {
          mipUploads.push({
            textureId: destination.texture.id,
            level: destination.mipLevel ?? 0,
            bytes: Uint8Array.from(bytes),
          });
          if (rejectMipUpload && destination.mipLevel === 1)
            throw new Error("mip upload refused");
        },
        submit(commands: { writes?: number[] }[]) {
          submitCalls += 1;
          if (rejectMipSubmit) throw new Error("encoded mip submit refused");
          for (const command of commands)
            for (const id of command.writes ?? []) {
              nextPixelVersion += 1;
              simulatedPixels.set(
                id,
                Uint8Array.from([
                  nextPixelVersion & 255,
                  (nextPixelVersion >> 8) & 255,
                  id & 255,
                  255,
                ]),
              );
            }
        },
        async onSubmittedWorkDone() {},
        copyExternalImageToTexture(
          _source: unknown,
          destination: { texture: FakeTexture },
        ) {
          copied.push(destination.texture.id);
        },
      },
      createSampler: (configuration: GPUSamplerDescriptor = {}) => {
        samplerConfigurations.push(configuration);
        return { samplerConfiguration: samplerConfigurations.length };
      },
      createTexture({
        size,
        format,
        mipLevelCount = 1,
      }: {
        size: number[];
        format: string;
        mipLevelCount?: number;
      }) {
        const id = ++nextTexture;
        const texture = {
          id,
          width: size[0],
          height: size[1],
          format,
          mipLevelCount,
          createView: (options?: { baseMipLevel?: number }) => ({
            textureId: id,
            baseMipLevel: options?.baseMipLevel,
          }),
          destroy() {
            destroyed.push(id);
          },
        };
        textures.push(texture);
        simulatedPixels.set(id, new Uint8Array(4));
        return texture;
      },
      createBuffer: ({ size = 256 }: { size?: number } = {}) => ({
        mapState: "unmapped",
        async mapAsync() {
          this.mapState = "mapped";
        },
        getMappedRange: () => new ArrayBuffer(size),
        unmap() {
          this.mapState = "unmapped";
        },
        destroy() {},
      }),
      createQuerySet: () => ({ destroy() {} }),
      createShaderModule: ({ code }: { code: string }) => {
        if (code.includes("INVALID_DRAFT")) invalidDraftCompiles += 1;
        return {
          getCompilationInfo: async () => ({
            messages: code.includes("INVALID_DRAFT")
              ? [
                  {
                    type: "error",
                    lineNum: 7,
                    linePos: 4,
                    message: "draft compile failed",
                  },
                ]
              : [],
          }),
        };
      },
      createBindGroupLayout: (input: { entries: { binding: number }[] }) => {
        bindLayouts.push(input);
        return {};
      },
      createPipelineLayout: () => ({}),
      createRenderPipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createComputePipelineAsync: async () => ({
        getBindGroupLayout: () => ({}),
      }),
      createBindGroup(input: {
        entries: { binding: number; resource: unknown }[];
      }) {
        bound.push(input);
        return input;
      },
      createCommandEncoder: () => {
        const writes: number[] = [];
        return {
          clearBuffer(_buffer: unknown, offset: number, size: number) {
            computeCommandTrace.push(`clear:${offset}:${size}`);
          },
          beginComputePass: () => {
            computeCommandTrace.push("compute-begin");
            return {
              setPipeline() {},
              setBindGroup() {},
              dispatchWorkgroups(...dimensions: number[]) {
                computeCommandTrace.push(`dispatch:${dimensions.join(",")}`);
              },
              end() {
                computeCommandTrace.push("compute-end");
              },
            };
          },
          beginRenderPass(input: {
            colorAttachments: { view: { textureId: number } }[];
            timestampWrites?: unknown;
          }) {
            computeCommandTrace.push("render-begin");
            rendered.push(input.colorAttachments[0].view.textureId);
            writes.push(input.colorAttachments[0].view.textureId);
            if (input.timestampWrites)
              timestampPasses.push(input.timestampWrites);
            return {
              setPipeline() {},
              setBindGroup() {},
              setScissorRect() {},
              draw() {},
              end() {},
            };
          },
          resolveQuerySet() {},
          copyBufferToBuffer() {},
          copyTextureToTexture(
            from: { texture: FakeTexture },
            to: {
              texture: FakeTexture;
              origin?: [number, number, number];
              mipLevel?: number;
            },
            size: [number, number, number],
          ) {
            if (to.mipLevel !== undefined)
              encodedMipCopies.push({
                source: from.texture.id,
                destination: to.texture.id,
                level: to.mipLevel,
              });
            else
              chainCopies.push({
                source: from.texture.id,
                destination: to.texture.id,
                origin: to.origin ?? [0, 0, 0],
                size,
              });
          },
          finish: () => ({ writes }),
        };
      },
      pushErrorScope() {},
      popErrorScope: async () => {
        await Promise.resolve();
        const callback = duringNextValidation;
        duringNextValidation = null;
        callback?.();
        const message = nextValidationError;
        nextValidationError = null;
        return message ? { message } : null;
      },
      destroy() {},
    };
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: async () => ({
          features: new Set(["timestamp-query"]),
          requestDevice: async (descriptor: {
            requiredFeatures?: string[];
          }) => {
            requestedFeatures.push(descriptor.requiredFeatures ?? []);
            return device;
          },
        }),
        getPreferredCanvasFormat: () => "rgba8unorm",
      },
    });
    Object.defineProperty(globalThis, "GPUTextureUsage", {
      configurable: true,
      value: {
        COPY_SRC: 1,
        COPY_DST: 2,
        TEXTURE_BINDING: 4,
        STORAGE_BINDING: 8,
        RENDER_ATTACHMENT: 16,
      },
    });
    Object.defineProperty(globalThis, "GPUBufferUsage", {
      configurable: true,
      value: {
        COPY_SRC: 4,
        COPY_DST: 8,
        MAP_READ: 1,
        UNIFORM: 64,
        STORAGE: 128,
        QUERY_RESOLVE: 512,
      },
    });
    Object.defineProperty(globalThis, "GPUMapMode", {
      configurable: true,
      value: { READ: 1 },
    });
    Object.defineProperty(globalThis, "GPUShaderStage", {
      configurable: true,
      value: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready: Promise.resolve(),
        status: "loaded",
        addEventListener() {},
        removeEventListener() {},
      },
    });
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
    const canvasConfigurations: GPUCanvasConfiguration[] = [];
    const nativeCanvasConfigurations: GPUCanvasConfiguration[] = [];
    let allowFloatCanvas = true;
    let allowExtendedCanvas = true;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind !== "webgpu") return null;
      const canvas = this;
      let currentConfiguration: GPUCanvasConfiguration | null = null;
      return {
        canvas,
        configure(configuration: GPUCanvasConfiguration) {
          if (configuration.format === "rgba16float" && !allowFloatCanvas)
            throw new Error("float canvas unavailable");
          if (
            configuration.toneMapping?.mode === "extended" &&
            !allowExtendedCanvas
          )
            throw new Error("extended tone mapping unavailable");
          currentConfiguration = configuration;
          canvasConfigurations.push(configuration);
          if (canvas.dataset.anNativeCanvas)
            nativeCanvasConfigurations.push(configuration);
        },
        getConfiguration() {
          return currentConfiguration;
        },
        unconfigure() {
          currentConfiguration = null;
        },
        getCurrentTexture: () => ({
          createView: () => ({
            textureId: canvas.hasAttribute("data-an-native-validation-surface")
              ? -2
              : -1,
          }),
        }),
      } as unknown as GPUCanvasContext;
    } as typeof HTMLCanvasElement.prototype.getContext;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return this.hasAttribute("data-agent-native-node-id")
          ? new DOMRect(0, 0, 8.25, 8.25)
          : new DOMRect(0, 0, 0, 0);
      },
    );
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element, pseudo) => {
        if (pseudo) return { content: "none" } as CSSStyleDeclaration;
        return {
          display: element instanceof HTMLScriptElement ? "none" : "block",
          position: "static",
          visibility: "visible",
          opacity: "1",
          mixBlendMode: "normal",
          filter: "none",
          backdropFilter: "none",
          transform: "none",
          rotate: "none",
          scale: "none",
          isolation: "auto",
          transformOrigin: "50% 50%",
          zIndex: "auto",
          borderRadius: "0px",
          borderTopLeftRadius: `${cornerRadius}px`,
          borderTopRightRadius: `${cornerRadius}px`,
          borderBottomRightRadius: `${cornerRadius}px`,
          borderBottomLeftRadius: `${cornerRadius}px`,
          backgroundColor: "rgba(0, 0, 0, 0)",
          backgroundImage: "none",
          objectFit: "fill",
          objectPosition: "50% 50%",
          imageRendering: "auto",
          boxShadow: "none",
          outlineStyle: "none",
          color: "rgb(0, 0, 0)",
          overflowX: "visible",
          overflowY: "visible",
          maskImage: "none",
          clipPath: "none",
          paddingTop: "0px",
          paddingRight: "0px",
          paddingBottom: "0px",
          paddingLeft: "0px",
          borderTopWidth: "0px",
          borderRightWidth: "0px",
          borderBottomWidth: "0px",
          borderLeftWidth: "0px",
          getPropertyValue: () => "0px",
        } as unknown as CSSStyleDeclaration;
      },
    );
    const target = document.createElement("div");
    target.dataset.agentNativeNodeId = "two-texture-node";
    Object.defineProperties(target, {
      offsetWidth: { value: 8.25 },
      offsetHeight: { value: 8.25 },
    });
    document.body.append(target);
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    manifest.textContent = JSON.stringify({
      schemaVersion: 2,
      definitions: [definition],
      instances: [
        {
          id: "two-texture-instance",
          nodeId: "two-texture-node",
          definitionId: definition.id,
          definitionVersion: definition.version,
          placement: "layer",
          params: {},
          enabled: true,
          opacity: 1,
          seed: 1,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: true, time: 0 },
        },
      ],
    });
    document.body.append(manifest);
    const approval = document.createElement("script");
    approval.type = "application/x-agent-native-effect-approvals";
    approval.textContent = JSON.stringify({
      schemaVersion: 1,
      hashes: [await hashEffectDefinition(definition)],
    });
    document.body.append(approval);
    const runtimeScript = document.createElement("script");
    document.body.append(runtimeScript);
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: runtimeScript,
    });
    const built = await build({
      entryPoints: [
        new URL("./native-shader-runtime.bridge.ts", import.meta.url).pathname,
      ],
      bundle: true,
      platform: "browser",
      format: "iife",
      write: false,
    });
    new Function(built.outputFiles[0].text)();
    const runtime = (
      window as Window & {
        __anNativeShaders?: {
          scan(): Promise<void>;
          dispose(): void;
          epoch: string;
          profile(): {
            gpu: { kind: string; passCount?: number };
            sources: {
              mounts: Array<{
                id: string;
                diagnostic: { readSceneCalls: number; captures: number };
              }>;
            };
          };
        };
      }
    ).__anNativeShaders;
    expect(runtime).toBeDefined();
    try {
      await runtime!.scan();
      expect(requestedFeatures).toEqual([["timestamp-query"]]);
      expect(timestampPasses.length).toBeGreaterThan(0);
      await vi.waitFor(() => {
        expect(runtime!.profile().gpu).toEqual(
          expect.objectContaining({
            kind: "ready",
            passCount: expect.any(Number),
          }),
        );
      });
      const profilerProbe = runtime as unknown as {
        gpuProfiler: {
          beginSample(
            scope: object,
            definition: string,
            instance: string,
            id: string,
          ): unknown;
          forget(scope: object): void;
        };
        beginGpuSample(
          encoder: object,
          mount: object,
          deterministic: boolean,
          definition: string,
          instance: object,
        ): {
          profiler: {
            timestampWritesForPass(sample: object, label: string): unknown;
          };
        } | null;
        gpuTimestampWrites(encoder: object, label: string): object;
        profile(options: { instanceId: string }): {
          gpuTargetInstanceId: string;
          gpuScope: string;
          gpu: { kind: string; code?: string };
        };
        mounts: Map<
          string,
          { definition: object; definitionHash: string; instance: object }
        >;
      };
      expect(
        profilerProbe.profile({ instanceId: "two-texture-instance" }),
      ).toMatchObject({
        gpuTargetInstanceId: "two-texture-instance",
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpu: { kind: "ready" },
      });
      expect(profilerProbe.profile({ instanceId: "missing" })).toMatchObject({
        gpuTargetInstanceId: "missing",
        gpu: { kind: "unavailable", code: "target-unavailable" },
      });
      const mount = profilerProbe.mounts.get("two-texture-instance")!;
      profilerProbe.gpuProfiler.forget(mount);
      const sampleStart = vi.spyOn(profilerProbe.gpuProfiler, "beginSample");
      const sampledEncoders = Array.from({ length: 61 }, () => ({}));
      const sampled = sampledEncoders.map((encoder) => {
        mount.instance = { ...mount.instance };
        mount.definition = { ...mount.definition };
        return profilerProbe.beginGpuSample(
          encoder,
          mount,
          false,
          mount.definitionHash,
          mount.instance,
        );
      });
      expect(sampleStart).toHaveBeenCalledTimes(61);
      expect(
        sampleStart.mock.calls.every(
          (call) =>
            call[0] === mount &&
            call[1] === mount.definitionHash &&
            call[2] === JSON.stringify(mount.instance) &&
            call[3] === "two-texture-instance",
        ),
      ).toBe(true);
      expect(
        sampled.flatMap((sample, index) => (sample ? [index] : [])),
      ).toEqual([0, 60]);
      const sample = sampled[0]!;
      const passReservation = vi.spyOn(
        sample.profiler,
        "timestampWritesForPass",
      );
      expect(
        profilerProbe.gpuTimestampWrites(sampledEncoders[0], "probe"),
      ).toEqual(
        expect.objectContaining({ timestampWrites: expect.any(Object) }),
      );
      expect(passReservation).toHaveBeenCalledWith(
        expect.any(Object),
        "two-texture-instance:probe",
      );
      expect(
        profilerProbe.profile({ instanceId: "two-texture-instance" }).gpu.kind,
      ).toBe("pending");
      expect(runtime!.profile().gpu.kind).toBe("pending");
      expect(
        target.getAttribute("data-an-native-status"),
        target.getAttribute("data-an-native-error-message") ?? "",
      ).toBe("ready");
      const measurementProbe = runtime as unknown as {
        gpuProfiler: NativeGpuScopeProfiler;
        mountedBenchmark: NativeMountedBenchmarkRun | null;
        mountedBenchmarkVisibility(): "visible" | "hidden" | "offscreen";
        deviceEpoch: number;
        draft: {
          instanceId: string;
          showDraft: boolean;
          executionHash: string;
        } | null;
        instancePreview: {
          instanceId: string;
          instance: object;
        } | null;
        draftRequestPending: boolean;
        instancePreviewPending: boolean;
        previewRestoreWork: Promise<unknown> | null;
        draftGeneration: number;
        instancePreviewGeneration: number;
        compositionPixelBusy: boolean;
        measureMountedScene(options: {
          instanceId: string;
          executionHash: string;
          request: { warmupRafIntervals: 120; measuredRafIntervals: 840 };
          signal: AbortSignal;
        }): Promise<{
          gpuThroughFrameIndex: number;
          gpuWindow: NativeGpuSampleWindow;
        }>;
      };
      const visible = vi
        .spyOn(measurementProbe, "mountedBenchmarkVisibility")
        .mockReturnValue("visible");
      const measurementRequest = {
        warmupRafIntervals: 120,
        measuredRafIntervals: 840,
      } as const;
      const driveSyntheticWindow = () => {
        const run = measurementProbe.mountedBenchmark!;
        for (let index = 0; index <= 960; index++) {
          run.onFrame(index * 10, () => "visible");
          run.onRender({
            renderWallMs: 1,
            sourceWallMs: 0,
            composeWallMs: 0,
            failureCount: 0,
          });
        }
      };
      try {
        const savedOptions = {
          instanceId: "two-texture-instance",
          executionHash: mount.definitionHash,
          request: measurementRequest,
          signal: new AbortController().signal,
        };
        const beginWindow = vi
          .spyOn(measurementProbe.gpuProfiler, "beginWindow")
          .mockImplementation(() => {
            throw new Error("preflight-window-created");
          });
        await expect(
          measurementProbe.measureMountedScene({
            ...savedOptions,
            executionHash: "b".repeat(64),
          }),
        ).rejects.toMatchObject({ code: "benchmark-source-stale" });
        const draft = {
          instanceId: "nested-source-instance",
          showDraft: true,
          executionHash: "c".repeat(64),
        };
        measurementProbe.draft = draft;
        await expect(
          measurementProbe.measureMountedScene(savedOptions),
        ).rejects.toMatchObject({ code: "benchmark-unpersisted-preview" });
        expect(measurementProbe.draft).toBe(draft);
        draft.executionHash = savedOptions.executionHash;
        await expect(
          measurementProbe.measureMountedScene(savedOptions),
        ).rejects.toMatchObject({ code: "benchmark-unpersisted-preview" });
        expect(measurementProbe.draft).toBe(draft);
        measurementProbe.draft = null;
        const preview = {
          instanceId: "nested-source-instance",
          instance: { ...mount.instance, opacity: 0.25 },
        };
        measurementProbe.instancePreview = preview;
        await expect(
          measurementProbe.measureMountedScene(savedOptions),
        ).rejects.toMatchObject({ code: "benchmark-unpersisted-preview" });
        expect(measurementProbe.instancePreview).toBe(preview);
        measurementProbe.instancePreview = null;
        for (const pending of [
          "draftRequestPending",
          "instancePreviewPending",
        ] as const) {
          measurementProbe[pending] = true;
          await expect(
            measurementProbe.measureMountedScene(savedOptions),
          ).rejects.toMatchObject({ code: "benchmark-unpersisted-preview" });
          expect(measurementProbe[pending]).toBe(true);
          measurementProbe[pending] = false;
        }
        const restoreWork = Promise.resolve();
        measurementProbe.previewRestoreWork = restoreWork;
        await expect(
          measurementProbe.measureMountedScene(savedOptions),
        ).rejects.toMatchObject({ code: "benchmark-unpersisted-preview" });
        expect(measurementProbe.previewRestoreWork).toBe(restoreWork);
        measurementProbe.previewRestoreWork = null;
        measurementProbe.compositionPixelBusy = true;
        await expect(
          measurementProbe.measureMountedScene(savedOptions),
        ).rejects.toMatchObject({ code: "composition-busy" });
        measurementProbe.compositionPixelBusy = false;
        expect(beginWindow).not.toHaveBeenCalled();
        expect(measurementProbe.mountedBenchmark).toBeNull();
        beginWindow.mockRestore();
        measurementProbe.gpuProfiler.forget(mount);
        const startBoundary = measurementProbe.gpuProfiler.sampleBoundary();
        const live = measurementProbe.measureMountedScene({
          instanceId: "two-texture-instance",
          executionHash: mount.definitionHash,
          request: measurementRequest,
          signal: new AbortController().signal,
        });
        expect(measurementProbe.mountedBenchmark).not.toBeNull();
        driveSyntheticWindow();
        const postWindow = measurementProbe.gpuProfiler.beginSample(
          mount,
          mount.definitionHash,
          JSON.stringify(mount.instance),
          "two-texture-instance",
        );
        expect(postWindow.kind).toBe("sample");
        const measured = await live;
        expect(measured).toMatchObject({
          gpuThroughFrameIndex: startBoundary,
          gpuWindow: {
            kind: "unavailable",
            code: "no-measured-samples",
            throughFrameIndex: startBoundary,
            gpuPassSumMs: null,
          },
        });
        expect(measurementProbe.mountedBenchmark).toBeNull();
        for (const change of ["definition", "instance", "device"] as const) {
          const oldDefinition = mount.definitionHash,
            oldInstance = mount.instance,
            oldEpoch = measurementProbe.deviceEpoch;
          const invalid = measurementProbe.measureMountedScene({
            instanceId: "two-texture-instance",
            executionHash: mount.definitionHash,
            request: measurementRequest,
            signal: new AbortController().signal,
          });
          if (change === "definition")
            mount.definitionHash = "changed-private-definition";
          else if (change === "instance")
            mount.instance = { ...mount.instance, opacity: 0.2 };
          else measurementProbe.deviceEpoch += 1;
          driveSyntheticWindow();
          await expect(invalid).rejects.toMatchObject({
            code:
              change === "definition"
                ? "benchmark-source-stale"
                : "benchmark-unavailable",
          });
          mount.definitionHash = oldDefinition;
          mount.instance = oldInstance;
          measurementProbe.deviceEpoch = oldEpoch;
          expect(measurementProbe.mountedBenchmark).toBeNull();
        }
        for (const generation of [
          "draftGeneration",
          "instancePreviewGeneration",
        ] as const) {
          const invalid = measurementProbe.measureMountedScene(savedOptions);
          measurementProbe[generation] += 1;
          driveSyntheticWindow();
          await expect(invalid).rejects.toMatchObject({
            code: "benchmark-unpersisted-preview",
          });
          expect(measurementProbe.mountedBenchmark).toBeNull();
        }
        const latePreview = measurementProbe.measureMountedScene(savedOptions);
        driveSyntheticWindow();
        measurementProbe.instancePreview = preview;
        await expect(latePreview).rejects.toMatchObject({
          code: "benchmark-unpersisted-preview",
        });
        expect(measurementProbe.instancePreview).toBe(preview);
        measurementProbe.instancePreview = null;
        const canceled = new AbortController();
        const invalid = measurementProbe.measureMountedScene({
          instanceId: "two-texture-instance",
          executionHash: mount.definitionHash,
          request: measurementRequest,
          signal: canceled.signal,
        });
        canceled.abort();
        await expect(invalid).rejects.toMatchObject({
          code: "benchmark-aborted",
        });
        const recovery = measurementProbe.measureMountedScene({
          instanceId: "two-texture-instance",
          executionHash: mount.definitionHash,
          request: measurementRequest,
          signal: new AbortController().signal,
        });
        driveSyntheticWindow();
        await recovery;
      } finally {
        visible.mockRestore();
      }
      expect(nativeCanvasConfigurations.length).toBeGreaterThan(0);
      expect(
        nativeCanvasConfigurations.every(
          (configuration) =>
            configuration.format === "rgba8unorm" &&
            configuration.colorSpace === "srgb",
        ),
      ).toBe(true);
      const blur = textures.find(
        (texture) => texture.format === "rgba16float" && texture.width === 4,
      );
      const color = textures.find(
        (texture) => texture.format === "rgba8unorm" && texture.width === 13,
      );
      expect(blur).toBeDefined();
      expect(color).toBeDefined();
      expect(rendered.indexOf(blur!.id)).toBeLessThan(
        rendered.indexOf(color!.id),
      );
      const mix = bound.find((group) =>
        group.entries.some(
          (entry) =>
            entry.binding === 3 &&
            (entry.resource as { textureId?: number }).textureId === blur!.id,
        ),
      );
      expect(mix).toBeDefined();
      const sharp = mix!.entries.find((entry) => entry.binding === 2)
        ?.resource as { textureId: number };
      expect(sharp.textureId).not.toBe(blur!.id);
      const presentation = document.querySelector<HTMLCanvasElement>(
        'canvas[data-an-native-canvas="two-texture-instance"]',
      );
      expect(presentation?.width).toBe(13);
      expect(presentation?.height).toBe(13);
      expect(presentation?.style.left).toBe("-2px");
      expect(presentation?.style.top).toBe("-2px");
      expect(presentation?.style.width).toBe("12.25px");
      expect(presentation?.style.height).toBe("12.25px");
      const internal = runtime as unknown as {
        draftGeneration: number;
        draft: { publishedTexture: FakeTexture | null } | null;
        running: Promise<unknown> | null;
        workingFormat: GPUTextureFormat;
        device: object | null;
        textureRetirement: FakeTexture[];
        transparent: FakeTexture;
        mounts: Map<
          string,
          {
            definition: EffectDefinition;
            instance: EffectInstance;
            outputTexture: FakeTexture | null;
            width: number;
            height: number;
            pixelRatio: number;
            frameCount: number;
            assetAbort: AbortController;
            assetTextures: Map<
              string,
              { texture: FakeTexture; lastFrame: number }
            >;
            outputExtent: {
              left: number;
              top: number;
              sourceWidth: number;
              sourceHeight: number;
            } | null;
          }
        >;
        previewDraft(
          request: Record<string, unknown>,
          generation: number,
        ): Promise<void>;
        controlDraft(
          request: Record<string, unknown>,
          generation: number,
        ): Promise<void>;
        postDraftResult(...args: unknown[]): void;
        renderInternal(
          time: number,
          deterministic: boolean,
        ): Promise<{
          failures: { code: string }[];
        }>;
        composeScene(
          mount: object,
          scene: NativeSourceRecord[],
          encoder: object,
        ): Promise<FakeTexture>;
        loadStandaloneApprovals(): void;
        loadInputAsset(
          mount: object,
          path: string,
          sampleEncoding?:
            | "srgb-color"
            | "srgb-color-premultiplied"
            | "linear-data"
            | "srgb-encoded-straight",
          preprocess?: "paper-liquid-mask" | "paper-gem-smoke-mask-32",
          mipmap?: "generated",
          revision?: number,
        ): Promise<FakeTexture>;
      };
      const draftResults: unknown[][] = [];
      internal.postDraftResult = (...args) => draftResults.push(args);
      const mounted = internal.mounts.get("two-texture-instance")!;
      const committedDefinition = mounted.definition;
      expect(internal.workingFormat).toBe("rgba16float");
      const densityProbe = internal as typeof internal & {
        effectPasses(
          mount: object,
          source: FakeTexture,
          time: number,
          encoder: object,
          definition: EffectDefinition,
          instance: EffectInstance,
        ): Promise<FakeTexture>;
        destroyTexture(texture: FakeTexture): void;
        destroyUniform(buffer: GPUBuffer): void;
      };
      const unexpanded = { ...definition, extent: undefined };
      const densityCases = [
        { cssWidth: 8.25, ratio: 1.6, screenWidth: 4.125 },
        { cssWidth: 8.25, ratio: 4, screenWidth: 33 },
        { cssWidth: 17.2, ratio: 4, screenWidth: 17.2 },
        { cssWidth: 334, ratio: 1.6, screenWidth: 400.8 },
      ];
      for (const item of densityCases) {
        const probeTarget = document.createElement("div");
        vi.spyOn(probeTarget, "getBoundingClientRect").mockReturnValue(
          new DOMRect(0, 0, item.screenWidth, item.screenWidth),
        );
        Object.defineProperties(probeTarget, {
          offsetWidth: { value: item.cssWidth },
          offsetHeight: { value: item.cssWidth },
        });
        const probeMount = {
          ...mounted,
          target: probeTarget,
          width: Math.ceil(item.cssWidth * item.ratio),
          height: Math.ceil(item.cssWidth * item.ratio),
          pixelRatio: item.ratio,
          outputExtent: null,
          resourceTextures: new Map<string, FakeTexture>(),
          drawBindings: new Map<string, { buffer: GPUBuffer }>(),
        };
        const beforeUniforms = writtenUniforms.length;
        try {
          await densityProbe.effectPasses(
            probeMount,
            mounted.outputTexture!,
            0.25,
            device.createCommandEncoder(),
            unexpanded,
            mounted.instance,
          );
          const uniforms = writtenUniforms
            .slice(beforeUniforms)
            .filter((values) => values.length === 136);
          expect(uniforms).toHaveLength(2);
          expect(uniforms.map((values) => values[6])).toEqual([
            Math.fround(item.ratio),
            Math.fround(item.ratio),
          ]);
          expect(uniforms[0]![0]).toBe(4);
          expect(uniforms[1]![0]).toBe(probeMount.width);
        } finally {
          for (const texture of probeMount.resourceTextures.values())
            densityProbe.destroyTexture(texture);
          for (const binding of probeMount.drawBindings.values())
            densityProbe.destroyUniform(binding.buffer);
        }
      }
      const baseExecutionHash = await hashEffectDefinition(definition);
      const draftDefinition = {
        ...definition,
        passes: definition.passes.map((pass) => ({
          ...pass,
          wgsl: `${pass.wgsl}\n// draft changed`,
        })),
      };
      const expectedExecutionHash = await hashEffectDefinition(draftDefinition);
      if (internal.running) await internal.running;
      const published = mounted.outputTexture!;
      expect(published.format).toBe("rgba16float");
      const renderedBeforeDraft = rendered.length;
      const savedManifest = manifest.textContent;
      internal.draftGeneration = 1;
      await internal.previewDraft(
        {
          requestId: "draft-one",
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          nodeId: "two-texture-node",
          baseExecutionHash,
          expectedExecutionHash,
          draftDefinition,
          params: {},
          seed: 1,
          time: 0,
        },
        1,
      );
      expect(mounted.definition).toBe(committedDefinition);
      expect(manifest.textContent).toBe(savedManifest);
      expect(
        internal.draft?.publishedTexture,
        JSON.stringify({ draftResults, renderedBeforeDraft, rendered }),
      ).toBe(published);
      expect(mounted.outputTexture).not.toBe(internal.draft?.publishedTexture);
      const draftPixels = mounted.outputTexture;
      const invalidDraft = {
        ...draftDefinition,
        passes: draftDefinition.passes.map((pass, index) => ({
          ...pass,
          wgsl: index === 0 ? `${pass.wgsl}\n// INVALID_DRAFT` : pass.wgsl,
        })),
      };
      internal.draftGeneration = 2;
      await internal.previewDraft(
        {
          requestId: "draft-two",
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          nodeId: "two-texture-node",
          baseExecutionHash,
          expectedExecutionHash: await hashEffectDefinition(invalidDraft),
          draftDefinition: invalidDraft,
          params: {},
          seed: 1,
          time: 0,
        },
        2,
      );
      expect(mounted.outputTexture).toBe(draftPixels);
      expect(draftResults[draftResults.length - 1]?.[3]).toEqual([
        expect.objectContaining({
          passId: invalidDraft.passes[0]!.id,
          line: 7,
          column: 4,
          code: "shader-compile-failed",
        }),
      ]);
      expect(invalidDraftCompiles).toBe(1);
      await internal.renderInternal(0, false);
      expect(invalidDraftCompiles).toBe(1);
      expect((await internal.renderInternal(0, true)).failures).toEqual([
        expect.objectContaining({ code: "shader-compile-failed" }),
      ]);
      const computeFailure = await (
        internal as typeof internal & {
          simulationPipeline(
            pass: EffectDefinition["passes"][number],
          ): Promise<unknown>;
        }
      )
        .simulationPipeline({
          ...invalidDraft.passes[0]!,
          kind: "compute",
          wgsl: "INVALID_DRAFT",
        } as EffectDefinition["passes"][number])
        .catch((error: unknown) => error);
      expect(computeFailure).toMatchObject({
        code: "shader-compile-failed",
        issues: [
          expect.objectContaining({
            passId: invalidDraft.passes[0]!.id,
            line: 7,
            column: 4,
          }),
        ],
      });
      internal.draftGeneration = 3;
      await internal.controlDraft(
        {
          requestId: "clear-draft",
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          baseExecutionHash,
          command: "clear",
        },
        3,
      );
      expect(mounted.definition).toBe(committedDefinition);
      expect(manifest.textContent).toBe(savedManifest);
      expect(mounted.outputTexture?.id).not.toBe(draftPixels?.id);
      expect(draftResults[draftResults.length - 1]?.slice(0, 4)).toEqual([
        "clear-draft",
        "two-texture-instance",
        "ready",
        [],
      ]);
      internal.draftGeneration = 4;
      await internal.controlDraft(
        {
          requestId: "clear-again",
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          baseExecutionHash,
          command: "clear",
        },
        4,
      );
      expect(draftResults[draftResults.length - 1]?.slice(0, 3)).toEqual([
        "clear-again",
        "two-texture-instance",
        "ready",
      ]);
      internal.draftGeneration = 5;
      await internal.controlDraft(
        {
          requestId: "clear-foreign-base",
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          baseExecutionHash: "different-definition-hash",
          command: "clear",
        },
        5,
      );
      expect(draftResults[draftResults.length - 1]?.slice(0, 4)).toEqual([
        "clear-foreign-base",
        "two-texture-instance",
        "error",
        [expect.objectContaining({ code: "draft-session-stale" })],
      ]);
      const parentDescriptor = Object.getOwnPropertyDescriptor(
        window,
        "parent",
      );
      const parentMessages: Record<string, unknown>[] = [];
      const parent = {
        location: { origin: location.origin },
        postMessage(message: Record<string, unknown>) {
          parentMessages.push(message);
        },
      };
      Object.defineProperty(window, "parent", {
        configurable: true,
        value: parent,
      });
      try {
        const listener = internal as typeof internal & {
          onMessage(event: MessageEvent): void;
          instancePreview: { instanceId: string } | null;
          instancePreviewGeneration: number;
        };
        const pipelineCompile = vi.spyOn(device, "createRenderPipelineAsync");
        const compiledBeforePreview = pipelineCompile.mock.calls.length;
        const persistedSignature = await hashEffectInstance(mounted.instance);
        const previewBase = {
          schemaVersion: 1,
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          nodeId: "two-texture-node",
          baseExecutionHash,
          baseInstanceSignature: persistedSignature,
        };
        const send = (request: Record<string, unknown>) =>
          listener.onMessage({
            data: request,
            source: parent,
            origin: location.origin,
          } as unknown as MessageEvent);
        send({
          ...previewBase,
          type: "native-effect-set-instance",
          requestId: "instance-first",
          sequence: 1,
          transform: { translate: [2, -1] },
          opacity: 0.5,
        });
        await vi.waitFor(() =>
          expect(parentMessages).toContainEqual(
            expect.objectContaining({
              requestId: "instance-first",
              status: "ready",
              displayed: "preview",
            }),
          ),
        );
        expect(listener.instancePreview?.instanceId).toBe(
          "two-texture-instance",
        );
        expect(mounted.instance.opacity).toBe(1);
        expect(manifest.textContent).toBe(savedManifest);
        send({
          ...previewBase,
          type: "native-effect-set-instance",
          requestId: "instance-second",
          sequence: 2,
          transform: { rotate: Math.PI / 6 },
          opacity: 0.3,
        });
        await vi.waitFor(() =>
          expect(parentMessages).toContainEqual(
            expect.objectContaining({
              requestId: "instance-second",
              status: "ready",
              displayed: "preview",
            }),
          ),
        );
        expect(pipelineCompile.mock.calls.length).toBe(compiledBeforePreview);
        mounted.instance = { ...mounted.instance, opacity: 0.3 };
        listener.instancePreview = null;
        listener.instancePreviewGeneration += 1;
        send({
          ...previewBase,
          type: "native-effect-clear-instance",
          requestId: "instance-clear",
          sequence: 3,
        });
        await vi.waitFor(() =>
          expect(parentMessages).toContainEqual(
            expect.objectContaining({
              requestId: "instance-clear",
              status: "ready",
              displayed: "published",
            }),
          ),
        );
        send({
          ...previewBase,
          type: "native-effect-set-instance",
          requestId: "instance-delayed",
          sequence: 2,
          transform: { translate: [4, 0] },
          opacity: 0.8,
        });
        expect(parentMessages).toContainEqual(
          expect.objectContaining({
            requestId: "instance-delayed",
            status: "error",
            code: "instance-preview-superseded",
          }),
        );
        expect(listener.instancePreview).toBeNull();
        expect(mounted.instance.opacity).toBe(0.3);
        expect(pipelineCompile.mock.calls.length).toBe(compiledBeforePreview);
      } finally {
        if (parentDescriptor)
          Object.defineProperty(window, "parent", parentDescriptor);
      }
      for (const transform of [
        { translate: [2, -1] },
        { scale: [1.5, 0.75] },
        { rotate: Math.PI / 6 },
      ] satisfies NonNullable<EffectInstance["transform"]>[]) {
        mounted.instance.transform = transform;
        const result = await internal.renderInternal(0, true);
        expect(result.failures).toEqual([]);
        const geometry = {
          width: mounted.width,
          height: mounted.height,
          pixelRatio: mounted.pixelRatio,
          target: {
            x: mounted.outputExtent?.left ?? 0,
            y: mounted.outputExtent?.top ?? 0,
            width: mounted.outputExtent?.sourceWidth ?? mounted.width,
            height: mounted.outputExtent?.sourceHeight ?? mounted.height,
          },
        };
        const expected = planNativeEffectTransform(transform, geometry);
        expect(expected.ok).toBe(true);
        if (!expected.ok) continue;
        const finishData = [...writtenUniforms]
          .reverse()
          .find((data) => data.length === 28);
        expect(finishData).toBeDefined();
        const actual = Array.from(finishData!.slice(20, 28));
        const planned = [...expected.rows[0], ...expected.rows[1]];
        for (let index = 0; index < planned.length; index += 1)
          expect(actual[index]).toBeCloseTo(planned[index], 5);
      }
      mounted.instance.transform = undefined;
      const fetchAsset = vi.fn(
        async (url: string) =>
          new Response(new Uint8Array([1, 2, 3, 4]), {
            status: url.includes("missing") ? 404 : 200,
            headers: { "content-type": "image/png" },
          }),
      );
      const closeBitmap = vi.fn();
      let bitmapOversize = false;
      const bitmapOptions: ImageBitmapOptions[] = [];
      vi.stubGlobal("fetch", fetchAsset);
      vi.stubGlobal(
        "createImageBitmap",
        async (_blob: Blob, options: ImageBitmapOptions) => {
          bitmapOptions.push(options);
          return {
            width: bitmapOversize ? 8_193 : 2,
            height: 2,
            close: closeBitmap,
          };
        },
      );
      const inputDefinition: EffectDefinition = {
        ...definition,
        properties: {
          maskAsset: {
            type: "texture",
            label: "Coverage image",
            input: "coverage",
            default: null,
          },
        },
        inputs: {
          source: { kind: "texture-2d", resource: "source" },
          coverage: { kind: "mask", resource: "coverage" },
        },
        resources: [
          ...definition.resources!,
          { name: "coverage", kind: "texture-2d", external: true },
        ],
        passes: definition.passes.map((pass, index) =>
          index === 1 ? { ...pass, reads: ["source", "coverage"] } : pass,
        ),
      };
      for (const [generation, url] of [
        [4, "/masks/first.png"],
        [5, "/masks/second.png"],
      ] as const) {
        internal.draftGeneration = generation;
        await internal.previewDraft(
          {
            requestId: `asset-${generation}`,
            runtimeEpoch: runtime!.epoch,
            instanceId: "two-texture-instance",
            nodeId: "two-texture-node",
            baseExecutionHash,
            expectedExecutionHash: await hashEffectDefinition(inputDefinition),
            draftDefinition: inputDefinition,
            params: { maskAsset: { kind: "asset", url } },
            seed: 1,
            time: 0,
          },
          generation,
        );
        expect(target.getAttribute("data-an-native-status")).toBe("ready");
      }
      expect(fetchAsset.mock.calls.map(([url]) => url)).toEqual([
        new URL("/masks/first.png", document.baseURI).href,
        new URL("/masks/second.png", document.baseURI).href,
      ]);
      expect(copied).toHaveLength(2);
      expect(closeBitmap).toHaveBeenCalledTimes(2);
      const assetBind = bound.find((group) =>
        group.entries.some(
          (entry) =>
            entry.binding === 3 &&
            (entry.resource as { textureId?: number }).textureId === copied[1],
        ),
      );
      expect(assetBind).toBeDefined();
      expect(destroyed).toContain(copied[0]);
      cornerRadius = 2;
      const maskDefinition: EffectDefinition = {
        ...inputDefinition,
        inputs: {
          source: { kind: "texture-2d", resource: "source" },
          coverage: { kind: "mask", resource: "mask" },
        },
        resources: [
          ...definition.resources!,
          { name: "mask", kind: "texture-2d", external: true },
        ],
        passes: inputDefinition.passes.map((pass, index) =>
          index === 1 ? { ...pass, reads: ["source", "mask"] } : pass,
        ),
      };
      internal.draftGeneration = 6;
      await internal.previewDraft(
        {
          requestId: "rounded-mask",
          runtimeEpoch: runtime!.epoch,
          instanceId: "two-texture-instance",
          nodeId: "two-texture-node",
          baseExecutionHash,
          expectedExecutionHash: await hashEffectDefinition(maskDefinition),
          draftDefinition: maskDefinition,
          params: {},
          seed: 1,
          time: 0,
        },
        6,
      );
      const maskTexture = (
        internal.mounts.get("two-texture-instance") as unknown as {
          resourceTextures: Map<string, FakeTexture>;
        }
      ).resourceTextures.get("__native_input_mask");
      expect(
        maskTexture,
        JSON.stringify(draftResults[draftResults.length - 1]),
      ).toBeDefined();
      expect(
        bound.some((group) =>
          group.entries.some(
            (entry) =>
              entry.binding === 3 &&
              (entry.resource as { textureId?: number }).textureId ===
                maskTexture?.id,
          ),
        ),
      ).toBe(true);
      expect(fetchAsset).toHaveBeenCalledTimes(2);
      for (const [generation, url, code] of [
        [7, "/masks/missing.png", "input-asset-unreadable"],
        [8, "/masks/oversize.png", "input-asset-size"],
      ] as const) {
        bitmapOversize = url.includes("oversize");
        internal.draftGeneration = generation;
        await internal.previewDraft(
          {
            requestId: `asset-failure-${generation}`,
            runtimeEpoch: runtime!.epoch,
            instanceId: "two-texture-instance",
            nodeId: "two-texture-node",
            baseExecutionHash,
            expectedExecutionHash: await hashEffectDefinition(inputDefinition),
            draftDefinition: inputDefinition,
            params: { maskAsset: { kind: "asset", url } },
            seed: 1,
            time: 0,
          },
          generation,
        );
        expect(draftResults[draftResults.length - 1]).toEqual(
          expect.arrayContaining([
            expect.arrayContaining([expect.objectContaining({ code })]),
          ]),
        );
      }
      bitmapOversize = false;
      expect(copied).toHaveLength(2);
      const fetchCallsBeforeEmbedded = fetchAsset.mock.calls.length;
      const embedded = document.createElement("script");
      embedded.type = "application/x-agent-native-effect-assets";
      embedded.setAttribute("data-agent-native-export-assets", "");
      embedded.textContent = JSON.stringify({
        schemaVersion: 1,
        assets: [
          {
            path: "/masks/embedded.png",
            mimeType: "image/png",
            byteLength: 4,
            sha256:
              "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
            base64: "AQIDBA==",
          },
          {
            path: "/masks/tampered.png",
            mimeType: "image/png",
            byteLength: 4,
            sha256: "0".repeat(64),
            base64: "AQIDBA==",
          },
        ],
      });
      document.body.append(embedded);
      for (const [generation, url, code] of [
        [9, "/masks/embedded.png", ""],
        [10, "/masks/tampered.png", "input-embedded-digest"],
      ] as const) {
        internal.draftGeneration = generation;
        await internal.previewDraft(
          {
            requestId: `embedded-${generation}`,
            runtimeEpoch: runtime!.epoch,
            instanceId: "two-texture-instance",
            nodeId: "two-texture-node",
            baseExecutionHash,
            expectedExecutionHash: await hashEffectDefinition(inputDefinition),
            draftDefinition: inputDefinition,
            params: { maskAsset: { kind: "asset", url } },
            seed: 1,
            time: 0,
          },
          generation,
        );
        if (code)
          expect(draftResults[draftResults.length - 1]).toEqual(
            expect.arrayContaining([
              expect.arrayContaining([expect.objectContaining({ code })]),
            ]),
          );
        else
          expect(
            target.getAttribute("data-an-native-status"),
            JSON.stringify(draftResults[draftResults.length - 1]),
          ).toBe("ready");
      }
      expect(fetchAsset).toHaveBeenCalledTimes(fetchCallsBeforeEmbedded);
      expect(copied).toHaveLength(3);
      const assetMount = internal.mounts.get("two-texture-instance")!;
      const rawAsset = await internal.loadInputAsset(
        assetMount,
        "/masks/data.png",
        "linear-data",
      );
      const colorAsset = await internal.loadInputAsset(
        assetMount,
        "/masks/data.png",
        "srgb-color",
      );
      expect(rawAsset.format).toBe("rgba8unorm");
      expect(colorAsset.format).toBe("rgba8unorm-srgb");
      expect(
        bitmapOptions[bitmapOptions.length - 2]?.colorSpaceConversion,
      ).toBe("none");
      expect(
        bitmapOptions[bitmapOptions.length - 1]?.colorSpaceConversion,
      ).toBe("default");
      expect(rawAsset.id).not.toBe(colorAsset.id);
      const normalizedColorAsset = await internal.loadInputAsset(
        assetMount,
        "/masks/data.png",
        "srgb-color-premultiplied",
      );
      expect(normalizedColorAsset.format).toBe("rgba16float");
      expect(normalizedColorAsset.id).not.toBe(colorAsset.id);
      const encodedColorTexture = textures.find(
        (texture) => texture.id === copied[copied.length - 1],
      );
      expect(encodedColorTexture?.format).toBe("rgba8unorm-srgb");
      expect(normalizedColorAsset.id).not.toBe(encodedColorTexture?.id);
      expect(
        bound.some((group) =>
          group.entries.some(
            (entry) =>
              (entry.resource as { textureId?: number }).textureId ===
              encodedColorTexture?.id,
          ),
        ),
      ).toBe(true);
      expect(
        await internal.loadInputAsset(
          assetMount,
          "/masks/data.png",
          "srgb-color",
        ),
      ).toBe(colorAsset);
      expect(
        await internal.loadInputAsset(
          assetMount,
          "/masks/data.png",
          "linear-data",
        ),
      ).toBe(rawAsset);
      const cachedAssetCount = assetMount.assetTextures.size;
      const retireBeforeFailure = internal.textureRetirement.length;
      nextValidationError = "color normalization rejected";
      await expect(
        internal.loadInputAsset(
          assetMount,
          "/masks/color-validation-fail.png",
          "srgb-color-premultiplied",
        ),
      ).rejects.toMatchObject({ code: "input-asset-upload" });
      expect(assetMount.assetTextures.size).toBe(cachedAssetCount);
      expect(internal.textureRetirement.length).toBe(retireBeforeFailure + 2);
      const originalAbort = assetMount.assetAbort;
      const abortDuringValidation = new AbortController();
      assetMount.assetAbort = abortDuringValidation;
      duringNextValidation = () => abortDuringValidation.abort();
      await expect(
        internal.loadInputAsset(
          assetMount,
          "/masks/color-abort.png",
          "srgb-color-premultiplied",
        ),
      ).rejects.toMatchObject({ code: "input-asset-aborted" });
      assetMount.assetAbort = originalAbort;
      expect(assetMount.assetTextures.size).toBe(cachedAssetCount);
      const originalDevice = internal.device;
      duringNextValidation = () => {
        internal.device = null;
      };
      await expect(
        internal.loadInputAsset(
          assetMount,
          "/masks/color-device-change.png",
          "srgb-color-premultiplied",
        ),
      ).rejects.toMatchObject({ code: "input-device-changed" });
      internal.device = originalDevice;
      expect(assetMount.assetTextures.size).toBe(cachedAssetCount);
      await expect(
        internal.loadInputAsset(
          assetMount,
          "/masks/color-mips.png",
          "srgb-color-premultiplied",
          undefined,
          "generated",
        ),
      ).rejects.toMatchObject({ code: "input-processing-invalid" });
      const encoded = await internal.loadInputAsset(
        assetMount,
        "/masks/data.png",
        "srgb-encoded-straight",
        undefined,
        "generated",
        7,
      );
      expect(encoded.format).toBe("rgba8unorm");
      expect(encoded.mipLevelCount).toBe(2);
      expect(encoded.id).not.toBe(rawAsset.id);
      expect(
        bitmapOptions[bitmapOptions.length - 1]?.colorSpaceConversion,
      ).toBe("none");
      expect(encodedMipCopies).toEqual([
        expect.objectContaining({ destination: encoded.id, level: 1 }),
      ]);
      expect(
        await internal.loadInputAsset(
          assetMount,
          "/masks/data.png",
          "srgb-encoded-straight",
          undefined,
          "generated",
          7,
        ),
      ).toBe(encoded);
      const revisedEncoded = await internal.loadInputAsset(
        assetMount,
        "/masks/data.png",
        "srgb-encoded-straight",
        undefined,
        "generated",
        8,
      );
      expect(revisedEncoded.id).not.toBe(encoded.id);
      rejectMipSubmit = true;
      const destroyedBeforeSubmitFailure = destroyed.length;
      await expect(
        internal.loadInputAsset(
          assetMount,
          "/masks/mip-submit-fail.png",
          "srgb-encoded-straight",
          undefined,
          "generated",
          9,
        ),
      ).rejects.toMatchObject({ code: "input-asset-upload" });
      expect(destroyed.length).toBe(destroyedBeforeSubmitFailure + 2);
      rejectMipSubmit = false;
      vi.stubGlobal("createImageBitmap", async () => {
        throw new Error("raw decoding unavailable");
      });
      await expect(
        internal.loadInputAsset(assetMount, "/masks/no-raw.png", "linear-data"),
      ).rejects.toMatchObject({ code: "input-data-decode-unsupported" });
      await expect(
        internal.loadInputAsset(
          assetMount,
          "/masks/retired.png",
          "linear-data",
          "paper-liquid-mask",
          "generated",
        ),
      ).rejects.toMatchObject({ code: "input-preprocess-retired" });

      vi.stubGlobal("createImageBitmap", async () => ({
        width: 2,
        height: 2,
        close: closeBitmap,
      }));
      vi.stubGlobal("createImageBitmap", async () => ({
        width: 4,
        height: 4,
        close: closeBitmap,
      }));

      const optionalDefinition: EffectDefinition = {
        id: "optional-image-test",
        name: "Optional image test",
        version: 1,
        kind: "generator",
        placements: ["fill"],
        optionalImage: { port: "image", abi: "paper-optional-image-v1" },
        properties: {
          image: {
            type: "texture",
            label: "Image",
            default: null,
            input: "image",
          },
          fit: {
            type: "enum",
            label: "Fit",
            default: "contain",
            options: ["none", "contain", "cover"],
          },
          scale: {
            type: "float",
            label: "Scale",
            default: 1,
            min: 0.01,
            max: 8,
          },
          rotation: {
            type: "float",
            label: "Rotation",
            default: 0,
            min: 0,
            max: 360,
          },
          originX: {
            type: "float",
            label: "Origin X",
            default: 0.5,
            min: 0,
            max: 1,
          },
          originY: {
            type: "float",
            label: "Origin Y",
            default: 0.5,
            min: 0,
            max: 1,
          },
          offsetX: {
            type: "float",
            label: "Offset X",
            default: 0,
            min: -1,
            max: 1,
          },
          offsetY: {
            type: "float",
            label: "Offset Y",
            default: 0,
            min: -1,
            max: 1,
          },
        },
        inputs: {
          image: {
            kind: "texture-2d",
            resource: "image",
            optional: true,
            fallback: "transparent-data",
          },
          noise: { kind: "texture-2d", resource: "noise" },
        },
        resources: [
          {
            name: "image",
            kind: "texture-2d",
            external: true,
            usage: ["sampled"],
            sampleEncoding: "srgb-encoded-straight",
            mipmap: "generated",
          },
          {
            name: "noise",
            kind: "texture-2d",
            external: true,
            usage: ["sampled"],
            sampleEncoding: "linear-data",
          },
          {
            name: "color",
            kind: "texture-2d",
            format: "rgba16float",
            size: "viewport",
            usage: ["render", "sampled"],
          },
        ],
        output: "color",
        passes: [
          {
            id: "render",
            kind: "render",
            reads: ["image", "noise"],
            output: "color",
            wgsl: "retired-uncompiled-wgsl",
          },
        ],
        provenance: { origin: "design-original" },
      };
      const optionalRunner = runtime as unknown as {
        effectPasses(
          mount: object,
          source: GPUTexture,
          time: number,
          encoder: object,
          definition: EffectDefinition,
          instance: EffectInstance,
        ): Promise<FakeTexture>;
      };
      const optionalInstance: EffectInstance = {
        ...mounted.instance,
        definitionId: optionalDefinition.id,
        definitionVersion: optionalDefinition.version,
        placement: "fill",
        params: { image: { kind: "asset", url: "/masks/gem.png" } },
        bindings: { noise: { kind: "asset", url: "/masks/data.png" } },
      };
      await expect(
        optionalRunner.effectPasses(
          assetMount,
          null as unknown as GPUTexture,
          0,
          device.createCommandEncoder(),
          optionalDefinition,
          optionalInstance,
        ),
      ).rejects.toMatchObject({ code: "legacy-image-abi-retired" });
      expect(fetchAsset).not.toHaveBeenCalledWith(
        "/masks/gem.png",
        expect.any(Object),
      );

      const generator = CATALOG_GENERATOR_CANDIDATES[0];
      expect(generator.passes[0].reads).toEqual([]);
      const passRunner = runtime as unknown as {
        mounts: Map<string, object>;
        effectPasses(
          mount: object,
          source: GPUTexture,
          time: number,
          encoder: object,
          definition: EffectDefinition,
          instance: EffectInstance,
          deterministic?: boolean,
          sourceRevision?: string,
        ): Promise<FakeTexture>;
      };
      await expect(
        passRunner.effectPasses(
          assetMount,
          null as unknown as GPUTexture,
          0,
          device.createCommandEncoder(),
          {
            ...generator,
            passes: [
              {
                ...generator.passes[0],
                original: { retired: true },
              },
            ],
          },
          mounted.instance,
        ),
      ).rejects.toMatchObject({ code: "original-pass-retired" });
      const boundBeforeGenerator = bound.length;
      const generated = await passRunner.effectPasses(
        passRunner.mounts.get("two-texture-instance")!,
        null as unknown as GPUTexture,
        0,
        device.createCommandEncoder(),
        generator,
        {
          id: "two-texture-instance",
          nodeId: "two-texture-node",
          definitionId: generator.id,
          definitionVersion: generator.version,
          placement: "fill",
          params: {},
          enabled: true,
          opacity: 1,
          seed: 1,
          clip: "bounds",
          blend: "normal",
          timing: { speed: 1, paused: true, time: 0 },
        },
      );
      expect(generated).toBeDefined();
      const sizing = {
        inputSpace: "rendered-surface" as const,
        aspectRatio: 2,
        fit: "cover" as const,
        worldSize: [100, 50] as [number, number],
        origin: [0.5, 0.5] as [number, number],
        offset: [0, 0] as [number, number],
        scale: 1,
        rotationDegrees: 0,
        sampling: {
          min: "nearest" as const,
          mag: "linear" as const,
          mipmap: "none" as const,
        },
      };
      await expect(
        passRunner.effectPasses(
          passRunner.mounts.get("two-texture-instance")!,
          generated as unknown as GPUTexture,
          0,
          device.createCommandEncoder(),
          OWNED_RENDERED_SURFACE_TEST_EFFECT,
          {
            id: "two-texture-instance",
            nodeId: "two-texture-node",
            definitionId: OWNED_RENDERED_SURFACE_TEST_EFFECT.id,
            definitionVersion: OWNED_RENDERED_SURFACE_TEST_EFFECT.version,
            placement: "layer",
            params: {},
            enabled: true,
            opacity: 1,
            seed: 1,
            clip: "bounds",
            blend: "normal",
            timing: { speed: 1, paused: true, time: 0 },
            sourceSizing: sizing,
          },
        ),
      ).rejects.toMatchObject({ code: "legacy-image-abi-retired" });
      expect(
        bound
          .slice(boundBeforeGenerator)
          .some((group) =>
            group.entries.some(
              (entry) => entry.binding === 2 && entry.resource,
            ),
          ),
      ).toBe(true);
      const accounting = (
        runtime!.profile() as unknown as {
          textures: {
            allocatedBytes: number;
            mountedBytes: number;
            queuedRetirementBytes: number;
            inFlightRetirementBytes: number;
            sharedBytes: number;
            unattributedBytes: number;
          };
        }
      ).textures;
      expect(
        accounting.mountedBytes +
          accounting.queuedRetirementBytes +
          accounting.inFlightRetirementBytes +
          accounting.sharedBytes +
          accounting.unattributedBytes,
      ).toBe(accounting.allocatedBytes);
      const textFinish = runtime as unknown as {
        textMask(mount: object): Promise<FakeTexture>;
        finish(
          mount: object,
          source: FakeTexture,
          encoder: object,
          instance: EffectInstance,
          definition: EffectDefinition,
        ): Promise<FakeTexture>;
      };
      vi.spyOn(textFinish, "textMask").mockResolvedValue(textures[1]);
      const textInstance: EffectInstance = {
        id: "two-texture-instance",
        nodeId: "two-texture-node",
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement: "layer",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 1,
        clip: "text",
        blend: "normal",
        timing: { speed: 1, paused: true, time: 0 },
      };
      await textFinish.finish(
        passRunner.mounts.get("two-texture-instance")!,
        generated,
        device.createCommandEncoder(),
        textInstance,
        definition,
      );
      expect(writtenUniforms[writtenUniforms.length - 1]?.[5]).toBe(1);
      await textFinish.finish(
        passRunner.mounts.get("two-texture-instance")!,
        generated,
        device.createCommandEncoder(),
        { ...textInstance, placement: "fill" },
        generator,
      );
      expect(writtenUniforms[writtenUniforms.length - 1]?.[5]).toBe(1);
      await textFinish.finish(
        passRunner.mounts.get("two-texture-instance")!,
        generated,
        device.createCommandEncoder(),
        { ...textInstance, placement: "fill", clip: "bounds" },
        generator,
      );
      expect(writtenUniforms[writtenUniforms.length - 1]?.[5]).toBe(0);

      const maskRunner = runtime as unknown as {
        pipeline(wgsl: string, format: GPUTextureFormat): Promise<unknown>;
        inputMask(mount: object, encoder: object): Promise<FakeTexture>;
        mounts: Map<string, { resourceTextures: Map<string, FakeTexture> }>;
      };
      const maskMount = maskRunner.mounts.get("two-texture-instance")!;
      const bytesBeforeRejectedMask = (
        runtime!.profile() as unknown as {
          textures: { allocatedBytes: number; unattributedBytes: number };
        }
      ).textures;
      cornerRadius = 4;
      const pipelineFailure = vi
        .spyOn(maskRunner, "pipeline")
        .mockRejectedValue(new Error("mask pipeline refused"));
      for (let attempt = 0; attempt < 2; attempt += 1)
        await expect(
          maskRunner.inputMask(maskMount, device.createCommandEncoder()),
        ).rejects.toThrow("mask pipeline refused");
      pipelineFailure.mockRestore();
      expect(maskMount.resourceTextures.has("__native_input_mask")).toBe(false);
      expect(
        (
          runtime!.profile() as unknown as {
            textures: { allocatedBytes: number; unattributedBytes: number };
          }
        ).textures,
      ).toEqual(expect.objectContaining(bytesBeforeRejectedMask));

      const colorRuntime = runtime as unknown as {
        setDynamicRangeMode(mode: "sdr" | "hdr"): Promise<{
          hdr: string;
          outputDynamicRange: string;
          requestedDynamicRange: string;
          presentedDynamicRange: string;
          dynamicRangeReason?: string;
        }>;
      };
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(dynamic-range: standard)",
      }));
      const floatConfigurationsBefore = canvasConfigurations.filter(
        (configuration) => configuration.format === "rgba16float",
      ).length;
      expect(await colorRuntime.setDynamicRangeMode("hdr")).toEqual(
        expect.objectContaining({
          hdr: "unavailable",
          requestedDynamicRange: "hdr",
          presentedDynamicRange: "sdr",
          dynamicRangeReason: "display-not-high-capable",
        }),
      );
      expect(
        canvasConfigurations.filter(
          (configuration) => configuration.format === "rgba16float",
        ),
      ).toHaveLength(floatConfigurationsBefore);
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches:
          query === "(dynamic-range: high)" ||
          query === "(dynamic-range: standard)",
      }));
      expect(await colorRuntime.setDynamicRangeMode("hdr")).toEqual(
        expect.objectContaining({
          hdr: "configured",
          outputDynamicRange: "hdr",
          requestedDynamicRange: "hdr",
          presentedDynamicRange: "hdr",
        }),
      );
      expect(
        canvasConfigurations.some(
          (configuration) =>
            configuration.format === "rgba16float" &&
            configuration.toneMapping?.mode === "extended",
        ),
      ).toBe(true);
      expect(
        nativeCanvasConfigurations.some(
          (configuration) =>
            configuration.format === "rgba16float" &&
            configuration.toneMapping?.mode === "extended",
        ),
      ).toBe(true);
      allowFloatCanvas = false;
      await colorRuntime.setDynamicRangeMode("sdr");
      expect(await colorRuntime.setDynamicRangeMode("hdr")).toEqual(
        expect.objectContaining({
          hdr: "unavailable",
          outputDynamicRange: "sdr",
          requestedDynamicRange: "hdr",
          presentedDynamicRange: "sdr",
          dynamicRangeReason: "float-canvas-unavailable",
        }),
      );
      allowFloatCanvas = true;
      allowExtendedCanvas = false;
      await colorRuntime.setDynamicRangeMode("sdr");
      expect(await colorRuntime.setDynamicRangeMode("hdr")).toEqual(
        expect.objectContaining({
          hdr: "unavailable",
          outputDynamicRange: "sdr",
          requestedDynamicRange: "hdr",
          presentedDynamicRange: "sdr",
          dynamicRangeReason: "extended-tone-mapping-unavailable",
        }),
      );
      const authoredCanvas = document.createElement("canvas");
      authoredCanvas.width = 2;
      authoredCanvas.height = 2;
      const sourceRect = { x: 0, y: 0, width: 8.25, height: 8.25 };
      const composed = await internal.composeScene(
        mounted,
        [
          {
            key: 902,
            node: authoredCanvas,
            kind: "canvas",
            source: authoredCanvas,
            width: 2,
            height: 2,
            revision: 1,
            coordinateSpace: "target-local",
            rect: sourceRect,
            localBox: sourceRect,
            localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
            clip: sourceRect,
            clips: [],
            groupClips: [],
            isolationPath: [],
            opacity: 1,
          },
        ],
        device.createCommandEncoder(),
      );
      expect(composed.format).toBe("rgba16float");
      const rotatedBox = { x: 0, y: 0, width: 8.25, height: 4 };
      const rotatedBounds = { x: 0, y: 0, width: 4, height: 8.25 };
      const rotation = { a: 0, b: 1, c: -1, d: 0, e: 4, f: 0 };
      const zeroRadius = { x: 0, y: 0 };
      const beforeRotatedUniforms = writtenUniforms.length;
      await internal.composeScene(
        mounted,
        [
          {
            key: 903,
            node: authoredCanvas,
            kind: "canvas",
            source: authoredCanvas,
            width: 2,
            height: 2,
            revision: 1,
            coordinateSpace: "target-local",
            rect: rotatedBounds,
            localBox: rotatedBox,
            localToTarget: rotation,
            clip: rotatedBounds,
            clips: [
              {
                rect: rotatedBounds,
                localBox: rotatedBox,
                localToTarget: rotation,
                radii: {
                  topLeft: { x: 1, y: 1 },
                  topRight: zeroRadius,
                  bottomRight: zeroRadius,
                  bottomLeft: zeroRadius,
                },
              },
            ],
            groupClips: [],
            isolationPath: [],
            opacity: 1,
          },
        ],
        device.createCommandEncoder(),
      );
      const affineDraws = writtenUniforms
        .slice(beforeRotatedUniforms)
        .filter((uniform) => uniform.length === 36 + 8 * 20);
      expect(affineDraws).toHaveLength(1);
      const affineDraw = affineDraws[0]!;
      const physicalScale = affineDraw[2] / rotatedBounds.width;
      expect(affineDraw).toHaveLength(36 + 8 * 20);
      expect([...affineDraw.slice(24, 28)]).toEqual([0, 0, 8.25, 4]);
      expect(affineDraw[28]).toBe(0);
      expect(affineDraw[29]).toBeCloseTo(1 / physicalScale);
      expect(affineDraw[32]).toBeCloseTo(-1 / physicalScale);
      expect(affineDraw[34]).toBeCloseTo(4);
      expect([...affineDraw.slice(36, 40)]).toEqual([0, 0, 8.25, 4]);
      expect(affineDraw[40]).toBe(1);
      expect(affineDraw[48]).toBe(0);
      expect(affineDraw[49]).toBeCloseTo(1 / physicalScale);

      const grading: EffectDefinition = {
        ...definition,
        id: "grade-after-blur",
        extent: undefined,
        resources: definition.resources?.filter(
          (resource) => resource.name !== "blur",
        ),
        passes: [
          {
            id: "grade-pass",
            kind: "render",
            wgsl,
            reads: ["source"],
            output: "color",
          },
        ],
      };
      const savedApproval = approval.textContent;
      const authored = JSON.parse(savedManifest!) as {
        schemaVersion: number;
        definitions: EffectDefinition[];
        instances: EffectInstance[];
      };
      manifest.textContent = JSON.stringify({
        ...authored,
        definitions: [...authored.definitions, grading],
        instances: [
          ...authored.instances,
          {
            ...authored.instances[0],
            id: "grade-after-blur-instance",
            definitionId: grading.id,
          },
          {
            ...authored.instances[0],
            id: "second-blur-instance",
          },
        ],
      });
      approval.textContent = JSON.stringify({
        schemaVersion: 1,
        hashes: [
          await hashEffectDefinition(definition),
          await hashEffectDefinition(grading),
        ],
      });
      internal.loadStandaloneApprovals();
      const copyCount = chainCopies.length;
      await runtime!.scan();
      const first = internal.mounts.get("two-texture-instance")!;
      const middle = internal.mounts.get("grade-after-blur-instance")!;
      const last = internal.mounts.get("second-blur-instance")!;
      expect(first.outputTexture?.format).toBe("rgba16float");
      expect(middle.outputTexture?.format).toBe("rgba16float");
      expect(last.outputTexture?.format).toBe("rgba16float");
      expect([first.width, middle.width, last.width]).toEqual([13, 13, 17]);
      expect([
        first.outputExtent?.left,
        middle.outputExtent?.left,
        last.outputExtent?.left,
      ]).toEqual([2, 2, 4]);
      const alignedCopies = chainCopies.slice(copyCount);
      expect(alignedCopies.length).toBeGreaterThan(0);
      expect(alignedCopies).toEqual(
        expect.arrayContaining([
          {
            source: middle.outputTexture!.id,
            destination: expect.any(Number),
            origin: [2, 2, 0],
            size: [13, 13, 1],
          },
        ]),
      );
      expect(
        alignedCopies.every(
          (copy) =>
            copy.origin[0] === 2 &&
            copy.origin[1] === 2 &&
            copy.size[0] === 13 &&
            copy.size[1] === 13 &&
            textures.find((texture) => texture.id === copy.destination)
              ?.width === 17,
        ),
      ).toBe(true);
      expect(
        document.querySelector<HTMLCanvasElement>(
          'canvas[data-an-native-canvas="second-blur-instance"]',
        )?.style.left,
      ).toBe("-4px");
      expect(target.getAttribute("data-an-native-status")).toBe("ready");
      manifest.textContent = savedManifest;
      approval.textContent = savedApproval;
      internal.loadStandaloneApprovals();
      await runtime!.scan();
      const directImage = document.createElement("img");
      directImage.dataset.agentNativeNodeId = "two-texture-node";
      directImage.src = "/masks/intrinsic.png";
      Object.defineProperties(directImage, {
        complete: { value: true },
        naturalWidth: { value: 2 },
        naturalHeight: { value: 2 },
        offsetWidth: { value: 8.25 },
        offsetHeight: { value: 8.25 },
      });
      document.body.append(directImage);
      const directBox = { x: 0, y: 0, width: 8.25, height: 8.25 };
      const directRecord: NativeSourceRecord = {
        key: 904,
        node: directImage,
        kind: "image",
        source: directImage,
        width: 2,
        height: 2,
        revision: 12,
        coordinateSpace: "target-local",
        rect: directBox,
        localBox: directBox,
        localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        clip: directBox,
        clips: [],
        groupClips: [],
        isolationPath: [],
        opacity: 1,
        uv: { x: 0, y: 0, width: 1, height: 1 },
      };
      vi.stubGlobal("createImageBitmap", async () => ({
        width: 2,
        height: 2,
        close: closeBitmap,
      }));
      const directMount = internal.mounts.get(
        "two-texture-instance",
      )! as typeof mounted & {
        target: Element;
        provider: {
          readScene(): Promise<NativeSourceRecord[]>;
          setDensity(value: number): void;
          setLayerTargetOpacityDeferred(value: boolean): void;
          setGroupLocalBackdropSource(value: boolean): void;
          captureCount(): number;
          needsContinuousFrames(): boolean;
          diagnosticSnapshot(): {
            readSceneCalls: number;
            captures: number;
            activeLeaves: number;
            createdLeaves: number;
            retiredLeaves: number;
            invalidations: Record<string, number>;
            leaves: unknown[];
            omittedLeaves: number;
          };
          dispose(): void;
        } | null;
        previousLayerId: string | null;
        resourceTextures: Map<string, FakeTexture>;
        assetTextures: Map<string, { texture: FakeTexture }>;
      };
      const priorTarget = directMount.target;
      const priorProvider = directMount.provider;
      const priorDefinition = directMount.definition;
      const priorInstance = directMount.instance;
      const directRunner = internal as typeof internal & {
        renderMount(
          mount: typeof directMount,
          time: number,
          deterministic: boolean,
          complete: Set<string>,
          active: Set<string>,
        ): Promise<void>;
      };
      const densityTarget = document.createElement("div");
      Object.defineProperties(densityTarget, {
        offsetWidth: { value: 334 },
        offsetHeight: { value: 366 },
      });
      document.body.append(densityTarget);
      const densityCalls: number[] = [];
      const priorCompositionRatio = (
        internal as typeof internal & { compositionPixelRatio: number | null }
      ).compositionPixelRatio;
      try {
        (
          internal as typeof internal & { compositionPixelRatio: number | null }
        ).compositionPixelRatio = 1.6;
        directMount.target = densityTarget;
        directMount.definition = { ...priorDefinition, extent: undefined };
        directMount.provider = {
          setLayerTargetOpacityDeferred() {},
          setGroupLocalBackdropSource() {},
          readScene: async () => {
            throw new Error("density-probe-after-layout");
          },
          setDensity: (density: number) => densityCalls.push(density),
          captureCount: () => 0,
          needsContinuousFrames: () => false,
          diagnosticSnapshot: () => ({
            readSceneCalls: 0,
            captures: 0,
            activeLeaves: 0,
            createdLeaves: 0,
            retiredLeaves: 0,
            invalidations: {},
            leaves: [],
            omittedLeaves: 0,
          }),
          dispose() {},
        };
        await expect(
          directRunner.renderMount(directMount, 0, true, new Set(), new Set()),
        ).rejects.toThrow("density-probe-after-layout");
        expect({
          width: directMount.width,
          height: directMount.height,
        }).toEqual({
          width: 535,
          height: 586,
        });
        expect(densityCalls).toEqual([1.6]);
        expect(Math.ceil(334 * densityCalls[0])).toBe(directMount.width);
        expect(Math.ceil(366 * densityCalls[0])).toBe(directMount.height);
      } finally {
        (
          internal as typeof internal & { compositionPixelRatio: number | null }
        ).compositionPixelRatio = priorCompositionRatio;
        directMount.target = priorTarget;
        directMount.definition = priorDefinition;
        directMount.provider = priorProvider;
        densityTarget.remove();
      }
      const composedBeforeDirect = vi.spyOn(internal, "composeScene");
      const boundBeforeDirect = bound.length;
      try {
        directMount.target = directImage;
        directMount.provider = {
          setLayerTargetOpacityDeferred() {},
          setGroupLocalBackdropSource() {},
          readScene: async () => [directRecord],
          setDensity() {},
          captureCount: () => 1,
          needsContinuousFrames: () => false,
          diagnosticSnapshot: () => ({
            readSceneCalls: 1,
            captures: 1,
            activeLeaves: 0,
            createdLeaves: 0,
            retiredLeaves: 0,
            invalidations: {},
            leaves: [],
            omittedLeaves: 0,
          }),
          dispose() {},
        };
        directMount.definition = OWNED_INTRINSIC_IMAGE_TEST_EFFECT;
        directMount.instance = {
          ...priorInstance,
          definitionId: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.id,
          definitionVersion: OWNED_INTRINSIC_IMAGE_TEST_EFFECT.version,
          params: {},
          sourceSizing: {
            inputSpace: "intrinsic-image",
            aspectRatio: 1,
            fit: "cover",
            worldSize: [0, 0],
            origin: [0.5, 0.5],
            offset: [0, 0],
            scale: 1,
            rotationDegrees: 0,
            sampling: { min: "linear", mag: "linear", mipmap: "linear" },
          },
        };
        await expect(
          directRunner.renderMount(directMount, 0, true, new Set(), new Set()),
        ).rejects.toMatchObject({ code: "legacy-image-abi-retired" });
        expect(composedBeforeDirect).not.toHaveBeenCalled();
        expect(fetchAsset).not.toHaveBeenCalledWith(
          directImage.src,
          expect.any(Object),
        );
      } finally {
        directMount.target = priorTarget;
        directMount.provider = priorProvider;
        directMount.definition = priorDefinition;
        directMount.instance = priorInstance;
        composedBeforeDirect.mockRestore();
      }
      directImage.remove();
      const feedbackMount = directMount as typeof directMount & {
        definitionHash: string;
        clock: NativePlaybackClock;
        feedback: {
          executor: { lastCompletedStep: number };
          textures: Set<FakeTexture>;
        } | null;
      };
      const priorHash = feedbackMount.definitionHash;
      const priorLayer = feedbackMount.previousLayerId;
      const sourceForFeedback = vi
        .spyOn(internal, "composeScene")
        .mockImplementation(async (mount) => {
          const measured = mount as typeof feedbackMount;
          return device.createTexture({
            size: [measured.width, measured.height],
            format: "rgba16float",
          });
        });
      try {
        feedbackMount.provider = {
          setLayerTargetOpacityDeferred() {},
          setGroupLocalBackdropSource() {},
          readScene: async () => [directRecord],
          setDensity() {},
          captureCount: () => 1,
          needsContinuousFrames: () => false,
          diagnosticSnapshot: () => ({
            readSceneCalls: 1,
            captures: 1,
            activeLeaves: 0,
            createdLeaves: 0,
            retiredLeaves: 0,
            invalidations: {},
            leaves: [],
            omittedLeaves: 0,
          }),
          dispose() {},
        };
        feedbackMount.definition = OWNED_FEEDBACK_TEST_DEFINITION;
        feedbackMount.definitionHash = await hashEffectDefinition(
          OWNED_FEEDBACK_TEST_DEFINITION,
        );
        feedbackMount.instance = {
          ...priorInstance,
          definitionId: OWNED_FEEDBACK_TEST_DEFINITION.id,
          definitionVersion: OWNED_FEEDBACK_TEST_DEFINITION.version,
          params: { phase: 37.5 },
          timing: { speed: 1, paused: false, time: 0 },
        };
        feedbackMount.previousLayerId = null;
        await directRunner.renderMount(
          feedbackMount,
          1 / 30,
          true,
          new Set(),
          new Set(),
        );
        expect(feedbackMount.feedback?.executor.lastCompletedStep).toBe(2);
        expect(feedbackMount.feedback?.textures.size).toBe(3);
        expect(feedbackMount.outputTexture?.format).toBe("rgba16float");
        expect(
          writtenUniforms.some(
            (values) => values.length === 8 && values[2] === 37.5,
          ),
        ).toBe(true);
        expect(feedbackMount.target.getAttribute("data-an-native-status")).toBe(
          "ready",
        );
        const priorStateIds = new Set(
          [...(feedbackMount.feedback?.textures ?? [])].map(
            (texture) => texture.id,
          ),
        );
        feedbackMount.instance = {
          ...feedbackMount.instance,
          timing: {
            ...feedbackMount.instance.timing,
            seekRevision: 1,
          },
        };
        await directRunner.renderMount(
          feedbackMount,
          0,
          true,
          new Set(),
          new Set(),
        );
        expect(feedbackMount.feedback?.executor.lastCompletedStep).toBe(0);
        expect(
          [...(feedbackMount.feedback?.textures ?? [])].some((texture) =>
            priorStateIds.has(texture.id),
          ),
        ).toBe(false);
        await vi.waitFor(() =>
          expect(destroyed.filter((id) => priorStateIds.has(id))).toHaveLength(
            3,
          ),
        );
        feedbackMount.clock = {
          global: 0,
          local: 0,
          speed: 1,
          paused: false,
        };
        await directRunner.renderMount(
          feedbackMount,
          0,
          false,
          new Set(),
          new Set(),
        );
        await directRunner.renderMount(
          feedbackMount,
          1 / 60,
          false,
          new Set(),
          new Set(),
        );
        expect(
          feedbackMount.target.getAttribute(
            "data-an-native-feedback-requested-seconds",
          ),
        ).toBe(String(1 / 60));
        expect(
          feedbackMount.target.getAttribute(
            "data-an-native-feedback-simulated-seconds",
          ),
        ).toBe(String(1 / 60));
        expect(
          feedbackMount.target.getAttribute(
            "data-an-native-feedback-completed-step",
          ),
        ).toBe("1");
        expect(
          feedbackMount.target.getAttribute(
            "data-an-native-feedback-runtime-epoch",
          ),
        ).toBe(runtime!.epoch);
        expect(
          feedbackMount.target.getAttribute("data-an-native-feedback-playback"),
        ).toBe("exact");
        feedbackMount.instance = {
          ...feedbackMount.instance,
          timing: { ...feedbackMount.instance.timing, seekRevision: 2 },
        };
        await directRunner.renderMount(
          feedbackMount,
          0,
          true,
          new Set(),
          new Set(),
        );
        expect(
          feedbackMount.target.hasAttribute(
            "data-an-native-feedback-requested-seconds",
          ),
        ).toBe(false);
        expect(
          feedbackMount.target.hasAttribute(
            "data-an-native-feedback-runtime-epoch",
          ),
        ).toBe(false);
        await directRunner.renderMount(
          feedbackMount,
          0,
          false,
          new Set(),
          new Set(),
        );
        await directRunner.renderMount(
          feedbackMount,
          1 / 60,
          false,
          new Set(),
          new Set(),
        );
        const committedRequested = feedbackMount.target.getAttribute(
          "data-an-native-feedback-requested-seconds",
        );
        sourceForFeedback.mockRejectedValueOnce(
          new Error("source unavailable"),
        );
        await expect(
          directRunner.renderMount(
            feedbackMount,
            1 / 30,
            false,
            new Set(),
            new Set(),
          ),
        ).rejects.toThrow("source unavailable");
        expect(
          feedbackMount.target.getAttribute(
            "data-an-native-feedback-requested-seconds",
          ),
        ).toBe(committedRequested);
        const lastGoodOutput = feedbackMount.outputTexture;
        vi.spyOn(
          device as unknown as GPUDevice,
          "popErrorScope",
        ).mockResolvedValueOnce({
          message: "feedback validation rejected",
        } as GPUValidationError);
        await expect(
          directRunner.renderMount(
            feedbackMount,
            1 / 60,
            true,
            new Set(),
            new Set(),
          ),
        ).rejects.toMatchObject({ code: "gpu-validation" });
        expect(feedbackMount.outputTexture).toBe(lastGoodOutput);
        expect(feedbackMount.feedback).toBeNull();
        for (const name of [
          "data-an-native-feedback-playback",
          "data-an-native-feedback-dropped-seconds",
          "data-an-native-feedback-requested-seconds",
          "data-an-native-feedback-simulated-seconds",
          "data-an-native-feedback-completed-step",
          "data-an-native-feedback-runtime-epoch",
        ])
          expect(feedbackMount.target.hasAttribute(name)).toBe(false);
        const owned = DESIGN_OWNED_STATEFUL_DEFINITIONS[0];
        feedbackMount.definition = owned;
        feedbackMount.definitionHash = await hashEffectDefinition(owned);
        feedbackMount.instance = {
          ...feedbackMount.instance,
          definitionId: owned.id,
          definitionVersion: owned.version,
          params: {
            pigment: 0.9,
            foldScale: 77,
            flow: 0.55,
            injection: 0.3,
            mix: 0.8,
            phase: 17,
          },
          timing: { speed: 1, paused: true, time: 0 },
        };
        const aliasWritesBefore = writtenUniforms.length;
        feedbackMount.definition = owned;
        await passRunner.effectPasses(
          feedbackMount,
          device.createTexture({
            size: [feedbackMount.width, feedbackMount.height],
            format: "rgba16float",
          }) as unknown as GPUTexture,
          0,
          device.createCommandEncoder(),
          owned,
          feedbackMount.instance,
          true,
          "owned-source",
        );
        expect(
          writtenUniforms
            .slice(aliasWritesBefore)
            .some(
              (values) =>
                values.length === 8 &&
                values[2] === 17 &&
                Math.abs(values[3] - 0.9) < 1e-6 &&
                values[4] === 77 &&
                Math.abs(values[5] - 0.55) < 1e-6 &&
                Math.abs(values[6] - 0.3) < 1e-6,
            ),
        ).toBe(true);
      } finally {
        (
          internal as typeof internal & {
            releaseFeedback(mount: typeof feedbackMount): void;
          }
        ).releaseFeedback(feedbackMount);
        feedbackMount.provider = priorProvider;
        feedbackMount.definition = priorDefinition;
        feedbackMount.definitionHash = priorHash;
        feedbackMount.instance = priorInstance;
        feedbackMount.previousLayerId = priorLayer;
        sourceForFeedback.mockRestore();
      }
      (internal as typeof internal & { pause(): void }).pause();
      if (internal.running) await internal.running;
      let pairMount = directMount as typeof directMount & {
        canvas: HTMLCanvasElement;
        previousFillId: string | null;
      };
      pairMount.definition = definition;
      pairMount.instance = {
        ...pairMount.instance,
        definitionId: definition.id,
        definitionVersion: definition.version,
        placement: "layer",
        params: {},
        timing: { speed: 1, paused: true, time: 0 },
      };
      pairMount.previousLayerId = null;
      pairMount.previousFillId = null;
      await directRunner.renderMount(pairMount, 0, true, new Set(), new Set());
      const visibleCanvas = pairMount.canvas;
      const visibleId = visibleCanvas.hasAttribute(
        "data-an-native-validation-surface",
      )
        ? -2
        : -1;
      const detachedId = visibleId === -2 ? -1 : -2;
      const visibleBytes = Uint8Array.from(simulatedPixels.get(visibleId)!);
      const visibleStyle = visibleCanvas.style.cssText;
      const visibleExtent = [visibleCanvas.width, visibleCanvas.height];
      const committedFrames = pairMount.frameCount;
      const committedStatus = pairMount.target.getAttribute(
        "data-an-native-status",
      );
      const committedSources = pairMount.target.getAttribute(
        "data-an-native-sources",
      );
      const committedResources = new Map(pairMount.resourceTextures);
      const committedResourceBytes = new Map(
        [...committedResources].map(([name, texture]) => [
          name,
          Uint8Array.from(simulatedPixels.get(texture.id)!),
        ]),
      );
      const previousOutput = pairMount.outputTexture;
      const previousOutputBytes = Uint8Array.from(
        simulatedPixels.get((previousOutput as FakeTexture).id)!,
      );
      const beforeValidationFailure = submitCalls;
      vi.spyOn(
        device as unknown as GPUDevice,
        "popErrorScope",
      ).mockResolvedValueOnce(
        new Error("hidden presentation rejected") as GPUValidationError,
      );
      await expect(
        directRunner.renderMount(pairMount, 0, true, new Set(), new Set()),
      ).rejects.toMatchObject({ code: "gpu-validation" });
      expect(submitCalls - beforeValidationFailure).toBe(1);
      expect(pairMount.canvas).toBe(visibleCanvas);
      expect(pairMount.outputTexture).toBe(previousOutput);
      expect(pairMount.frameCount).toBe(committedFrames);
      expect(pairMount.target.getAttribute("data-an-native-status")).toBe(
        committedStatus,
      );
      expect(pairMount.target.getAttribute("data-an-native-sources")).toBe(
        committedSources,
      );
      for (const [name, texture] of committedResources)
        expect(simulatedPixels.get(texture.id)).toEqual(
          committedResourceBytes.get(name),
        );
      expect(pairMount.resourceTextures).toEqual(committedResources);
      expect(visibleCanvas.style.cssText).toBe(visibleStyle);
      expect([visibleCanvas.width, visibleCanvas.height]).toEqual(
        visibleExtent,
      );
      expect(simulatedPixels.get(visibleId)).toEqual(visibleBytes);
      expect(simulatedPixels.get((previousOutput as FakeTexture).id)).toEqual(
        previousOutputBytes,
      );
      expect(simulatedPixels.get(detachedId)).toBeDefined();
      const sourceEpochMethod = vi.spyOn(
        pairMount.provider! as typeof pairMount.provider & {
          sourceEpoch(): number;
        },
        "sourceEpoch",
      );
      sourceEpochMethod.mockReturnValueOnce(100).mockReturnValueOnce(101);
      const beforeSourceFailure = submitCalls;
      try {
        await expect(
          directRunner.renderMount(pairMount, 0, true, new Set(), new Set()),
        ).rejects.toMatchObject({ code: "source-epoch-stale" });
      } finally {
        sourceEpochMethod.mockRestore();
      }
      expect(submitCalls - beforeSourceFailure).toBe(1);
      expect(pairMount.canvas).toBe(visibleCanvas);
      expect(pairMount.outputTexture).toBe(previousOutput);
      expect(pairMount.frameCount).toBe(committedFrames);
      expect(pairMount.target.getAttribute("data-an-native-status")).toBe(
        committedStatus,
      );
      expect(pairMount.resourceTextures).toEqual(committedResources);
      expect(visibleCanvas.style.cssText).toBe(visibleStyle);
      expect([visibleCanvas.width, visibleCanvas.height]).toEqual(
        visibleExtent,
      );
      expect(simulatedPixels.get(visibleId)).toEqual(visibleBytes);
      for (const [name, texture] of committedResources)
        expect(simulatedPixels.get(texture.id)).toEqual(
          committedResourceBytes.get(name),
        );
      const replaceFailure = vi
        .spyOn(visibleCanvas, "replaceWith")
        .mockImplementationOnce(() => {
          throw new Error("DOM publication rejected");
        });
      const beforePublishFailure = submitCalls;
      try {
        await expect(
          directRunner.renderMount(pairMount, 0, true, new Set(), new Set()),
        ).rejects.toThrow("DOM publication rejected");
      } finally {
        replaceFailure.mockRestore();
      }
      expect(submitCalls - beforePublishFailure).toBe(1);
      expect(pairMount.canvas).toBe(visibleCanvas);
      expect(pairMount.outputTexture).toBe(previousOutput);
      expect(pairMount.frameCount).toBe(committedFrames);
      expect(pairMount.target.getAttribute("data-an-native-status")).toBe(
        committedStatus,
      );
      expect(pairMount.target.getAttribute("data-an-native-sources")).toBe(
        committedSources,
      );
      expect(pairMount.resourceTextures).toEqual(committedResources);
      expect(visibleCanvas.style.cssText).toBe(visibleStyle);
      expect([visibleCanvas.width, visibleCanvas.height]).toEqual(
        visibleExtent,
      );
      expect(simulatedPixels.get(visibleId)).toEqual(visibleBytes);
      for (const [name, texture] of committedResources)
        expect(simulatedPixels.get(texture.id)).toEqual(
          committedResourceBytes.get(name),
        );
      const epochRuntime = internal as typeof internal & {
        deviceEpoch: number;
      };
      const savedEpoch = epochRuntime.deviceEpoch;
      vi.spyOn(
        device as unknown as GPUDevice,
        "popErrorScope",
      ).mockImplementationOnce(async () => {
        epochRuntime.deviceEpoch += 1;
        return null;
      });
      const beforeEpochFailure = submitCalls;
      try {
        await expect(
          directRunner.renderMount(pairMount, 0, true, new Set(), new Set()),
        ).rejects.toMatchObject({ code: "device-lost" });
      } finally {
        epochRuntime.deviceEpoch = savedEpoch;
      }
      expect(submitCalls - beforeEpochFailure).toBe(1);
      expect(pairMount.canvas).toBe(visibleCanvas);
      expect(pairMount.outputTexture).toBe(previousOutput);
      expect(pairMount.frameCount).toBe(committedFrames);
      expect(pairMount.target.getAttribute("data-an-native-status")).toBe(
        committedStatus,
      );
      expect(pairMount.target.getAttribute("data-an-native-sources")).toBe(
        committedSources,
      );
      for (const [name, texture] of committedResources)
        expect(simulatedPixels.get(texture.id)).toEqual(
          committedResourceBytes.get(name),
        );
      expect(pairMount.resourceTextures).toEqual(committedResources);
      expect(visibleCanvas.style.cssText).toBe(visibleStyle);
      expect([visibleCanvas.width, visibleCanvas.height]).toEqual(
        visibleExtent,
      );
      expect(simulatedPixels.get(visibleId)).toEqual(visibleBytes);
      expect(simulatedPixels.get((previousOutput as FakeTexture).id)).toEqual(
        previousOutputBytes,
      );
      const beforeValidatedSwap = submitCalls;
      await directRunner.renderMount(pairMount, 0, true, new Set(), new Set());
      expect(submitCalls - beforeValidatedSwap).toBe(1);
      expect(pairMount.frameCount).toBe(committedFrames + 1);
      expect(pairMount.canvas).not.toBe(visibleCanvas);
      expect(simulatedPixels.get(detachedId)).not.toEqual(visibleBytes);
      expect(visibleCanvas.isConnected).toBe(false);
      expect(pairMount.canvas.isConnected).toBe(true);
      expect(
        document.querySelectorAll(
          'canvas[data-an-native-canvas="two-texture-instance"]',
        ),
      ).toHaveLength(1);
      const epochProvider = pairMount.provider! as typeof pairMount.provider & {
        sourceEpoch(): number;
        invalidate(): void;
      };
      const beforeInvalidation = epochProvider.sourceEpoch();
      epochProvider.invalidate();
      expect(epochProvider.sourceEpoch()).toBeGreaterThan(beforeInvalidation);
      // Test-only private ABI consumer; no catalog or oracle promotion.
      const statelessProbe = internal as typeof internal & {
        approvedHashes: Set<string>;
        allocatedStatelessBytes: number;
        statelessRetirements: Set<Promise<void>>;
        statelessBufferBytes: Map<GPUBuffer, number>;
      };
      expect(internal.draft).toBeNull();
      const statelessHash = await hashEffectDefinition(
        STATELESS_SORT_TEST_DEFINITION,
      );
      const statelessImage = document.createElement("img");
      statelessImage.dataset.agentNativeNodeId = "stateless-source-image";
      statelessImage.src = "/masks/intrinsic.png";
      Object.defineProperties(statelessImage, {
        complete: { value: true },
        naturalWidth: { value: 2 },
        naturalHeight: { value: 2 },
        offsetWidth: { value: 8.25 },
        offsetHeight: { value: 8.25 },
      });
      target.append(statelessImage);
      const initialComputeCalls = vi.spyOn(
        device,
        "createComputePipelineAsync",
      );
      const statelessInstance = {
        ...pairMount.instance,
        definitionId: STATELESS_SORT_TEST_DEFINITION.id,
        definitionVersion: 1,
        params: {},
        timing: { speed: 1, paused: true, time: 0 },
      };
      manifest.textContent = JSON.stringify({
        schemaVersion: 2,
        definitions: [STATELESS_SORT_TEST_DEFINITION],
        instances: [statelessInstance],
      });
      approval.textContent = JSON.stringify({
        schemaVersion: 1,
        hashes: [statelessHash],
      });
      internal.loadStandaloneApprovals();
      await runtime!.scan();
      if (internal.running) await internal.running;
      pairMount = internal.mounts.get(
        "two-texture-instance",
      ) as typeof pairMount;
      expect(pairMount.definition.id).toBe(STATELESS_SORT_TEST_DEFINITION.id);
      expect(pairMount.instance.definitionId).toBe(
        STATELESS_SORT_TEST_DEFINITION.id,
      );
      expect(
        (pairMount as typeof pairMount & { definitionHash: string })
          .definitionHash,
      ).toBe(statelessHash);
      const beforeStateless = submitCalls;
      const beforeStatelessCommands = computeCommandTrace.length;
      const completionWaiters: Array<() => void> = [];
      const heldQueue = vi
        .spyOn(device.queue, "onSubmittedWorkDone")
        .mockImplementation(
          () => new Promise<void>((resolve) => completionWaiters.push(resolve)),
        );
      expect((await internal.renderInternal(0, true)).failures).toEqual([]);
      expect(submitCalls - beforeStateless).toBe(1);
      expect(
        initialComputeCalls,
        JSON.stringify({
          density: pairMount.pixelRatio,
          width: pairMount.width,
          height: pairMount.height,
          instance: pairMount.instance,
        }),
      ).toHaveBeenCalledTimes(1);
      // The 2×2 image is composed into the authored 9×9 layer before compute reads it.
      const frameCommands = computeCommandTrace.slice(beforeStatelessCommands);
      const clearIndex = frameCommands.findIndex((command) =>
        /^clear:0:[1-9]\d*$/.test(command),
      );
      expect(clearIndex).toBeGreaterThanOrEqual(0);
      expect(frameCommands.slice(clearIndex, clearIndex + 5)).toEqual([
        expect.stringMatching(/^clear:0:[1-9]\d*$/),
        "compute-begin",
        "dispatch:2,9,1",
        "compute-end",
        "render-begin",
      ]);
      expect(statelessProbe.statelessBufferBytes.size).toBe(2);
      expect(statelessProbe.allocatedStatelessBytes).toBe(84 + 544);
      expect(
        (
          pairMount as typeof pairMount & {
            statelessInputs: Map<GPUTexture, number>;
          }
        ).statelessInputs.size,
      ).toBeGreaterThan(0);
      heldQueue.mockRestore();
      for (const complete of completionWaiters) complete();
      await Promise.all([...statelessProbe.statelessRetirements]);
      expect(
        (
          pairMount as typeof pairMount & {
            statelessInputs: Map<GPUTexture, number>;
          }
        ).statelessInputs.size,
      ).toBe(0);
      expect(statelessProbe.allocatedStatelessBytes).toBe(0);
      expect(statelessProbe.statelessBufferBytes.size).toBe(0);
      const priorStatelessOutput = pairMount.outputTexture;
      const priorStatelessFrame = pairMount.frameCount;
      const computedBufferLayouts = bindLayouts.slice(-2) as unknown as Array<{
        entries: Array<{
          binding: number;
          visibility: number;
          buffer?: { type: string };
        }>;
      }>;
      expect(
        computedBufferLayouts[0].entries.find((e) => e.binding === 4),
      ).toMatchObject({ visibility: 4, buffer: { type: "storage" } });
      expect(
        computedBufferLayouts[1].entries.find((e) => e.binding === 4),
      ).toMatchObject({ visibility: 3, buffer: { type: "read-only-storage" } });
      const originalReadScene = pairMount.provider!.readScene.bind(
        pairMount.provider,
      );
      let authoredEpoch = 300;
      const authoredEpochSpy = vi
        .spyOn(pairMount.provider! as any, "authoredSourceEpoch")
        .mockImplementation(() => authoredEpoch);
      const acquisitionMutation = vi
        .spyOn(pairMount.provider!, "readScene")
        .mockImplementationOnce(async () => {
          const records = await originalReadScene();
          authoredEpoch++;
          return records;
        });
      const beforeStaleAcquisition = submitCalls;
      try {
        expect((await internal.renderInternal(0, true)).failures).toEqual([
          expect.objectContaining({ code: "stateless-compute-frame-invalid" }),
        ]);
      } finally {
        acquisitionMutation.mockRestore();
        authoredEpochSpy.mockRestore();
      }
      expect(submitCalls).toBe(beforeStaleAcquisition);
      expect(pairMount.outputTexture).toBe(priorStatelessOutput);
      expect(pairMount.frameCount).toBe(priorStatelessFrame);
      expect(statelessProbe.allocatedStatelessBytes).toBe(0);
      const beforeApprovalMutation = submitCalls;
      const approvalBefore = statelessProbe.approvedHashes;
      duringNextValidation = () => {
        statelessProbe.approvedHashes = new Set(approvalBefore);
      };
      try {
        expect((await internal.renderInternal(0, true)).failures).toEqual([
          expect.objectContaining({ code: "stateless-compute-frame-invalid" }),
        ]);
      } finally {
        statelessProbe.approvedHashes = approvalBefore;
      }
      expect(submitCalls - beforeApprovalMutation).toBe(1);
      expect(pairMount.outputTexture).toBe(priorStatelessOutput);
      expect(pairMount.frameCount).toBe(priorStatelessFrame);
      await Promise.all([...statelessProbe.statelessRetirements]);
      expect(statelessProbe.allocatedStatelessBytes).toBe(0);
      expect(statelessProbe.statelessBufferBytes.size).toBe(0);
      initialComputeCalls.mockRestore();
      const validStatelessManifest = manifest.textContent;
      const beforeMalformed = submitCalls;
      for (const malformed of [null, false]) {
        manifest.textContent = JSON.stringify({
          schemaVersion: 2,
          definitions: [
            { ...STATELESS_SORT_TEST_DEFINITION, statelessCompute: malformed },
          ],
          instances: [statelessInstance],
        });
        await runtime!.scan();
        expect(target.getAttribute("data-an-native-error")).toBe(
          "stateless-compute-definition-invalid",
        );
        expect(target.getAttribute("data-an-native-error-message")).toBe(
          "stateless-compute-definition-invalid",
        );
        expect(submitCalls).toBe(beforeMalformed);
      }
      manifest.textContent = validStatelessManifest;
      await runtime!.scan();
      const teardownProbe = internal as typeof internal & {
        statelessTextureLeases: Map<FakeTexture, number>;
        statelessDeviceLeases: Map<unknown, number>;
        statelessTextureDestruction: Set<FakeTexture>;
        statelessDeviceDestruction: Set<unknown>;
        textureBytes: Map<FakeTexture, number>;
        allocatedTextureBytes: number;
        ensureCompositionBudget(mount: object, requestedBytes: number): void;
        releaseMountTextures(mount: object): void;
      };
      const teardownWaiters: Array<() => void> = [];
      const teardownQueue = vi
        .spyOn(device.queue, "onSubmittedWorkDone")
        .mockImplementation(
          () => new Promise<void>((resolve) => teardownWaiters.push(resolve)),
        );
      const deviceDestroy = vi.spyOn(device, "destroy");
      expect((await internal.renderInternal(0, true)).failures).toEqual([]);
      const leasedTextures = [...teardownProbe.statelessTextureLeases.keys()];
      expect(leasedTextures.length).toBeGreaterThanOrEqual(3);
      expect(leasedTextures).toContain(
        (internal as typeof internal & { white: FakeTexture }).white,
      );
      expect(teardownProbe.statelessDeviceLeases.get(device)).toBe(1);
      const leasedBytes = leasedTextures.reduce(
        (sum, texture) => sum + teardownProbe.textureBytes.get(texture)!,
        0,
      );
      runtime!.dispose();
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const texture of leasedTextures) {
        expect(teardownProbe.textureBytes.has(texture)).toBe(true);
        expect(teardownProbe.statelessTextureDestruction.has(texture)).toBe(
          true,
        );
        expect(destroyed).not.toContain(texture.id);
      }
      expect(teardownProbe.allocatedTextureBytes).toBeGreaterThanOrEqual(
        leasedBytes,
      );
      expect(teardownProbe.statelessDeviceDestruction.has(device)).toBe(true);
      const detachedInputs = (
        pairMount as typeof pairMount & {
          statelessInputs: Map<FakeTexture, number>;
        }
      ).statelessInputs;
      expect(new Set(detachedInputs.keys())).toEqual(new Set(leasedTextures));
      teardownProbe.releaseMountTextures(pairMount);
      expect(() =>
        teardownProbe.ensureCompositionBudget(
          pairMount,
          134_217_728 - leasedBytes + 1,
        ),
      ).toThrow(
        "The source and isolated groups exceed the per-instance texture budget.",
      );
      expect(deviceDestroy).not.toHaveBeenCalled();
      expect(statelessProbe.allocatedStatelessBytes).toBe(628);
      teardownQueue.mockRestore();
      for (const complete of teardownWaiters) complete();
      await Promise.all([...statelessProbe.statelessRetirements]);
      for (const texture of leasedTextures) {
        expect(teardownProbe.textureBytes.has(texture)).toBe(false);
        expect(destroyed.filter((id) => id === texture.id)).toHaveLength(1);
      }
      expect(teardownProbe.statelessTextureLeases.size).toBe(0);
      expect(teardownProbe.statelessDeviceLeases.size).toBe(0);
      expect(teardownProbe.statelessTextureDestruction.size).toBe(0);
      expect(teardownProbe.statelessDeviceDestruction.size).toBe(0);
      expect(statelessProbe.allocatedStatelessBytes).toBe(0);
      expect(deviceDestroy).toHaveBeenCalledTimes(1);
      deviceDestroy.mockRestore();
      statelessImage.remove();
    } finally {
      runtime!.dispose();
      if (copied.length >= 2) expect(destroyed).toContain(copied[1]);
      Reflect.deleteProperty(window, "__anNativeShaders");
    }
  });
});
