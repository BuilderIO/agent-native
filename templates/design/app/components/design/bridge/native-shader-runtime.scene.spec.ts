// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CATALOG_GENERATOR_CANDIDATES } from "../../../../shared/native-effect-catalog-generators";
import { LIQUID_GLASS_EFFECT } from "../../../../shared/native-effect-liquid-glass-v3";
import * as effectTrust from "../../../../shared/native-effect-trust";
import { GLOWING_WAVES_EFFECT } from "../../../../shared/native-effect-v1-graphics";
import { NativeStaticGeneratorPassCache } from "../../../../shared/native-static-generator-pass-cache";
import {
  NativeBoundedFrameScheduler,
  type NativePreparedScheduledFrame,
} from "./native-bounded-frame-scheduler";
import { NativePackedUniformArena } from "./native-packed-uniform-arena";
import { NativePresentationPair } from "./native-presentation-pair";
import { NativePresentationSlots } from "./native-presentation-slots";
import { nativePreviewPhysicalViewport } from "./native-preview-geometry";
import type {
  NativePreviewStatus,
  NativePreviewPolicyController,
} from "./native-preview-policy";
import * as sourceProvider from "./native-source-provider";
import { NativeStatelessFrameTransaction } from "./native-stateless-frame-transaction";
import { nativeSvgViewportToClient } from "./native-svg-geometry";
import { serializeNativeSvgSource } from "./native-svg-source";

describe("persistent generated fill frames", () => {
  it.each(["success", "gpu", "source-during-encode", "source-before-publish"])(
    "preserves atomic generated fill publication: %s",
    async (mode) => {
      const failSecond = mode === "gpu";
      let sourceChanged = false;
      const { frame } = fixture();
      const internals = runtime as unknown as {
        prepareGeneratedFillFrame(
          family: unknown,
          slot: 0 | 1 | 2,
          time: number,
        ): Promise<NativePreparedScheduledFrame>;
        assertGeneratedFillFamily(family: unknown): void;
        effectPasses(state: {
          resourceTextures: Map<string, object>;
        }): Promise<unknown>;
        finish(): Promise<unknown>;
        drawCoveredFillPhase(): Promise<unknown>;
        compositeFill(): Promise<unknown>;
        present(): Promise<void>;
        beginGpuSample(): null;
        postStatus(): void;
        issue(): void;
        packedUniformFrame: {
          arena: NativePackedUniformArena<object>;
          token: symbol;
        } | null;
      };
      const assertFamily = vi
        .spyOn(internals, "assertGeneratedFillFamily")
        .mockImplementation(() => {
          if (sourceChanged)
            throw new sourceProvider.NativeSourceError(
              "source-epoch-stale",
              "The authored source changed.",
            );
        });
      vi.spyOn(internals, "beginGpuSample").mockReturnValue(null);
      const allocations = vi.fn(() => ({}));
      vi.spyOn(internals, "effectPasses").mockImplementation(async (state) => {
        const packed = internals.packedUniformFrame!;
        packed.arena.write(
          packed.token,
          "fill:effect",
          new Float32Array([1, 2, 3, 4]),
        );
        if (!state.resourceTextures.has("generated"))
          state.resourceTextures.set("generated", allocations());
        if (mode === "source-during-encode") {
          await Promise.resolve();
          sourceChanged = true;
        }
        return state.resourceTextures.get("generated")!;
      });
      vi.spyOn(internals, "finish").mockResolvedValue({});
      vi.spyOn(internals, "drawCoveredFillPhase").mockResolvedValue({});
      vi.spyOn(internals, "compositeFill").mockImplementation(async () => ({}));
      vi.spyOn(internals, "present").mockResolvedValue();
      vi.spyOn(internals, "postStatus").mockImplementation(() => {});
      vi.spyOn(internals, "issue").mockImplementation(() => {});
      const validations: Array<(error: { message: string } | null) => void> =
        [];
      const device = runtime.device as {
        popErrorScope: () => Promise<unknown>;
        queue: { submit: ReturnType<typeof vi.fn> };
      };
      device.popErrorScope = vi.fn(() =>
        device.queue.submit.mock.calls.length
          ? new Promise((resolve) => validations.push(resolve))
          : Promise.resolve(null),
      );
      const canonical = runtime.mounts.get("fill") as Record<string, unknown>;
      Object.assign(canonical, {
        definition: GLOWING_WAVES_EFFECT,
        definitionHash: "custom-test-hash",
        instance: {
          id: "fill",
          nodeId: "frame",
          placement: "fill",
          params: {},
          opacity: 1,
          enabled: true,
          clip: "border-box",
        },
        width: 100,
        height: 100,
        pixelRatio: 1,
        frameCount: 0,
        renderWallSamples: [],
        clock: { paused: false, local: 0, global: 0, speed: 1 },
        resourceTextures: new Map(),
        drawBindings: new Map(),
      });
      const original = canonical.canvas as HTMLCanvasElement;
      const presentation = new NativePresentationSlots(
        { canvas: original, context: {} },
        (front) => ({
          canvas: front.canvas.cloneNode(false) as HTMLCanvasElement,
          context: {},
        }),
        () => {},
      );
      const uploads = vi.fn();
      const slots = [0, 1, 2].map(() => ({
        arena: new NativePackedUniformArena({
          buffer: {},
          capacityBytes: 256,
          alignment: 16,
          upload: uploads,
        }),
        states: new Map([
          [
            "fill",
            {
              ...canonical,
              resourceTextures: new Map(),
              drawBindings: new Map(),
              staticGeneratorPassCache: new NativeStaticGeneratorPassCache(),
            },
          ],
        ]),
      }));
      const scheduler = new NativeBoundedFrameScheduler();
      const family = {
        device,
        entries: [
          {
            canonical,
            presentation,
            boxes: [{}, {}, {}, {}],
            sourceEpoch: 1,
            payload: JSON.stringify(canonical.instance),
            definitionHash: "custom-test-hash",
          },
        ],
        slots,
        scheduler,
        cadenceStart: performance.now(),
        cadenceFrames: 0,
        cancelled: false,
      };
      const first = scheduler.submit((slot) =>
        internals.prepareGeneratedFillFrame(family, slot, 1),
      );
      if (mode === "source-during-encode") {
        expect((await first).status).toBe("rejected");
        expect(device.queue.submit).not.toHaveBeenCalled();
        expect(canonical.canvas).toBe(original);
        expect(canonical.frameCount).toBe(0);
        return;
      }
      const second = scheduler.submit((slot) =>
        internals.prepareGeneratedFillFrame(family, slot, 2),
      );
      const early: unknown[] = [];
      void first.then((outcome) => {
        if (outcome.status === "rejected") early.push(outcome.reason);
      });
      await vi.waitFor(() =>
        expect(
          device.queue.submit.mock.calls.length === 2 || early.length > 0,
        ).toBe(true),
      );
      expect(early).toEqual([]);
      expect(validations).toHaveLength(2);
      expect(canonical.canvas).toBe(original);
      expect(canonical.frameCount).toBe(0);
      if (mode === "source-before-publish") {
        sourceChanged = true;
        validations[1]!(null);
        validations[0]!(null);
        expect((await first).status).toBe("rejected");
        expect((await second).status).toBe("rejected");
        expect(canonical.canvas).toBe(original);
        expect(canonical.frameCount).toBe(0);
        return;
      }
      validations[1]!(failSecond ? { message: "second frame invalid" } : null);
      await Promise.resolve();
      expect(canonical.canvas).toBe(original);
      validations[0]!(null);
      expect((await first).status).toBe("fulfilled");
      const firstFront = canonical.canvas;
      expect((await second).status).toBe(failSecond ? "rejected" : "fulfilled");
      expect(canonical.frameCount).toBe(failSecond ? 1 : 2);
      expect(canonical.committedLocalTime).toBe(failSecond ? 1 : 2);
      if (failSecond) expect(canonical.canvas).toBe(firstFront);
      expect(presentation.surfaces()).toHaveLength(3);
      expect(frame.isConnected).toBe(true);
      expect(uploads).toHaveBeenCalledTimes(2);
      if (!failSecond) expect(assertFamily).toHaveBeenCalledTimes(6);
      if (!failSecond) {
        scheduler.takeOutcomes();
        for (const time of [3, 4]) {
          const next = scheduler.submit((slot) =>
            internals.prepareGeneratedFillFrame(family, slot, time),
          );
          await vi.waitFor(() =>
            expect(device.queue.submit).toHaveBeenCalledTimes(time),
          );
          validations[time - 1]!(null);
          expect((await next).status).toBe("fulfilled");
          scheduler.takeOutcomes();
        }
        expect(canonical.frameCount).toBe(4);
        expect(allocations).toHaveBeenCalledTimes(3);
        expect(uploads).toHaveBeenCalledTimes(4);
        expect(presentation.surfaces()).toHaveLength(3);
      }
    },
  );
});

type SceneRuntime = {
  device: unknown;
  deviceEpoch: number;
  disposed: boolean;
  scenePresentation: unknown;
  frameTransaction: unknown;
  mounts: Map<string, unknown>;
  compositionPixelRatio: number | null;
  compositionOutputRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  renderInternal(time: number, deterministic: boolean): Promise<unknown>;
  previewViewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  previewDisplayScale: number;
  previewScenePixelRatio: number | null;
  previewSceneBudgetSignature: string;
  exportInitialPixelRatio: number | null;
  previewHostGeneration: number;
  previewFrameHostGeneration: number;
  previewStatus(): NativePreviewStatus;
  previewPolicy: NativePreviewPolicyController;
  previewTargetDensities: Map<Element, number>;
  previewBudgetDensities: Map<string, number>;
  planPreviewTargetDensities(): boolean;
  layout(mount: unknown): void;
  offscreen(mount: unknown): boolean;
  renderMount(
    mount: unknown,
    time: number,
    deterministic: boolean,
    complete: Set<string>,
    active: Set<string>,
    submitted?: () => void,
  ): Promise<void>;
  allocatedTextureBytes: number;
  textureBytes: WeakMap<object, number>;
  readCompositionPixels(...args: unknown[]): Promise<unknown>;
  presentPipeline: unknown;
  composeScene: ReturnType<typeof vi.fn>;
  bind: ReturnType<typeof vi.fn>;
  releaseScenePresentation: ReturnType<typeof vi.fn>;
  preparePresentationPair: ReturnType<typeof vi.fn>;
  textureRetirement: unknown[];
  assertCurrentSceneCommit(scene: unknown): void;
  unpublishScenePresentation(scene: unknown): void;
  presentScene(submitted?: () => void, frameJobId?: string): Promise<void>;
  assertCompositionIdle(): void;
  drainPreviewFrame(): Promise<void>;
  suspendForComposition(): { time: number };
  restoreFromComposition(): void;
  parse(): unknown;
  captureCommittedCompositionPixels(options: unknown): Promise<unknown>;
  playing: boolean;
  compositionAbort: AbortController | null;
  onAuthoredStyleMutations(records: MutationRecord[]): void;
  syncSceneSourceOpacity(mount: unknown): void;
  syncPresentation(mount: unknown): void;
  positionedParents: Map<HTMLElement, number>;
  syncScenePresentationMode(managed: boolean): void;
  restoreIndividualPresentationsAfterSceneFailure(): void;
};

let runtime: SceneRuntime;
beforeAll(async () => {
  const loading = vi
    .spyOn(document, "readyState", "get")
    .mockReturnValue("loading");
  await import("./native-shader-runtime.bridge");
  runtime = window.__anNativeShaders as unknown as SceneRuntime;
  loading.mockRestore();
});

afterEach(() => {
  runtime.compositionAbort = null;
  runtime.frameTransaction = null;
  runtime.previewViewport = null;
  runtime.previewDisplayScale = 1;
  runtime.previewScenePixelRatio = null;
  runtime.previewSceneBudgetSignature = "";
  runtime.exportInitialPixelRatio = null;
  runtime.previewHostGeneration = 0;
  runtime.previewFrameHostGeneration = 0;
  runtime.previewTargetDensities.clear();
  runtime.previewPolicy.resetDensityBudget();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-an-native-scene-managed");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  vi.stubGlobal("innerWidth", 1044);
  vi.stubGlobal("innerHeight", 1042);
  vi.stubGlobal("scrollX", 0);
  vi.stubGlobal("scrollY", 0);
  Object.defineProperties(document.documentElement, {
    scrollWidth: { configurable: true, value: 1319 },
    scrollHeight: { configurable: true, value: 1042 },
  });
  const frame = document.createElement("div");
  const canvas = document.createElement("canvas");
  document.body.append(frame, canvas);
  const computedStyle: Partial<CSSStyleDeclaration> = {
    backgroundImage: "none",
    backgroundColor: "rgb(255, 255, 255)",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    opacity: "1",
    getPropertyValue: () => "",
  };
  vi.spyOn(window, "getComputedStyle").mockReturnValue(
    computedStyle as CSSStyleDeclaration,
  );
  vi.spyOn(sourceProvider, "nativePresentationVisible").mockReturnValue(true);
  let sourceEpoch = 7;
  const provider = {
    setDensity: vi.fn(),
    readScene: vi.fn(
      async (): Promise<
        {
          node: Element;
          nativeInstanceId?: string;
          source?: CanvasImageSource;
        }[]
      > => [{ node: frame, nativeInstanceId: "fill" }],
    ),
    sourceEpoch: () => sourceEpoch,
    authoredSourceEpoch: () => sourceEpoch,
  };
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.style.visibility = "hidden";
  document.body.prepend(sceneCanvas);
  const scene = {
    canvas: sceneCanvas,
    context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
    provider,
    surface: {
      width: 1044,
      height: 1042,
      isolationTextures: new Map(),
      sourceTextures: new Map(),
      resourceTextures: new Map<string, unknown>(),
    },
    epoch: 1,
    presentationPair: null,
    committedSourceEpoch: null as number | null,
    committedInstancePayloads: new Map(),
    suppressedElements: new Set(),
  };
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const submit = vi.fn();
  runtime.device = {
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    queue: { submit },
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
  };
  runtime.deviceEpoch = 1;
  runtime.disposed = false;
  runtime.compositionPixelRatio = 1;
  runtime.scenePresentation = scene;
  runtime.presentPipeline = {};
  runtime.mounts = new Map([
    [
      "fill",
      {
        instance: { id: "fill", nodeId: "frame", placement: "fill" },
        target: frame,
        canvas,
        presentationParent: document.body,
        isTopLayer: true,
        suppressed: true,
        outputTexture: {},
        fillCommittedNativeChildren: new Set(),
        layerCommittedNativeSources: new Set(),
        groupLocalCommittedChildren: new Set(),
        groupLocalNoncontributingChildren: new Set(),
        committedInstancePayload: JSON.stringify({
          id: "fill",
          nodeId: "frame",
          placement: "fill",
        }),
        committedDefinitionHash: "hash",
        committedLocalTime: 0,
      },
    ],
  ]);
  runtime.textureRetirement = [];
  runtime.preparePresentationPair = vi.fn((owner) => {
    owner.presentationPair ??= new NativePresentationPair(
      { canvas: owner.canvas, context: owner.context },
      (front) => ({
        canvas: front.canvas.cloneNode(false) as HTMLCanvasElement,
        context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
      }),
      () => {},
    );
    return {
      pair: owner.presentationPair,
      front: owner.presentationPair.visible(),
      spare: owner.presentationPair.prepare(),
    };
  });
  runtime.composeScene = vi.fn(async (surface) => {
    const texture = {};
    surface.resourceTextures.set("source", texture);
    return texture;
  });
  runtime.bind = vi.fn(() => ({}));
  runtime.releaseScenePresentation = vi.fn(() => {
    runtime.scenePresentation = null;
  });
  return {
    frame,
    scene,
    submit,
    provider,
    computedStyle,
    changeSource: () => {
      sourceEpoch += 1;
    },
  };
}

async function committedCaptureFixture() {
  const setup = fixture();
  const mount = runtime.mounts.get("fill") as {
    instance: Record<string, unknown>;
    committedInstancePayload: string;
    definition: { id: string; version: number };
    committedInputEpochs: Map<string, unknown>;
    committedSourceEpoch: number;
    suppressed: boolean;
  };
  mount.instance = {
    ...mount.instance,
    definitionId: "test-definition",
    definitionVersion: 1,
    placement: "layer",
    enabled: true,
    params: { amount: 0.5 },
  };
  mount.definition = { id: "test-definition", version: 1 };
  mount.committedInstancePayload = JSON.stringify(mount.instance);
  mount.committedInputEpochs = new Map();
  mount.committedSourceEpoch = 7;
  Object.assign(mount, { provider: setup.provider });
  setup.frame.setAttribute("data-an-native-status", "ready");
  await runtime.presentScene();
  const savedInstance = structuredClone(mount.instance);
  vi.spyOn(runtime, "assertCompositionIdle").mockImplementation(() => {});
  vi.spyOn(runtime, "drainPreviewFrame").mockResolvedValue();
  vi.spyOn(runtime, "suspendForComposition").mockReturnValue({ time: 0 });
  vi.spyOn(runtime, "restoreFromComposition").mockImplementation(() => {});
  vi.spyOn(runtime, "parse").mockReturnValue([
    { definitions: [mount.definition], instances: [savedInstance] },
  ]);
  runtime.playing = false;
  const options = {
    viewport: { width: 1044, height: 1042 },
    pixelRatio: 1,
    expectedDefinitions: [
      { id: "test-definition", version: 1, executionHash: "hash" },
    ],
    expectedInstances: [savedInstance],
  };
  return { ...setup, mount, savedInstance, options };
}

function nestedLayerFixture() {
  const setup = fixture();
  const fill = runtime.mounts.get("fill") as Record<string, unknown>;
  const child = document.createElement("div");
  const childCanvas = document.createElement("canvas");
  child.append(childCanvas);
  setup.frame.append(child);
  const parentCanvas = document.createElement("canvas");
  setup.frame.after(parentCanvas);
  const parentLayer = {
    ...fill,
    instance: { id: "parent-layer", nodeId: "frame", placement: "layer" },
    canvas: parentCanvas,
    outputTexture: {},
    layerCommittedNativeSources: new Set(["fill"]),
    isTopLayer: true,
    groupLocalCommittedChildren: new Set(),
  };
  const childLayer = {
    ...fill,
    instance: { id: "child-layer", nodeId: "child", placement: "layer" },
    target: child,
    canvas: childCanvas,
    outputTexture: {},
    layerCommittedNativeSources: new Set(),
    groupLocalCommittedChildren: new Set(),
  };
  fill.fillCommittedNativeChildren = new Set(["child-layer"]);
  runtime.mounts.set("parent-layer", parentLayer);
  runtime.mounts.set("child-layer", childLayer);
  vi.mocked(sourceProvider.nativePresentationVisible).mockImplementation(
    (canvas) => canvas !== fill.canvas,
  );
  setup.provider.readScene.mockResolvedValue([
    { node: setup.frame, nativeInstanceId: "parent-layer" },
  ]);
  return { ...setup, parentLayer, childLayer };
}

describe("native scene viewport composition", () => {
  it("uses the frame transaction only for source-current committed stateless sibling presentations", () => {
    const { scene, provider, changeSource } = fixture();
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    const mounts = [0, 1].map((index) => {
      const target = document.createElement("div");
      const canvas = document.createElement("canvas");
      target.setAttribute("data-an-native-status", "ready");
      document.body.append(target, canvas);
      const instance = {
        id: String(index),
        placement: index ? "backdrop" : "fill",
      };
      return {
        target,
        canvas,
        instance,
        definition: {
          kind: index ? "processor" : "generator",
          inputs: index ? { source: {} } : undefined,
        },
        definitionHash: "hash",
        committedDefinitionHash: "hash",
        committedInstancePayload: JSON.stringify(instance),
        committedSourceEpoch: 7,
        provider: { sourceEpoch: () => 7 },
        authoredInputs: new Map(),
        isTopLayer: true,
        suppressed: true,
        outputTexture: {} as object | null,
      };
    });
    runtime.mounts = new Map(
      mounts.map((mount, index) => [String(index), mount]),
    );
    const eligible = () =>
      (
        runtime as unknown as { canPrepareStatelessFrame(): boolean }
      ).canPrepareStatelessFrame();
    expect(eligible()).toBe(true);
    mounts[1]!.outputTexture = null;
    expect(eligible()).toBe(false);
    mounts[1]!.outputTexture = {};
    mounts[0]!.target.append(mounts[1]!.target);
    expect(eligible()).toBe(false);
    document.body.append(mounts[1]!.target);
    expect(eligible()).toBe(true);
    mounts[0]!.committedInstancePayload = "stale";
    expect(eligible()).toBe(false);
    mounts[0]!.committedInstancePayload = JSON.stringify(mounts[0]!.instance);
    changeSource();
    expect(eligible()).toBe(false);
    mounts[1]!.instance.placement = "fill";
    mounts[1]!.definition.kind = "generator";
    mounts[1]!.definition.inputs = undefined;
    mounts[1]!.committedInstancePayload = JSON.stringify(mounts[1]!.instance);
    expect(eligible()).toBe(false);
    runtime.scenePresentation = null;
    expect(eligible()).toBe(true);
  });

  it.each(["source", "device", "submit"])(
    "closes the captured frame scope once on failure=%s",
    async (failure) => {
      const { frame } = fixture();
      runtime.compositionPixelRatio = null;
      Object.defineProperty(frame, "getBoundingClientRect", {
        value: () => new DOMRect(0, 0, 100, 100),
      });
      const mount = runtime.mounts.get("fill") as Record<string, unknown>;
      mount.definition = { kind: "generator", resources: [] };
      mount.authoredInputs = new Map();
      const device = runtime.device as {
        pushErrorScope: ReturnType<typeof vi.fn>;
        popErrorScope: ReturnType<typeof vi.fn>;
        queue: { submit: ReturnType<typeof vi.fn> };
      };
      vi.spyOn(runtime, "planPreviewTargetDensities").mockReturnValue(false);
      const internals = runtime as unknown as {
        canPrepareStatelessFrame(): boolean;
        ensureDevice(): Promise<void>;
        retireBindings(): void;
        retainedFillPresentation(): boolean;
      };
      vi.spyOn(internals, "canPrepareStatelessFrame").mockReturnValue(true);
      vi.spyOn(internals, "ensureDevice").mockResolvedValue();
      vi.spyOn(internals, "retireBindings").mockImplementation(() => {});
      vi.spyOn(internals, "retainedFillPresentation").mockReturnValue(true);
      vi.spyOn(
        runtime,
        "restoreIndividualPresentationsAfterSceneFailure",
      ).mockImplementation(() => {});
      if (failure === "submit")
        device.queue.submit.mockImplementation(() => {
          throw new sourceProvider.NativeSourceError(
            "gpu-validation",
            "queue submit failed",
          );
        });
      vi.spyOn(runtime, "renderMount").mockImplementation(
        async (
          _mount,
          _time,
          _deterministic,
          _complete,
          _active,
          submitted,
        ) => {
          if (failure === "submit") {
            const prepared = runtime.frameTransaction as {
              candidates: Map<string, unknown>;
              transaction: NativeStatelessFrameTransaction<unknown>;
              submission: Promise<void>;
            };
            const candidate = { texture: {} };
            prepared.candidates.set("fill", candidate);
            prepared.transaction.stage("fill", new Map([["fill", candidate]]));
            submitted?.();
            await prepared.submission;
            return;
          }
          if (failure === "device") {
            runtime.device = { ...device };
            runtime.deviceEpoch++;
          }
          throw new sourceProvider.NativeSourceError(
            "source-epoch-stale",
            "source changed before encoding",
          );
        },
      );
      const result = (await runtime.renderInternal(1, false)) as {
        rendered: number;
        failures: Array<{ code: string }>;
      };
      expect(result.rendered).toBe(0);
      expect(result.failures).toContainEqual(
        expect.objectContaining({
          code: failure === "submit" ? "gpu-validation" : "source-epoch-stale",
        }),
      );
      expect(device.pushErrorScope).toHaveBeenCalledExactlyOnceWith(
        "validation",
      );
      expect(device.popErrorScope).toHaveBeenCalledOnce();
      expect(device.queue.submit).toHaveBeenCalledTimes(
        failure === "submit" ? 1 : 0,
      );
      expect(runtime.frameTransaction).toBeNull();
    },
  );

  it.each(["none", "gpu", "epoch", "commit"])(
    "joins all stateless GPU candidates before atomic publication with failure=%s",
    async (failure) => {
      const { scene, provider } = fixture();
      runtime.compositionPixelRatio = null;
      scene.canvas.style.visibility = "visible";
      scene.committedSourceEpoch = provider.sourceEpoch();
      const events: string[] = [];
      let changed = false;
      const pending = Array.from({ length: 3 }, () => {
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        return { promise, resolve, reject };
      });
      const mounts = [0, 1].map((index) => {
        const target = document.createElement("div");
        Object.defineProperty(target, "getBoundingClientRect", {
          value: () => new DOMRect(index * 200, 0, 100, 100),
        });
        document.body.append(target);
        const old = { old: index };
        return {
          target,
          canvas: document.createElement("canvas"),
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: index ? "backdrop" : "fill",
          },
          authoredInputs: new Map(),
          definition: {
            kind: index ? "processor" : "generator",
            resources: [],
          },
          width: 100,
          height: 100,
          pixelRatio: 1,
          renderWallSamples: [],
          outputTexture: old,
          old,
          frameCount: 1,
          provider: { captureCount: () => 0 },
        };
      });
      runtime.mounts = new Map(
        mounts.map((mount, index) => [String(index), mount]),
      );
      vi.spyOn(runtime, "planPreviewTargetDensities").mockReturnValue(false);
      vi.spyOn(
        runtime as unknown as { canPrepareStatelessFrame(): boolean },
        "canPrepareStatelessFrame",
      ).mockReturnValue(true);
      vi.spyOn(
        runtime as unknown as { ensureDevice(): Promise<void> },
        "ensureDevice",
      ).mockResolvedValue();
      vi.spyOn(
        runtime as unknown as { retireBindings(): void },
        "retireBindings",
      ).mockImplementation(() => {});
      vi.spyOn(
        runtime as unknown as { postStatus(...args: unknown[]): void },
        "postStatus",
      ).mockImplementation(() => {});
      const context = () =>
        runtime.frameTransaction as {
          transaction: NativeStatelessFrameTransaction<unknown>;
          candidates: Map<string, unknown>;
        };
      vi.spyOn(runtime, "renderMount").mockImplementation(
        async (value, _time, _deterministic, complete, _active, submitted) => {
          const index = mounts.indexOf(value as (typeof mounts)[number]);
          const mount = mounts[index]!;
          const frame = context();
          const candidate = { texture: { candidate: index } };
          frame.candidates.set(String(index), candidate);
          frame.transaction.stage(
            String(index),
            new Map([[String(index), candidate]]),
          );
          events.push(`encode${index}`);
          submitted!();
          await pending[index]!.promise;
          await frame.transaction.prepare(String(index), {
            assert: () => {
              if (changed) throw new Error("source-epoch-stale");
              events.push(`assert${index}`);
            },
            commit: () => {
              events.push(`publish${index}`);
              mount.outputTexture =
                candidate.texture as unknown as typeof mount.old;
              mount.frameCount++;
              complete.add(String(index));
            },
            rollback: () => {
              mount.outputTexture = mount.old;
              mount.frameCount = 1;
              complete.delete(String(index));
            },
            retire: () => {
              events.push(`retire${index}`);
            },
          });
        },
      );
      let encoded!: () => void;
      const sceneEncoded = new Promise<void>((resolve) => {
        encoded = resolve;
      });
      vi.spyOn(runtime, "presentScene").mockImplementation(
        async (submitted, id) => {
          const frame = context();
          expect(frame.candidates.size).toBe(2);
          frame.transaction.stage(id!, new Map());
          events.push("encode-scene");
          submitted!();
          encoded();
          await pending[2]!.promise;
          await frame.transaction.prepare(id!, {
            assert: () => {
              if (changed) throw new Error("source-epoch-stale");
              events.push("assert-scene");
            },
            commit: () => {
              if (failure === "commit") throw new Error("publication-failed");
              events.push("publish-scene");
            },
            rollback: () => {},
            retire: () => {
              events.push("retire-scene");
            },
          });
        },
      );
      const rendering = runtime.renderInternal(0, false);
      await sceneEncoded;
      expect(events).toEqual(["encode0", "encode1", "encode-scene"]);
      expect(mounts.map((mount) => mount.outputTexture)).toEqual(
        mounts.map((mount) => mount.old),
      );
      if (failure === "epoch") changed = true;
      for (let index = 0; index < pending.length; index++) {
        if (failure === "gpu" && index === 1)
          pending[index]!.reject(
            new sourceProvider.NativeSourceError(
              "gpu-validation",
              "invalid candidate",
            ),
          );
        else pending[index]!.resolve();
      }
      const result = (await rendering) as {
        rendered: number;
        failures: unknown[];
      };
      if (failure === "none") {
        expect(result.failures).toEqual([]);
        expect(result.rendered).toBe(2);
        expect(events.indexOf("assert-scene")).toBeLessThan(
          events.indexOf("publish0"),
        );
        expect(events.indexOf("publish-scene")).toBeLessThan(
          events.indexOf("retire0"),
        );
      } else {
        expect(result.failures.length).toBeGreaterThan(0);
        expect(result.rendered).toBe(0);
        expect(mounts.map((mount) => mount.outputTexture)).toEqual(
          mounts.map((mount) => mount.old),
        );
        expect(mounts.map((mount) => mount.frameCount)).toEqual([1, 1]);
        expect(events.some((event) => event.startsWith("retire"))).toBe(false);
      }
      expect(runtime.frameTransaction).toBeNull();
    },
  );

  it("suppresses the newly published native front rather than its disconnected source record", async () => {
    const { scene, provider } = fixture();
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    const mount = runtime.mounts.get("fill") as {
      canvas: HTMLCanvasElement;
      context?: unknown;
      target: HTMLElement;
      presentationPair: NativePresentationPair<unknown>;
    };
    const oldCanvas = mount.canvas;
    const receiver = document.createElement("div");
    Object.defineProperty(receiver, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 20, 20),
    });
    document.body.append(receiver);
    runtime.mounts.set("receiver", {
      target: receiver,
      canvas: document.createElement("canvas"),
      instance: { id: "receiver", placement: "backdrop" },
    });
    const pair = new NativePresentationPair<unknown>(
      { canvas: oldCanvas, context: {} },
      (front) => ({
        canvas: front.canvas.cloneNode(false) as HTMLCanvasElement,
        context: {},
      }),
      () => {},
    );
    mount.presentationPair = pair;
    oldCanvas.setAttribute("data-an-native-authored-opacity", "1");
    const priorStyle = vi
      .mocked(window.getComputedStyle)
      .getMockImplementation()!;
    vi.mocked(window.getComputedStyle).mockImplementation((element) =>
      element === oldCanvas
        ? ({ ...priorStyle(element), opacity: "0" } as CSSStyleDeclaration)
        : priorStyle(element),
    );
    const front = pair.visible();
    const spare = pair.prepare();
    spare.canvas.removeAttribute("data-an-native-authored-opacity");
    const transaction = new NativeStatelessFrameTransaction<unknown>();
    transaction.register("fill");
    transaction.register("scene");
    const native = transaction
      .prepare("fill", {
        assert: () => pair.assertPublishable(front, spare),
        commit: () => {
          mount.canvas = pair.publish(front, spare).canvas;
        },
        rollback: () => {
          if (pair.visible() !== front)
            mount.canvas = pair.publish(pair.visible(), front).canvas;
        },
        retire: () => {},
      })
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
    const prepare = vi.spyOn(transaction, "prepare");
    runtime.frameTransaction = {
      transaction,
      candidates: new Map([["fill", {}]]),
      jobs: new Map(),
      publishing: false,
      statuses: [],
      commands: [],
      submission: Promise.resolve(),
    };
    const rendering = runtime.presentScene(() => {}, "scene");
    const outcome = rendering.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    await vi.waitFor(() =>
      expect(prepare.mock.calls.some(([id]) => id === "scene")).toBe(true),
    );
    await transaction.finish();
    await outcome;
    await native;
    expect(oldCanvas.isConnected).toBe(false);
    expect(mount.canvas).toBe(spare.canvas);
    expect(mount.canvas.getAttribute("data-an-native-authored-opacity")).toBe(
      "1",
    );
    expect(mount.canvas.hasAttribute("data-an-native-scene-suppressed")).toBe(
      true,
    );
  });

  it("reads authored scene opacity before any transaction publication", async () => {
    const { scene, frame } = fixture();
    const transaction = new NativeStatelessFrameTransaction<unknown>();
    transaction.register("scene");
    transaction.register("other");
    const committed = vi.fn();
    const other = transaction
      .prepare("other", {
        assert: () => {},
        commit: committed,
        rollback: () => {},
        retire: () => {},
      })
      .then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
    runtime.frameTransaction = {
      transaction,
      candidates: new Map(),
      jobs: new Map(),
      publishing: false,
      statuses: [],
      commands: [],
      submission: Promise.resolve(),
    };
    const prior = vi.mocked(window.getComputedStyle).getMockImplementation()!;
    vi.mocked(window.getComputedStyle).mockImplementation((element) =>
      element === frame
        ? ({ ...prior(element), opacity: "unreadable" } as CSSStyleDeclaration)
        : prior(element),
    );
    const rendering = runtime
      .presentScene(() => {}, "scene")
      .catch((error) => {
        transaction.fail("scene", error);
        throw error;
      });
    await expect(rendering).rejects.toMatchObject({
      code: "scene-opacity-unreadable",
    });
    await expect(transaction.finish()).rejects.toMatchObject({
      code: "scene-opacity-unreadable",
    });
    await other;
    expect(committed).not.toHaveBeenCalled();
    expect(scene.canvas.isConnected).toBe(true);
  });

  it.each(["none", "commit", "retirement"])(
    "prepares scene publication before commit and restores its prior front when later failure phase=%s",
    async (failurePhase) => {
      const { scene, provider } = fixture();
      scene.canvas.style.visibility = "visible";
      scene.committedSourceEpoch = provider.sourceEpoch();
      const oldCanvas = scene.canvas;
      const oldResources = scene.surface.resourceTextures;
      oldResources.set("source", {});
      const transaction = new NativeStatelessFrameTransaction<unknown>();
      transaction.register("scene");
      const prepare = vi.spyOn(transaction, "prepare");
      runtime.frameTransaction = {
        transaction,
        candidates: new Map(),
        jobs: new Map(),
        publishing: false,
        statuses: [],
        commands: [],
        submission: Promise.resolve(),
      };
      const rendering = runtime.presentScene(() => {}, "scene");
      const renderingOutcome = rendering.then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
      expect(scene.canvas).toBe(oldCanvas);
      expect(oldCanvas.isConnected).toBe(true);
      let other: Promise<unknown> | undefined;
      if (failurePhase !== "none") {
        transaction.register("other");
        other = transaction
          .prepare("other", {
            assert: () => {},
            commit: () => {
              if (failurePhase === "commit")
                throw new Error("later-publication-failed");
            },
            rollback: () => {},
            retire: () => {
              if (failurePhase === "retirement")
                throw new Error("retirement-failed");
            },
          })
          .then(
            () => ({ ok: true }),
            (error) => ({ ok: false, error }),
          );
        await expect(transaction.finish()).rejects.toThrow(
          failurePhase === "commit"
            ? "later-publication-failed"
            : "prior resources could not all retire",
        );
        if (failurePhase === "commit") {
          expect(scene.canvas).toBe(oldCanvas);
          expect(scene.surface.resourceTextures).toBe(oldResources);
          expect(oldCanvas.isConnected).toBe(true);
        } else {
          expect(scene.canvas).not.toBe(oldCanvas);
          expect(await renderingOutcome).toMatchObject({
            ok: false,
            error: { published: true },
          });
        }
      } else {
        await transaction.finish();
        expect(scene.canvas).not.toBe(oldCanvas);
      }
      await renderingOutcome;
      await other;
    },
  );

  it("keeps independently rendered layer effects visible when backdrop composition fails", () => {
    const { frame } = fixture();
    const layer = runtime.mounts.get("fill") as {
      target: HTMLElement;
      canvas: HTMLCanvasElement;
      instance: { id: string; nodeId: string; placement: string };
      isTopLayer: boolean;
      suppressed: boolean;
      outputTexture: unknown;
      layerSourceOpacityDeferred: boolean;
    };
    layer.instance.placement = "layer";
    layer.canvas.style.visibility = "hidden";
    frame.setAttribute("data-an-native-layer-suppressed", "");

    const receiver = document.createElement("div");
    const backdropCanvas = document.createElement("canvas");
    receiver.setAttribute("data-an-native-receiver-suppressed", "");
    backdropCanvas.style.visibility = "visible";
    document.body.append(receiver);
    runtime.mounts.set("backdrop", {
      target: receiver,
      canvas: backdropCanvas,
      instance: { id: "backdrop", nodeId: "receiver", placement: "backdrop" },
      isTopLayer: true,
      suppressed: true,
      outputTexture: {},
      layerSourceOpacityDeferred: false,
    });
    document.documentElement.setAttribute("data-an-native-scene-managed", "");

    runtime.restoreIndividualPresentationsAfterSceneFailure();

    expect(
      document.documentElement.hasAttribute("data-an-native-scene-managed"),
    ).toBe(false);
    expect(layer.canvas.style.visibility).toBe("visible");
    expect(frame.hasAttribute("data-an-native-layer-suppressed")).toBe(true);
    expect(receiver.hasAttribute("data-an-native-receiver-suppressed")).toBe(
      false,
    );
    expect(backdropCanvas.style.visibility).toBe("hidden");
  });

  it("enables scene-managed presentation only after a backdrop scene commits", async () => {
    fixture();
    const backdrop = runtime.mounts.get("fill") as {
      instance: { placement: string };
    };
    backdrop.instance.placement = "backdrop";

    expect(
      document.documentElement.hasAttribute("data-an-native-scene-managed"),
    ).toBe(false);
    await runtime.presentScene();
    expect(
      document.documentElement.hasAttribute("data-an-native-scene-managed"),
    ).toBe(true);
  });

  it("renders a zoomed-out scene at its displayed pixel density", async () => {
    fixture();
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = { x: 0, y: 0, width: 1000, height: 1000 };
    runtime.previewDisplayScale = 0.6;
    vi.spyOn(runtime, "previewStatus").mockReturnValue({
      requestedQuality: "auto",
      frameRateTarget: 60,
      devicePixelRatio: 2,
      effectivePixelRatio: 1.5,
      targetFrameIntervalMs: 1000 / 60,
    });
    await runtime.presentScene();
    const scene = runtime.scenePresentation as { canvas: HTMLCanvasElement };
    expect(scene.canvas.width).toBe(900);
    expect(scene.canvas.height).toBe(900);
    expect(scene.canvas.style.width).toBe("1000px");
  });

  it("keeps an explicit export density independent of canvas zoom", async () => {
    fixture();
    runtime.compositionPixelRatio = null;
    runtime.exportInitialPixelRatio = 1;
    runtime.previewViewport = { x: 0, y: 0, width: 1000, height: 1000 };
    runtime.previewDisplayScale = 0.6;
    runtime.previewScenePixelRatio = 0.5;
    await runtime.presentScene();
    const scene = runtime.scenePresentation as { canvas: HTMLCanvasElement };
    expect(scene.canvas.width).toBe(1044);
    expect(scene.canvas.height).toBe(1042);
  });

  it("keeps hidden Backdrop presentation opacity out of the composed source", () => {
    const canvas = document.createElement("canvas");
    canvas.style.opacity = "0";
    canvas.setAttribute("data-an-native-authored-opacity", "1");
    document.documentElement.setAttribute("data-an-native-scene-managed", "");
    runtime.syncSceneSourceOpacity({
      instance: { placement: "backdrop" },
      canvas,
    });
    expect(canvas.getAttribute("data-an-native-authored-opacity")).toBe("1");
    expect(canvas.style.opacity).toBe("0");
    document.documentElement.removeAttribute("data-an-native-scene-managed");
    runtime.syncSceneSourceOpacity({
      instance: { placement: "backdrop" },
      canvas,
    });
    expect(canvas.getAttribute("data-an-native-authored-opacity")).toBe("1");
    document.documentElement.setAttribute("data-an-native-scene-managed", "");
    canvas.style.opacity = "0.65";
    runtime.syncSceneSourceOpacity({
      instance: { placement: "layer" },
      canvas,
    });
    expect(canvas.getAttribute("data-an-native-authored-opacity")).toBe("0.65");
  });

  it("reattaches an existing presentation after its target is wrapped without replacing GPU state", () => {
    const oldParent = document.createElement("div");
    const wrapper = document.createElement("div");
    const target = document.createElement("div");
    const canvas = document.createElement("canvas");
    oldParent.append(target, canvas);
    document.body.append(oldParent, wrapper);
    oldParent.setAttribute("data-an-native-parent-positioned", "");
    runtime.positionedParents.set(oldParent, 1);
    const context = {};
    const pair = new NativePresentationPair(
      { canvas, context },
      () => ({ canvas: document.createElement("canvas"), context: {} }),
      () => {},
    );
    const texture = {};
    const mount = {
      instance: {
        id: "reparented",
        nodeId: "reparented-target",
        placement: "fill",
      },
      target,
      canvas,
      context,
      presentationPair: pair,
      presentationParent: oldParent,
      outputTexture: texture,
      suppressed: false,
    };
    wrapper.append(target);
    canvas.remove();
    runtime.syncPresentation(mount);
    expect(() => pair.prepare()).not.toThrow();
    expect(canvas.parentElement).toBe(wrapper);
    expect(target.nextElementSibling).toBe(canvas);
    expect(mount.outputTexture).toBe(texture);
    expect(pair.visible().context).toBe(context);
    expect(runtime.positionedParents.has(oldParent)).toBe(false);
    expect(oldParent.hasAttribute("data-an-native-parent-positioned")).toBe(
      false,
    );
    expect(runtime.positionedParents.get(wrapper)).toBe(1);
    expect(mount.presentationParent).toBe(wrapper);
    const spare = pair.prepare();
    wrapper.append(target);
    runtime.syncPresentation(mount);
    expect(target.nextElementSibling).toBe(canvas);
    expect(wrapper.querySelectorAll("canvas")).toHaveLength(1);
    expect(runtime.positionedParents.get(wrapper)).toBe(1);
    pair.publish(pair.visible(), spare);
    expect(spare.canvas.parentElement).toBe(wrapper);
    mount.canvas = spare.canvas;
    const nextParent = document.createElement("div");
    document.body.append(nextParent);
    nextParent.append(target, mount.canvas);
    const mutations = new MutationObserver(() => {});
    mutations.observe(nextParent, { childList: true });
    runtime.syncPresentation(mount);
    expect(mutations.takeRecords()).toHaveLength(0);
    mutations.disconnect();
    expect(runtime.positionedParents.has(wrapper)).toBe(false);
    expect(runtime.positionedParents.get(nextParent)).toBe(1);
    expect(mount.presentationParent).toBe(nextParent);
  });

  it("keeps a prepared presentation readable when scene ownership changes before its swap", () => {
    const front = document.createElement("canvas");
    front.setAttribute("data-an-native-presentation", "");
    front.style.opacity = "0.65";
    document.body.append(front);
    const pair = new NativePresentationPair(
      { canvas: front, context: {} },
      (surface) => ({
        canvas: surface.canvas.cloneNode(false) as HTMLCanvasElement,
        context: {},
      }),
      () => {},
    );
    const previous = pair.visible();
    const prepared = pair.prepare();
    const mount = {
      instance: { placement: "fill" },
      canvas: front,
      presentationPair: pair,
    };
    document.documentElement.setAttribute("data-an-native-scene-managed", "");
    runtime.syncSceneSourceOpacity(mount);
    pair.publish(previous, prepared);
    expect(() =>
      sourceProvider.nativePresentationVisible(prepared.canvas, {
        width: 100,
        height: 100,
      }),
    ).not.toThrow();
    expect(
      prepared.canvas.getAttribute("data-an-native-authored-opacity"),
    ).toBe("0.65");
    document.documentElement.removeAttribute("data-an-native-scene-managed");
    mount.canvas = prepared.canvas;
    runtime.syncSceneSourceOpacity(mount);
    expect(
      pair
        .surfaces()
        .every(
          ({ canvas }) =>
            !canvas.hasAttribute("data-an-native-authored-opacity"),
        ),
    ).toBe(true);
  });

  it("separates SVG Fill alpha from authored strokes without changing the source", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 19");
    svg.setAttribute("data-an-native-authored-opacity", "0.65");
    svg.innerHTML =
      '<defs><linearGradient id="paint"><stop stop-opacity="0"/><stop offset="1" stop-opacity="0.4"/></linearGradient></defs><polygon points="0,0 160,0 160,19 0,19" fill="url(#paint)"/><circle cx="30" cy="10" r="3" fill="none" stroke="currentColor"/>';
    document.body.append(svg);
    const authored = svg.outerHTML;
    const style = {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      boxShadow: "none",
      outlineStyle: "none",
      borderTopLeftRadius: "0px",
      borderTopRightRadius: "0px",
      borderBottomLeftRadius: "0px",
      borderBottomRightRadius: "0px",
      overflowX: "hidden",
      overflowY: "hidden",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
      colorInterpolation: "sRGB",
      color: "rgb(20, 40, 60)",
      fill: "rgb(20, 40, 60)",
      stroke: "none",
      opacity: "0.7",
      transform: "matrix(1, 0, 0, 1, 50, 30)",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          ...style,
          fill: element.getAttribute("fill") ?? style.fill,
          stroke:
            element.getAttribute("stroke") === "currentColor"
              ? style.color
              : "none",
          stopOpacity: element.getAttribute("stop-opacity") ?? "1",
          transform: element === svg ? style.transform : "none",
        }) as CSSStyleDeclaration,
    );
    const capture = (phase: "fill" | "stroke" | "coverage") =>
      new DOMParser().parseFromString(
        serializeNativeSvgSource(
          svg,
          { width: 160, height: 19 },
          undefined,
          phase,
        ),
        "image/svg+xml",
      );
    const fill = capture("fill");
    expect(fill.documentElement.getAttribute("opacity")).toBe("1");
    expect(fill.documentElement.getAttribute("transform")).toBe("none");
    expect(fill.querySelector("polygon")!.getAttribute("fill")).toBe(
      "url(#paint)",
    );
    expect(fill.querySelector("circle")!.getAttribute("fill")).toBe("none");
    expect(fill.querySelector("circle")!.getAttribute("stroke")).toBe("none");
    expect(fill.querySelector("stop")!.getAttribute("stop-opacity")).toBe("0");
    expect(fill.querySelector("polygon")!.getAttribute("opacity")).toBe("0.7");
    const stroke = capture("stroke");
    expect(stroke.querySelector("polygon")!.getAttribute("fill")).toBe("none");
    expect(stroke.querySelector("circle")!.getAttribute("stroke")).toBe(
      style.color,
    );
    expect(
      capture("coverage").querySelector("circle")!.getAttribute("stroke"),
    ).toBe(style.color);
    expect(svg.outerHTML).toBe(authored);
  });

  it("maps SVG viewBox letterboxing into its transformed offscreen CSS viewport", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "10 20 100 50");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      width: "200px",
      height: "200px",
    } as CSSStyleDeclaration);
    Object.defineProperty(svg, "getScreenCTM", {
      value: () => ({ a: 0, b: 4, c: -4, d: 0, e: -440, f: 160 }),
    });
    expect(nativeSvgViewportToClient(svg)).toEqual({
      a: 0,
      b: 2,
      c: -2,
      d: 0,
      e: -420,
      f: 200,
    });
  });

  it("keeps scene-suppressed SVG opacity in the raster source after invalidation", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 19");
    svg.innerHTML =
      '<polygon points="0,0 160,0 160,19 0,19" fill="currentColor"/>';
    svg.setAttribute("data-an-native-scene-suppressed", "");
    svg.setAttribute("data-an-native-authored-opacity", "0.65");
    document.body.append(svg);
    const computedStyle = {
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      boxShadow: "none",
      outlineStyle: "none",
      borderTopLeftRadius: "0px",
      borderTopRightRadius: "0px",
      borderBottomLeftRadius: "0px",
      borderBottomRightRadius: "0px",
      overflowX: "hidden",
      overflowY: "hidden",
      paddingTop: "0px",
      paddingRight: "0px",
      paddingBottom: "0px",
      paddingLeft: "0px",
      colorInterpolation: "sRGB",
      color: "rgb(20, 40, 60)",
      fill: "rgb(20, 40, 60)",
      opacity: "1",
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      element === svg ? { ...computedStyle, opacity: "0" } : computedStyle,
    );

    const markup = serializeNativeSvgSource(svg, { width: 160, height: 19 });
    const captured = new DOMParser().parseFromString(markup, "image/svg+xml");

    expect(captured.documentElement.getAttribute("opacity")).toBe("0.65");
    expect(captured.querySelector("polygon")!.getAttribute("fill")).toBe(
      "rgb(20, 40, 60)",
    );
    expect(svg.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    expect(svg.getAttribute("data-an-native-authored-opacity")).toBe("0.65");
    svg.setAttribute("data-an-native-authored-opacity", "unreadable");
    expect(() =>
      serializeNativeSvgSource(svg, { width: 160, height: 19 }),
    ).toThrow("Authored SVG opacity is not a finite value in [0, 1].");
  });

  it("composes a direct SVG root as an atomic source and restores its authored opacity after unpublishing", async () => {
    const { frame, scene, submit, provider } = fixture();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 19");
    svg.setAttribute(
      "style",
      "position:absolute;left:874px;top:515px;width:160px;height:19px;opacity:0.65;color:rgb(20,40,60)",
    );
    svg.innerHTML =
      '<defs><linearGradient id="mark"><stop stop-color="currentColor"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path d="M0 0H160V19H0Z" fill="url(#mark)"/>';
    document.body.append(svg);
    const authoredMarkup = svg.outerHTML;
    const computedStyle = getComputedStyle(svg);
    vi.mocked(getComputedStyle).mockImplementation((element) =>
      element === svg ? { ...computedStyle, opacity: "0.65" } : computedStyle,
    );
    const raster = document.createElement("canvas");
    const records = [
      { node: frame, nativeInstanceId: "fill" },
      { node: svg, source: raster },
    ];
    provider.readScene.mockResolvedValue(records);

    await runtime.presentScene();

    expect(runtime.composeScene).toHaveBeenCalledWith(
      scene.surface,
      records,
      expect.anything(),
      "source",
      "srgb-css-linear",
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(scene.canvas.style.visibility).toBe("visible");
    expect(scene.suppressedElements.has(svg)).toBe(true);
    expect(svg.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    expect(svg.getAttribute("data-an-native-authored-opacity")).toBe("0.65");

    runtime.unpublishScenePresentation(scene);

    expect(svg.isConnected).toBe(true);
    expect(svg.outerHTML).toBe(authoredMarkup);
    expect(scene.suppressedElements.size).toBe(0);
    expect(scene.canvas.isConnected).toBe(false);
  });

  it("rejects a bare SVG fragment before publishing an incomplete scene", async () => {
    const { provider, submit } = fixture();
    document.body.append(
      document.createElementNS("http://www.w3.org/2000/svg", "path"),
    );

    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "scene-direct-element-unsupported",
    });

    expect(provider.readScene).not.toHaveBeenCalled();
    expect(runtime.composeScene).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("composes static document overflow at the selected viewport without changing authored geometry", async () => {
    const { frame, scene, submit, provider } = fixture();
    frame.style.cssText =
      "position:absolute;left:958px;top:421px;width:361px;height:209px";
    await runtime.presentScene();
    expect(provider.readScene).toHaveBeenCalledOnce();
    expect(runtime.composeScene).toHaveBeenCalledWith(
      scene.surface,
      await provider.readScene.mock.results[0]!.value,
      expect.anything(),
      "source",
      "linear",
    );
    expect(runtime.bind.mock.calls[0]![5]).toEqual(
      new Float32Array([1044, 1042, 0, 0, 1, 0, 0, 0]),
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(scene.canvas.style.visibility).toBe("visible");
    expect(frame.style.left).toBe("958px");
    expect(frame.style.width).toBe("361px");
    expect(runtime.releaseScenePresentation).not.toHaveBeenCalled();
  });

  it("presents scenes with a rasterizable viewport gradient background", async () => {
    const { scene, submit, provider, computedStyle } = fixture();
    computedStyle.backgroundImage = "linear-gradient(90deg, blue, pink)";

    await runtime.presentScene();

    expect(provider.readScene).toHaveBeenCalledOnce();
    expect(runtime.composeScene).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(scene.canvas.style.visibility).toBe("visible");
  });

  it("preserves canonical legacy density and chooses the strictest mixed-target policy", async () => {
    fixture();
    const legacy = {
      definitionHash:
        await effectTrust.hashEffectDefinition(GLOWING_WAVES_EFFECT),
    };
    const current = { definitionHash: "custom-document-pixels" };
    const scale = (members: unknown[], localScale: number) =>
      (
        runtime as unknown as {
          targetPreviewDisplayScale(
            members: unknown[],
            localScale: number,
          ): number;
        }
      ).targetPreviewDisplayScale(members, localScale);
    runtime.previewDisplayScale = 0.25;
    expect(scale([legacy], 2)).toBe(1);
    expect(scale([current], 2)).toBe(0.5);
    expect(scale([legacy, current], 2)).toBe(1);
    expect(scale([legacy, current], 8)).toBe(2);
    runtime.previewDisplayScale = 2;
    expect(scale([legacy], 2)).toBe(2);
    expect(scale([current], 2)).toBe(4);
  });

  it("reports display pixel density independently of the camera backing scale", () => {
    vi.stubGlobal("devicePixelRatio", 1.6);
    runtime.previewDisplayScale = 1;
    const baseline = runtime.previewStatus().effectivePixelRatio;
    runtime.previewDisplayScale = 0.35;
    expect(runtime.previewStatus().effectivePixelRatio).toBe(baseline);
    runtime.previewDisplayScale = 4;
    expect(runtime.previewStatus().effectivePixelRatio).toBe(baseline * 4);
  });

  it.each([
    [1, 12],
    [2, 1],
  ])(
    "fits zoomed-out generators at screen density with CSS scale %s and count %s",
    (localScale, count) => {
      fixture();
      vi.stubGlobal("devicePixelRatio", 2);
      runtime.compositionPixelRatio = null;
      runtime.scenePresentation = null;
      runtime.previewDisplayScale = 0.25;
      runtime.previewViewport = { x: 0, y: 0, width: 6400, height: 3904 };
      vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
      const targets = Array.from({ length: count }, (_, index) => {
        const target = document.createElement("div");
        Object.defineProperties(target, {
          offsetWidth: { value: 800 },
          offsetHeight: { value: 600 },
          getBoundingClientRect: {
            value: () =>
              new DOMRect(
                (index % 4) * 820,
                Math.floor(index / 4) * 620,
                800 * localScale,
                600 * localScale,
              ),
          },
        });
        document.body.append(target);
        return target;
      });
      runtime.mounts = new Map(
        targets.map((target, index) => [
          String(index),
          {
            target,
            pixelRatio: 1,
            instance: {
              id: String(index),
              nodeId: String(index),
              placement: "fill",
            },
            captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
            definition: {
              resources: [{ kind: "texture-2d", format: "rgba8unorm" }],
            },
          },
        ]),
      );
      expect(() => runtime.planPreviewTargetDensities()).not.toThrow();
      expect([...runtime.previewTargetDensities.values()]).toEqual(
        Array(count).fill(0.5 * localScale),
      );
    },
  );

  it("shares the realm working budget across a dense 200% scene while preserving small SVG resolution", () => {
    const { scene, provider } = fixture();
    vi.stubGlobal("devicePixelRatio", 1.6);
    runtime.compositionPixelRatio = null;
    runtime.previewDisplayScale = 2;
    runtime.previewViewport = { x: 400, y: 400, width: 244, height: 521 };
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    runtime.previewPolicy.resetDensityBudget();
    runtime.previewPolicy.observeResourceBudgetExceeded();
    runtime.previewPolicy.observeResourceBudgetExceeded();
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    const sizes = [
      [24, 24, 256, 256],
      [24, 292, 260, 24],
      [150, 24, 256, 256],
      [24, 370, 800, 600],
      [450, 515, 160, 19],
      [450, 559, 160, 19],
      [100, 700, 640, 75],
      [420, 400, 320, 200],
      [600, 728, 622, 241],
    ];
    const targets = sizes.map(([x, y, width, height]) => {
      const target = document.createElement("div");
      Object.defineProperties(target, {
        offsetWidth: { value: width },
        offsetHeight: { value: height },
        getBoundingClientRect: {
          value: () => ({
            left: x,
            top: y,
            right: x! + width!,
            bottom: y! + height!,
            width,
            height,
          }),
        },
      });
      document.body.append(target);
      return target;
    });
    runtime.mounts = new Map(
      targets.map((target, index) => [
        String(index),
        {
          target,
          pixelRatio: 1.2,
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: index === 6 || index === 7 ? "backdrop" : "fill",
          },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: {
            resources: [{ kind: "texture-2d", format: "rgba16float" }],
          },
        },
      ]),
    );
    expect(runtime.planPreviewTargetDensities()).toBe(true);
    expect(runtime.previewTargetDensities.get(targets[4]!)).toBeCloseTo(2.4);
    expect(runtime.previewTargetDensities.get(targets[5]!)).toBeCloseTo(2.4);
    expect(runtime.previewTargetDensities.get(targets[3]!)).toBeGreaterThan(
      1.2,
    );
    expect(runtime.previewTargetDensities.get(targets[3]!)).toBeLessThan(2.4);
    expect(runtime.previewTargetDensities.get(targets[0]!)).toBeCloseTo(2.4);
    const plan = [...runtime.previewTargetDensities.values()];
    const allocated = runtime.allocatedTextureBytes;
    try {
      runtime.allocatedTextureBytes = 350_000_000;
      runtime.planPreviewTargetDensities();
      expect([...runtime.previewTargetDensities.values()]).toEqual(plan);
    } finally {
      runtime.allocatedTextureBytes = allocated;
    }
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, true, true],
  ])(
    "stages preview submissions with deterministic=%s and atomic owner=%s and external dependency=%s",
    async (deterministic, atomic, external) => {
      fixture();
      runtime.compositionPixelRatio = null;
      runtime.scenePresentation = null;
      const targets = [0, 1].map((index) => {
        const target = document.createElement("div");
        Object.defineProperty(target, "getBoundingClientRect", {
          value: () => new DOMRect(index * 200, 0, 100, 100),
        });
        document.body.append(target);
        return {
          target,
          canvas: document.createElement("canvas"),
          isTopLayer: true,
          authoredInputs: new Map(),
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: "fill",
          },
          definition: { kind: "generator", resources: [] },
        };
      });
      let child: (typeof targets)[number] | undefined;
      if (atomic) {
        child = {
          ...targets[1]!,
          target: document.createElement("div"),
          instance: { id: "child", nodeId: "child", placement: "backdrop" },
          definition: { kind: "processor", resources: [] },
        };
        Object.defineProperty(child.target, "getBoundingClientRect", {
          value: () => new DOMRect(0, 0, 50, 50),
        });
        targets[0]!.target.append(child.target);
      }
      runtime.mounts = new Map(
        targets.map((mount, index) => [String(index), mount]),
      );
      if (child) runtime.mounts.set("child", child);
      vi.spyOn(runtime, "presentScene").mockResolvedValue();
      vi.spyOn(runtime, "planPreviewTargetDensities").mockReturnValue(false);
      vi.spyOn(
        runtime as unknown as { ensureDevice(): Promise<void> },
        "ensureDevice",
      ).mockResolvedValue();
      vi.spyOn(
        runtime as unknown as { retireBindings(): void },
        "retireBindings",
      ).mockImplementation(() => {});
      let release!: () => void;
      const validation = new Promise<void>((resolve) => {
        release = resolve;
      });
      let second!: () => void;
      const secondSubmitted = new Promise<void>((resolve) => {
        second = resolve;
      });
      const events: string[] = [];
      vi.spyOn(runtime, "renderMount").mockImplementation(
        async (mount, _time, _deterministic, complete, _active, submitted) => {
          if (complete.has((mount as (typeof targets)[number]).instance.id))
            return;
          const index = targets.indexOf(mount as (typeof targets)[number]);
          events.push(`submit${index}`);
          if (index === 0 && external)
            await runtime.renderMount(
              targets[1],
              _time,
              _deterministic,
              complete,
              new Set(["0"]),
            );
          submitted?.();
          if (index === 0) await validation;
          else second();
          events.push(`publish${index}`);
          complete.add(String(index));
          if (index === 0 && child) {
            complete.add("child");
            events.push("publish-child");
          }
        },
      );
      const frame = runtime.renderInternal(0, deterministic);
      if (deterministic) {
        await vi.waitFor(() => expect(events).toEqual(["submit0"]));
        release();
      } else {
        await vi
          .waitFor(() => expect(events).toContain("submit1"))
          .catch((error) => {
            release();
            throw error;
          });
        await secondSubmitted;
        expect(events).toContain("submit1");
        expect(events).not.toContain("publish0");
        expect(events).not.toContain("publish-child");
        release();
      }
      await frame;
      expect(events).toContain("publish0");
      expect(events).toContain("publish1");
      if (atomic) expect(events).toContain("publish-child");
      expect(events.filter((event) => event === "submit1")).toHaveLength(1);
    },
  );

  it("does no GPU or budget work for an empty live camera and resumes at the current time", async () => {
    const { frame, submit } = fixture();
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = { x: 4000, y: 4000, width: 1000, height: 1000 };
    Object.defineProperty(frame, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 100, 100),
    });
    const mount = runtime.mounts.get("fill") as Record<string, unknown>;
    mount.definition = { kind: "generator", resources: [] };
    mount.authoredInputs = new Map();
    const internals = runtime as unknown as {
      refreshPreviewViewport(): boolean;
      ensureDevice(): Promise<void>;
      retireBindings(): void;
    };
    vi.spyOn(internals, "refreshPreviewViewport").mockReturnValue(true);
    const ensure = vi.spyOn(internals, "ensureDevice").mockResolvedValue();
    const budget = vi
      .spyOn(runtime, "planPreviewTargetDensities")
      .mockReturnValue(false);
    const retire = vi
      .spyOn(internals, "retireBindings")
      .mockImplementation(() => {});
    const restore = vi
      .spyOn(runtime, "restoreIndividualPresentationsAfterSceneFailure")
      .mockImplementation(() => {});
    const rendered = vi
      .spyOn(runtime, "renderMount")
      .mockImplementation(
        async (_mount, _time, _deterministic, complete, _active, submitted) => {
          submitted?.();
          complete.add("fill");
        },
      );
    const epoch = (runtime as unknown as { renderEpoch: number }).renderEpoch;
    const result = (await runtime.renderInternal(4, false)) as {
      rendered: number;
      failures: unknown[];
    };
    expect(result).toMatchObject({ rendered: 0, failures: [] });
    expect(ensure).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
    expect(rendered).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(retire).not.toHaveBeenCalled();
    expect(runtime.releaseScenePresentation).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(frame.getAttribute("data-an-native-culled")).toBe("true");
    expect((runtime as unknown as { renderEpoch: number }).renderEpoch).toBe(
      epoch,
    );
    runtime.previewViewport = { x: 0, y: 0, width: 1000, height: 1000 };
    await runtime.renderInternal(9, false);
    expect(ensure).toHaveBeenCalledOnce();
    expect(budget).toHaveBeenCalledOnce();
    expect(rendered.mock.calls[0]?.[1]).toBe(9);
  });

  it("keeps a CSS-scaled declared effect halo contributing before its first output exists", () => {
    fixture();
    runtime.previewViewport = { x: 0, y: 0, width: 100, height: 100 };
    const target = document.createElement("div");
    Object.defineProperties(target, {
      offsetWidth: { value: 100 },
      offsetHeight: { value: 100 },
      getBoundingClientRect: { value: () => new DOMRect(130, 0, 200, 200) },
    });
    document.body.append(target);
    const mount = {
      target,
      pixelRatio: 1,
      outputExtent: null,
      definition: {
        extent: { output: { left: 20, top: 0, right: 0, bottom: 0 } },
      },
    };
    expect(runtime.offscreen(mount)).toBe(false);
    expect(runtime.offscreen({ ...mount, definition: {} })).toBe(true);
  });

  it("culls against the editor camera, preserves effect halos, and resumes on camera return", () => {
    fixture();
    vi.stubGlobal("innerWidth", 8192);
    vi.stubGlobal("innerHeight", 8192);
    runtime.previewViewport = { x: 4000, y: 4000, width: 1000, height: 1000 };
    const target = document.createElement("div");
    document.body.append(target);
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => new DOMRect(5100, 4200, 270, 270),
    });
    const mount = { target, pixelRatio: 1.5, outputExtent: null };
    expect(runtime.offscreen(mount)).toBe(true);
    expect(
      runtime.offscreen({
        ...mount,
        outputExtent: { left: 151, top: 0, right: 0, bottom: 0 },
      }),
    ).toBe(false);
    runtime.previewViewport = { x: 5000, y: 4000, width: 1000, height: 1000 };
    expect(runtime.offscreen(mount)).toBe(false);
    runtime.previewViewport = null;
    expect(runtime.offscreen(mount)).toBe(false);
  });

  it.each([
    "fill",
    "backdrop",
    "opacity",
    "mask",
    "radii",
    "transform",
    "size",
    "format",
    "text",
    "invalid",
    "backdrop-text",
  ])("elides only an exact identity finish pass: %s", async (mode) => {
    fixture();
    vi.stubGlobal("GPUTextureUsage", { COPY_SRC: 1 });
    const white = {};
    const internals = runtime as unknown as {
      white: unknown;
      workingFormat: string;
      finishPipeline: unknown;
      finish(
        mount: unknown,
        source: unknown,
        encoder: unknown,
      ): Promise<unknown>;
      textMask(): Promise<unknown>;
      cornerRadii(): number[];
      texture(): unknown;
    };
    internals.white = white;
    internals.finishPipeline = {};
    const source = {
      width: mode === "size" ? 99 : 100,
      height: 100,
      format: mode === "format" ? "different-format" : internals.workingFormat,
    };
    const output = { createView: () => ({}) };
    const allocation = vi.spyOn(internals, "texture").mockReturnValue(output);
    vi.spyOn(internals, "textMask").mockResolvedValue(
      mode === "mask" ? {} : white,
    );
    vi.spyOn(internals, "cornerRadii").mockReturnValue(
      mode === "radii" ? [4, 4, 4, 4, 4, 4, 4, 4] : [0, 0, 0, 0, 0, 0, 0, 0],
    );
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    const instance = {
      placement: mode.startsWith("backdrop")
        ? "backdrop"
        : mode === "radii"
          ? "layer"
          : "fill",
      opacity: mode === "opacity" || mode === "backdrop" ? 0.5 : 1,
      clip: mode === "text" || mode === "backdrop-text" ? "text" : "box",
      transform:
        mode === "transform"
          ? { translate: [1, 0] }
          : mode === "invalid"
            ? { scale: [0, 1] }
            : undefined,
    };
    const mount = {
      width: 100,
      height: 100,
      pixelRatio: 1,
      instance,
      definition: { kind: "generator" },
      resourceTextures: new Map(),
    };
    if (mode === "invalid" || mode === "backdrop-text") {
      await expect(
        internals.finish(mount, source, encoder),
      ).rejects.toMatchObject({
        code:
          mode === "invalid"
            ? "effect-transform-invalid"
            : "backdrop-text-replacement-unsupported",
      });
      expect(allocation).not.toHaveBeenCalled();
      expect(encoder.beginRenderPass).not.toHaveBeenCalled();
      return;
    }
    const result = await internals.finish(mount, source, encoder);
    if (mode === "fill" || mode === "backdrop") {
      expect(result).toBe(source);
      expect(allocation).not.toHaveBeenCalled();
      expect(encoder.beginRenderPass).not.toHaveBeenCalled();
    } else {
      expect(result).toBe(output);
      expect(allocation).toHaveBeenCalledOnce();
      expect(encoder.beginRenderPass).toHaveBeenCalledOnce();
      expect(pass.draw).toHaveBeenCalledExactlyOnceWith(6);
    }
  });

  it("keeps same-key uniform uploads separate across batched mount surfaces", () => {
    fixture();
    vi.stubGlobal("GPUBufferUsage", { UNIFORM: 1, COPY_DST: 2 });
    const bytes = new Map<object, number>();
    const device = runtime.device as Record<string, unknown> & {
      queue: Record<string, unknown>;
    };
    device.createBuffer = () => ({});
    device.createBindGroup = () => ({});
    device.queue.writeBuffer = (
      buffer: object,
      _offset: number,
      data: Float32Array,
    ) => {
      bytes.set(buffer, data[0]!);
    };
    vi.spyOn(
      runtime as unknown as { estimatedResourceBytes(): number },
      "estimatedResourceBytes",
    ).mockReturnValue(0);
    const bind = Object.getPrototypeOf(runtime).bind as (
      ...args: unknown[]
    ) => unknown;
    const surfaces = [0, 1].map(() => ({
      drawBindings: new Map<string, { buffer: object }>(),
    }));
    const pipeline = { getBindGroupLayout: () => ({}) };
    const source = { createView: () => ({}) };
    for (const [index, surface] of surfaces.entries())
      bind.call(
        runtime,
        surface,
        "same-pass",
        pipeline,
        source,
        null,
        new Float32Array([index ? 7 : 3]),
        {},
      );
    const commands = surfaces.map(
      (surface) => () =>
        bytes.get(surface.drawBindings.get("same-pass")!.buffer),
    );
    expect(surfaces[0]!.drawBindings.get("same-pass")!.buffer).not.toBe(
      surfaces[1]!.drawBindings.get("same-pass")!.buffer,
    );
    expect(commands.map((execute) => execute())).toEqual([3, 7]);
  });

  it("prepares a transaction-owned backdrop front before any GPU publication", async () => {
    fixture();
    const target = document.createElement("div");
    const canvas = document.createElement("canvas");
    document.body.append(target, canvas);
    const marker = new Error("transaction backdrop pair prepared");
    const mount = {
      target,
      canvas,
      isTopLayer: true,
      suppressed: true,
      instance: {
        id: "glass",
        nodeId: "glass",
        placement: "backdrop",
        params: {},
        timing: { time: 0, speed: 1, paused: false },
      },
      definition: {
        id: "glass",
        version: 1,
        kind: "processor",
        properties: {},
        passes: [],
        resources: [],
      },
      definitionHash: "hash",
      clock: { paused: false, local: 0, global: 0, speed: 1 },
      width: 100,
      height: 100,
      pixelRatio: 1,
      captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      resourceTextures: new Map(),
      assetTextures: new Map(),
      isolationTextures: new Map(),
      sourceTextures: new Map(),
      staticGeneratorPassCache: { read: () => null, invalidate: vi.fn() },
      renderWallSamples: [],
      frameCount: 1,
      outputTexture: {},
      provider: {
        setLayerTargetOpacityDeferred: vi.fn(),
        setDensity: vi.fn(),
        setGroupLocalBackdropSource: vi.fn(),
        needsContinuousFrames: () => false,
        readScene: vi.fn(async () => []),
        sourceEpoch: () => 7,
        authoredSourceEpoch: () => 7,
      },
    };
    runtime.mounts = new Map([["glass", mount]]);
    runtime.frameTransaction = {
      transaction: new NativeStatelessFrameTransaction(),
      candidates: new Map(),
      jobs: new Map(),
    };
    vi.spyOn(runtime, "layout").mockImplementation(() => {});
    const internals = runtime as unknown as {
      beginGpuSample(): null;
      effectPasses(): Promise<object>;
      finish(): Promise<object>;
    };
    vi.spyOn(internals, "beginGpuSample").mockReturnValue(null);
    vi.spyOn(internals, "effectPasses").mockResolvedValue({});
    vi.spyOn(internals, "finish").mockResolvedValue({});
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    runtime.preparePresentationPair = vi.fn(() => {
      throw marker;
    });
    await expect(
      runtime.renderMount(mount, 0, false, new Set(), new Set(), () => {}),
    ).rejects.toBe(marker);
    expect(runtime.preparePresentationPair).toHaveBeenCalledWith(
      mount,
      runtime.device,
    );
    const scopedDevice = runtime.device as {
      pushErrorScope: ReturnType<typeof vi.fn>;
      popErrorScope: ReturnType<typeof vi.fn>;
    };
    expect(scopedDevice.pushErrorScope).not.toHaveBeenCalled();
    expect(scopedDevice.popErrorScope).not.toHaveBeenCalled();
  });

  it("renders a visible parent without laying out its hidden nested backdrop", async () => {
    fixture();
    const target = document.createElement("div");
    const receiver = document.createElement("div");
    target.append(receiver);
    document.body.append(target);
    let hidden = true;
    vi.mocked(window.getComputedStyle).mockImplementation(
      (element) =>
        ({
          display: element === receiver && hidden ? "none" : "block",
          visibility: "visible",
          overflowX: "hidden",
          overflowY: "hidden",
        }) as CSSStyleDeclaration,
    );
    for (const element of [target, receiver])
      Object.defineProperty(element, "getBoundingClientRect", {
        value: () => new DOMRect(0, 0, 100, 100),
      });
    const reachedSource = new Error("source boundary reached");
    const setGroupLocalBackdropSource = vi.fn(() => {
      throw reachedSource;
    });
    const parent = {
      target,
      canvas: document.createElement("canvas"),
      isTopLayer: true,
      instance: { id: "parent", nodeId: "parent", placement: "fill" },
      definition: { resources: [], passes: [] },
      clock: {},
      provider: {
        setLayerTargetOpacityDeferred: vi.fn(),
        setDensity: vi.fn(),
        setGroupLocalBackdropSource,
      },
    };
    const child = {
      target: receiver,
      instance: { id: "child", nodeId: "child", placement: "backdrop" },
      definition: {},
      provider: { setDensity: vi.fn() },
    };
    runtime.mounts = new Map([
      ["parent", parent],
      ["child", child],
    ]);
    runtime.previewViewport = { x: 4000, y: 4000, width: 1000, height: 1000 };
    expect(runtime.offscreen(parent)).toBe(true);
    target.setAttribute("data-an-native-culled", "true");
    const layout = vi.spyOn(runtime, "layout").mockImplementation(() => {});
    await expect(
      runtime.renderMount(parent, 0, false, new Set(), new Set()),
    ).rejects.toBe(reachedSource);
    expect(target.hasAttribute("data-an-native-culled")).toBe(false);
    expect(layout.mock.calls.map(([mount]) => mount)).toEqual([parent]);
    expect(setGroupLocalBackdropSource).toHaveBeenLastCalledWith(false);
    hidden = false;
    layout.mockClear();
    await expect(
      runtime.renderMount(parent, 0, false, new Set(), new Set()),
    ).rejects.toBe(reachedSource);
    expect(layout.mock.calls.map(([mount]) => mount)).toEqual([parent, child]);
    expect(setGroupLocalBackdropSource).toHaveBeenLastCalledWith(true);
  });

  it("excludes hidden and empty mounts and rejoins them when visible", () => {
    fixture();
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = { x: 0, y: 0, width: 800, height: 600 };
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    const parent = document.createElement("div");
    const targets = Array.from({ length: 3 }, () =>
      document.createElement("div"),
    );
    parent.append(...targets);
    document.body.append(parent);
    document.body.append(targets[0]!);
    let empty = true;
    let hidden = true;
    let invalid = false;
    vi.mocked(window.getComputedStyle).mockImplementation(
      (element) =>
        ({
          display: element === parent && hidden ? "none" : "block",
          visibility: element === parent ? "hidden" : "visible",
        }) as CSSStyleDeclaration,
    );
    targets.forEach((target, index) =>
      Object.defineProperties(target, {
        offsetWidth: {
          get: () => (invalid ? Number.NaN : index === 1 && empty ? 0 : 100),
        },
        offsetHeight: { value: 100 },
        getBoundingClientRect: {
          value: () => ({
            left: 10,
            top: 10,
            right: 110,
            bottom: 110,
            width: index === 1 && empty ? 0 : 100,
            height: 100,
          }),
        },
      }),
    );
    runtime.mounts = new Map(
      targets.map((target, index) => [
        String(index),
        {
          target,
          pixelRatio: 1,
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: "fill",
          },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: { resources: [] },
        },
      ]),
    );
    runtime.planPreviewTargetDensities();
    expect([...runtime.previewTargetDensities.keys()]).toEqual([targets[0]]);
    hidden = false;
    runtime.planPreviewTargetDensities();
    expect([...runtime.previewTargetDensities.keys()]).toEqual([
      targets[0],
      targets[2],
    ]);
    empty = false;
    runtime.planPreviewTargetDensities();
    expect([...runtime.previewTargetDensities.keys()]).toEqual(targets);
    invalid = true;
    expect(() => runtime.planPreviewTargetDensities()).toThrow();
  });

  it("budgets the committed scene viewport instead of the oversized editor iframe", () => {
    const { scene, provider, frame } = fixture();
    vi.stubGlobal("innerWidth", 8192);
    vi.stubGlobal("innerHeight", 12288);
    vi.stubGlobal("devicePixelRatio", 1);
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = { x: 0, y: 0, width: 800, height: 600 };
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    Object.defineProperties(frame, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 300 },
      getBoundingClientRect: {
        configurable: true,
        value: () => new DOMRect(0, 0, 400, 300),
      },
    });
    runtime.mounts = new Map([
      [
        "fill",
        {
          target: frame,
          pixelRatio: 1,
          instance: { id: "fill", nodeId: "fill", placement: "fill" },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: { resources: [] },
        },
      ],
    ]);
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(() => runtime.planPreviewTargetDensities()).not.toThrow();
    expect(runtime.previewTargetDensities.get(frame)).toBe(1);
  });

  it("can lower density while the preceding high-density scene is still committed", () => {
    const { scene, provider } = fixture();
    vi.stubGlobal("innerWidth", 8192);
    vi.stubGlobal("innerHeight", 12288);
    vi.stubGlobal("devicePixelRatio", 2);
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = {
      x: 3842,
      y: 4793,
      width: 1706.6666,
      height: 1626.6666,
    };
    runtime.previewDisplayScale = 0.6;
    scene.canvas.width = 1876;
    scene.canvas.height = 1788;
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    runtime.previewPolicy.resetDensityBudget();
    runtime.previewPolicy.observeResourceBudgetExceeded();
    runtime.previewPolicy.observeResourceBudgetExceeded();
    const targets = [
      [715, 475],
      [633, 379],
    ].map(([width, height]) => {
      const target = document.createElement("div");
      Object.defineProperties(target, {
        offsetWidth: { value: width },
        offsetHeight: { value: height },
        getBoundingClientRect: {
          value: () => new DOMRect(5029, 6247, width, height),
        },
      });
      document.body.append(target);
      return target;
    });
    runtime.mounts = new Map(
      targets.map((target, index) => [
        String(index),
        {
          target,
          pixelRatio: 2,
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: index ? "backdrop" : "layer",
          },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: { resources: [] },
        },
      ]),
    );
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(runtime.planPreviewTargetDensities()).toBe(true);
    expect([...runtime.previewTargetDensities.values()]).toEqual([
      1.5 * runtime.previewDisplayScale,
      1.5 * runtime.previewDisplayScale,
    ]);
    expect(runtime.previewScenePixelRatio).toBeGreaterThan(0.5);
    expect(runtime.previewScenePixelRatio).toBeLessThan(0.9);
    const density = runtime.previewScenePixelRatio!;
    for (let frame = 0; frame < 4; frame += 1) {
      const physical = nativePreviewPhysicalViewport(
        runtime.previewViewport!,
        density,
      );
      scene.canvas.width = physical.width;
      scene.canvas.height = physical.height;
      runtime.planPreviewTargetDensities();
      expect(runtime.previewScenePixelRatio).toBe(density);
    }
  });

  it("fits seven targets during a viewport transition using actual retained scene allocations", () => {
    const { scene, provider } = fixture();
    vi.stubGlobal("devicePixelRatio", 1.5);
    runtime.compositionPixelRatio = null;
    runtime.previewDisplayScale = 0.1681;
    runtime.previewViewport = { x: 0, y: 0, width: 6000, height: 5800 };
    scene.canvas.width = 1876;
    scene.canvas.height = 1788;
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    const retained = {};
    scene.surface.resourceTextures.set("scene", retained);
    scene.surface.sourceTextures.set("same-scene", { texture: retained });
    runtime.textureBytes.set(retained, 1876 * 1788 * 4);
    const targets = [
      [715, 475],
      [360, 300],
      ...Array.from({ length: 5 }, () => [270, 270]),
    ].map(([width, height], index) => {
      const target = document.createElement("div");
      Object.defineProperties(target, {
        offsetWidth: { value: width },
        offsetHeight: { value: height },
        getBoundingClientRect: {
          value: () => new DOMRect(index * 300, 0, width, height),
        },
      });
      document.body.append(target);
      return target;
    });
    runtime.mounts = new Map(
      targets.map((target, index) => [
        String(index),
        {
          target,
          pixelRatio: 1.5,
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: index === 1 ? "backdrop" : "fill",
          },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: { resources: [] },
        },
      ]),
    );
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(() => runtime.planPreviewTargetDensities()).not.toThrow();
    expect([...runtime.previewTargetDensities.values()]).toEqual(
      Array(7).fill(1.5 * runtime.previewDisplayScale),
    );
    expect(runtime.previewScenePixelRatio).toBeCloseTo(1.5 * 0.1681);
    scene.surface.resourceTextures.set("untracked", {});
    expect(() => runtime.planPreviewTargetDensities()).toThrow(
      "A retained scene texture has no allocation accounting.",
    );
  });

  it("reuses compatible scene scratch across steady seven-target frames", () => {
    const { scene, provider } = fixture();
    vi.stubGlobal("devicePixelRatio", 1.5);
    runtime.compositionPixelRatio = null;
    runtime.previewDisplayScale = 0.18228718638420105;
    runtime.previewViewport = {
      x: 7537.74528070038,
      y: 2931.9059241963923,
      width: 5617.509309506716,
      height: 5354.189027483281,
    };
    scene.canvas.width = 1537;
    scene.canvas.height = 1465;
    scene.canvas.style.visibility = "visible";
    scene.committedSourceEpoch = provider.sourceEpoch();
    const spare = document.createElement("canvas");
    spare.width = 1537;
    spare.height = 1465;
    Object.assign(scene, {
      presentationPair: {
        surfaces: () => [{ canvas: scene.canvas }, { canvas: spare }],
      },
    });
    const retained = {};
    scene.surface.resourceTextures.set("scene", retained);
    scene.surface.sourceTextures.set("same-scene", { texture: retained });
    runtime.textureBytes.set(retained, 1537 * 1465 * 8);
    const scratch = {};
    scene.surface.isolationTextures.set("css-intermediate:source", {
      texture: scratch,
      width: 1537,
      height: 1465,
    });
    runtime.textureBytes.set(scratch, 1537 * 1465 * 8);
    const targets = [
      [715, 475],
      [360, 300],
      ...Array.from({ length: 5 }, () => [270, 270]),
    ].map(([width, height], index) => {
      const target = document.createElement("div");
      Object.defineProperties(target, {
        offsetWidth: { value: width },
        offsetHeight: { value: height },
        getBoundingClientRect: {
          value: () => new DOMRect(index * 300, 0, width, height),
        },
      });
      document.body.append(target);
      return target;
    });
    runtime.mounts = new Map(
      targets.map((target, index) => [
        String(index),
        {
          target,
          pixelRatio: 1.5,
          instance: {
            id: String(index),
            nodeId: String(index),
            placement: index === 1 ? "backdrop" : "fill",
          },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition:
            index === 0
              ? GLOWING_WAVES_EFFECT
              : index === 1
                ? LIQUID_GLASS_EFFECT
                : CATALOG_GENERATOR_CANDIDATES.find(
                    (definition) =>
                      definition.id === "an-native-gradient-field",
                  )!,
        },
      ]),
    );
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    for (let frame = 0; frame < 4; frame++) {
      expect(() => runtime.planPreviewTargetDensities()).not.toThrow();
      expect(
        scene.surface.isolationTextures.get("css-intermediate:source")?.texture,
      ).toBe(scratch);
      expect(scene.surface.resourceTextures.get("scene")).toBe(retained);
      expect(scene.canvas.style.visibility).toBe("visible");
    }
    expect([...runtime.previewTargetDensities.values()]).toEqual(
      Array(7).fill(1.5 * runtime.previewDisplayScale),
    );
  });

  it("keeps layer effect budgets available before the first backdrop scene commits", () => {
    fixture();
    vi.stubGlobal("devicePixelRatio", 2);
    runtime.compositionPixelRatio = null;
    vi.spyOn(sourceProvider, "nativeTargetOverflowInsets").mockReturnValue({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    const target = document.createElement("div");
    Object.defineProperties(target, {
      offsetWidth: { value: 193 },
      offsetHeight: { value: 198 },
      getBoundingClientRect: {
        value: () => ({
          left: 0,
          top: 0,
          right: 193,
          bottom: 198,
          width: 193,
          height: 198,
        }),
      },
    });
    document.body.append(target);

    const backdropTarget = document.createElement("div");
    Object.defineProperties(backdropTarget, {
      offsetWidth: { value: 1128 },
      offsetHeight: { value: 318 },
      getBoundingClientRect: {
        value: () => ({
          left: 0,
          top: 0,
          right: 1128,
          bottom: 318,
          width: 1128,
          height: 318,
        }),
      },
    });
    document.body.append(backdropTarget);
    runtime.mounts = new Map([
      [
        "layer",
        {
          target,
          pixelRatio: 1,
          instance: { id: "layer", nodeId: "layer", placement: "layer" },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: { resources: [] },
        },
      ],
      [
        "backdrop",
        {
          target: backdropTarget,
          pixelRatio: 1,
          instance: {
            id: "backdrop",
            nodeId: "backdrop",
            placement: "backdrop",
          },
          captureInsets: { top: 0, right: 0, bottom: 0, left: 0 },
          definition: { resources: [] },
        },
      ],
    ]);

    expect(() => runtime.planPreviewTargetDensities()).not.toThrow();
    expect(runtime.previewTargetDensities.has(target)).toBe(true);
    expect(runtime.previewTargetDensities.get(backdropTarget)).toBeGreaterThan(
      0,
    );
    expect(runtime.previewBudgetDensities.has("backdrop")).toBe(true);
  });

  it("publishes only the visible zoomed viewport and retains its outgoing pixels until the replacement succeeds", async () => {
    const { scene, provider } = fixture();
    await runtime.presentScene();
    const previous = scene.canvas;
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = {
      x: 850.125,
      y: 400.25,
      width: 190.5,
      height: 130.25,
    };
    vi.spyOn(runtime, "previewStatus").mockReturnValue({
      requestedQuality: "auto",
      frameRateTarget: 60,
      devicePixelRatio: 1.6,
      effectivePixelRatio: 6.4,
      targetFrameIntervalMs: 1000 / 60,
    });
    (
      runtime.device as { popErrorScope: ReturnType<typeof vi.fn> }
    ).popErrorScope.mockResolvedValueOnce({
      message: "resize-validation-failed",
    });
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "gpu-validation",
    });
    expect(previous.isConnected).toBe(true);
    expect(previous.style.visibility).toBe("visible");
    expect(scene.surface.width).toBe(1044);
    expect(runtime.releaseScenePresentation).not.toHaveBeenCalled();
    await runtime.presentScene();
    expect(provider.setDensity).toHaveBeenLastCalledWith(6.4);
    expect(scene.canvas).not.toBe(previous);
    expect(scene.canvas.width).toBe(1220);
    expect(scene.canvas.height).toBe(835);
    expect(scene.canvas.style.left).toBe("850px");
    expect(scene.canvas.style.top).toBe("400.15625px");
    expect(scene.surface).toMatchObject({
      pixelRatio: 6.4,
      viewport: { x: 850, y: 400.15625, width: 190.625, height: 130.46875 },
    });
  });

  it("does not publish a crop after the host moves during asynchronous composition", async () => {
    const { scene, submit } = fixture();
    await runtime.presentScene();
    submit.mockClear();
    runtime.compositionPixelRatio = null;
    runtime.previewViewport = { x: 850, y: 400, width: 190, height: 130 };
    runtime.composeScene.mockImplementation(async () => {
      runtime.previewHostGeneration += 1;
      return {};
    });
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "scene-generation-changed",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(scene.canvas.style.visibility).toBe("visible");
  });

  it("does not recapture a committed full-root worker scene for camera translation", () => {
    fixture();
    const internals = runtime as unknown as {
      workerScene: unknown;
      onPreviewHostChange(): void;
      refreshPreviewViewport(): boolean;
      desiredScenePreviewPixelRatio(): number;
      issue(code: string, message: string): void;
    };
    const previousWorkerScene = internals.workerScene;
    const requestUpdate = vi.fn();
    const setVisible = vi.fn();
    const retainsPreviewViewport = vi.fn().mockReturnValue(true);
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
    const density = vi
      .spyOn(internals, "desiredScenePreviewPixelRatio")
      .mockReturnValue(1);
    const refresh = vi
      .spyOn(internals, "refreshPreviewViewport")
      .mockReturnValue(true);
    const issue = vi.spyOn(internals, "issue");
    internals.workerScene = {
      requestUpdate,
      setVisible,
      retainsPreviewViewport,
    };
    try {
      runtime.previewViewport = { x: 80, y: 60, width: 300, height: 250 };
      internals.onPreviewHostChange();
      internals.onPreviewHostChange();
      expect(callbacks).toHaveLength(1);
      callbacks.shift()?.(0);
      expect(requestUpdate).not.toHaveBeenCalled();
      expect(retainsPreviewViewport).toHaveBeenCalledWith(
        runtime.previewViewport,
        1,
      );
      expect(setVisible).toHaveBeenCalledWith(true);

      retainsPreviewViewport.mockReturnValue(false);
      density.mockReturnValue(2);
      internals.onPreviewHostChange();
      callbacks.shift()?.(0);
      expect(requestUpdate).toHaveBeenCalledOnce();

      requestUpdate.mockClear();
      density.mockReturnValue(1);
      runtime.previewViewport = { x: 900, y: 60, width: 200, height: 250 };
      internals.onPreviewHostChange();
      callbacks.shift()?.(0);
      expect(requestUpdate).toHaveBeenCalledOnce();

      requestUpdate.mockClear();
      refresh.mockReturnValue(false);
      internals.onPreviewHostChange();
      callbacks.shift()?.(0);
      expect(setVisible).toHaveBeenLastCalledWith(false);
      expect(requestUpdate).not.toHaveBeenCalled();

      const failure = new sourceProvider.NativeSourceError(
        "preview-transform-unsupported",
        "The preview frame has an unsupported transform.",
      );
      refresh.mockImplementation(() => {
        throw failure;
      });
      internals.onPreviewHostChange();
      callbacks.shift()?.(0);
      expect(issue).toHaveBeenCalledWith(failure.code, failure.message);
      expect(requestUpdate).toHaveBeenCalledOnce();
    } finally {
      internals.workerScene = previousWorkerScene;
      raf.mockRestore();
    }
  });

  it("accepts projected PNG identity while checking the full committed worker payload", async () => {
    const { mount, options } = await committedCaptureFixture();
    const priorWorkerScene = (runtime as unknown as { workerScene: unknown })
      .workerScene;
    const priorWorkerEntries = (
      runtime as unknown as { workerEntries: unknown }
    ).workerEntries;
    const fullInstance = mount.instance;
    const projected = {
      id: fullInstance.id as string,
      nodeId: fullInstance.nodeId as string,
      definitionId: fullInstance.definitionId as string,
      definitionVersion: fullInstance.definitionVersion as number,
      placement: "layer" as const,
    };
    options.expectedInstances = [projected];
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) },
    });
    const exported = {
      previewGeneration: 7,
      width: 1044,
      height: 1042,
      rgba: new ArrayBuffer(1044 * 1042 * 4),
      timeSeconds: 0,
      committedInstances: [
        {
          instanceId: projected.id,
          definitionHash: "hash",
          payload: JSON.stringify(fullInstance),
          localTime: 0,
        },
      ],
    };
    const workerScene = {
      committedScene: vi.fn(() => ({ scene: { generation: 7 } })),
      captureExportScene: vi.fn(async () => exported),
    };
    Object.assign(runtime, {
      workerScene,
      workerEntries: [
        {
          instance: fullInstance,
          definition: mount.definition,
          definitionHash: "hash",
        },
      ],
    });
    try {
      const pixels = await runtime.captureCommittedCompositionPixels(options);
      expect(pixels).toMatchObject({ width: 1044, height: 1042 });
      expect(workerScene.captureExportScene).toHaveBeenCalledOnce();
      exported.committedInstances[0]!.payload = JSON.stringify({
        ...fullInstance,
        params: { amount: 0.7 },
      });
      await expect(
        runtime.captureCommittedCompositionPixels(options),
      ).rejects.toMatchObject({
        code: "composition-instance-stale",
      });
    } finally {
      Object.assign(runtime, {
        workerScene: priorWorkerScene,
        workerEntries: priorWorkerEntries,
      });
    }
  });

  it("reconstructs a full committed PNG instead of stretching the cropped preview texture", async () => {
    const { scene, options } = await committedCaptureFixture();
    Object.assign(scene.surface, {
      viewport: { x: 850, y: 400, width: 190, height: 130 },
    });
    vi.spyOn(effectTrust, "hashEffectDefinition").mockResolvedValue("hash");
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn(async () => new ArrayBuffer(32)) },
    });
    const read = vi.spyOn(runtime, "readCompositionPixels").mockResolvedValue({
      width: 1044,
      height: 1042,
      rgba: new Uint8Array(4),
      colorSpace: "srgb",
      alpha: "straight",
    });
    await runtime.captureCommittedCompositionPixels(options);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 1044, height: 1042 },
        pixelRatio: 1,
      }),
      expect.anything(),
      undefined,
    );
    expect(scene.surface.resourceTextures.has("source")).toBe(true);
  });

  it("rerenders a selected region at requested density and pinned live time without publishing a full-board scene", async () => {
    const { options, mount } = await committedCaptureFixture();
    vi.stubGlobal("innerWidth", 8192);
    vi.stubGlobal("innerHeight", 8192);
    options.viewport = { width: 8192, height: 8192 };
    options.pixelRatio = 2;
    const cropRect = { x: 4064, y: 3283, width: 1510, height: 270 };
    vi.spyOn(effectTrust, "hashEffectDefinition").mockResolvedValue("hash");
    vi.spyOn(runtime, "suspendForComposition").mockReturnValue({ time: 12.5 });
    const render = vi
      .spyOn(runtime, "renderInternal")
      .mockImplementation(async (time, deterministic) => {
        expect(time).toBe(12.5);
        expect(deterministic).toBe(false);
        expect(runtime.compositionPixelRatio).toBe(2);
        expect(runtime.compositionOutputRegion).toEqual(cropRect);
        expect(
          document.documentElement.hasAttribute("data-an-native-region-export"),
        ).toBe(true);
        Object.assign(mount, {
          frameCount: 1,
          pixelRatio: 2,
          committedDefinitionHash: "hash",
        });
        return { failures: [] };
      });
    const read = vi.spyOn(runtime, "readCompositionPixels").mockResolvedValue({
      width: 3020,
      height: 540,
      rgba: new Uint8Array(4),
      colorSpace: "srgb",
      alpha: "straight",
    });
    const pixels = await runtime.captureCommittedCompositionPixels({
      ...options,
      cropRect,
    });
    expect(render).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        cropRect,
        viewport: { width: 8192, height: 8192 },
        pixelRatio: 2,
      }),
      expect.anything(),
    );
    expect(pixels).toMatchObject({
      width: 3020,
      height: 540,
      cropRect,
      viewport: options.viewport,
      pixelRatio: 2,
      timeSeconds: 12.5,
    });
    expect(runtime.compositionPixelRatio).toBe(1);
    expect(runtime.compositionOutputRegion).toBeNull();
    expect(
      document.documentElement.hasAttribute("data-an-native-region-export"),
    ).toBe(false);
  });

  it("does not require an unrelated never-drawn culled mount to have a committed preview", async () => {
    const { options, mount, savedInstance } = await committedCaptureFixture();
    vi.spyOn(effectTrust, "hashEffectDefinition").mockResolvedValue("hash");
    const target = document.createElement("div");
    target.getBoundingClientRect = () => new DOMRect(9000, 9000, 100, 80);
    document.body.append(target);
    const offscreen = {
      ...mount,
      target,
      instance: {
        ...savedInstance,
        id: "offscreen",
        nodeId: "offscreen-target",
      },
      frameCount: 0,
      outputTexture: null,
      committedInstancePayload: null,
      committedDefinitionHash: null,
      committedLocalTime: null,
      committedSourceEpoch: null,
      suppressed: false,
    };
    runtime.mounts.set("offscreen", offscreen);
    options.expectedInstances.push(offscreen.instance);
    vi.spyOn(runtime, "parse").mockReturnValue([
      {
        definitions: [mount.definition],
        instances: [savedInstance, offscreen.instance],
      },
    ]);
    vi.spyOn(runtime, "renderInternal").mockImplementation(async () => {
      Object.assign(mount, {
        frameCount: 1,
        pixelRatio: 2,
        committedDefinitionHash: "hash",
      });
      return { failures: [] };
    });
    vi.spyOn(runtime, "readCompositionPixels").mockResolvedValue({
      width: 200,
      height: 160,
      rgba: new Uint8Array(4),
      colorSpace: "srgb",
      alpha: "straight",
    });
    await expect(
      runtime.captureCommittedCompositionPixels({
        ...options,
        pixelRatio: 2,
        cropRect: { x: 0, y: 0, width: 100, height: 80 },
      }),
    ).resolves.toMatchObject({ width: 200, height: 160 });
    expect(offscreen.outputTexture).toBeNull();
    expect(offscreen.committedInstancePayload).toBeNull();
  });

  it("rejects an authored-source change during asynchronous region readback", async () => {
    const { options, mount, provider } = await committedCaptureFixture();
    vi.spyOn(effectTrust, "hashEffectDefinition").mockResolvedValue("hash");
    vi.spyOn(runtime, "renderInternal").mockImplementation(async () => {
      Object.assign(mount, {
        frameCount: 1,
        pixelRatio: 2,
        committedDefinitionHash: "hash",
      });
      return { failures: [] };
    });
    vi.spyOn(runtime, "readCompositionPixels").mockImplementation(async () => {
      vi.spyOn(provider, "authoredSourceEpoch").mockReturnValue(8);
      return {
        width: 200,
        height: 160,
        rgba: new Uint8Array(4),
        colorSpace: "srgb",
        alpha: "straight",
      };
    });
    await expect(
      runtime.captureCommittedCompositionPixels({
        ...options,
        pixelRatio: 2,
        cropRect: { x: 0, y: 0, width: 100, height: 80 },
      }),
    ).rejects.toMatchObject({ code: "composition-source-unavailable" });
    expect(runtime.compositionOutputRegion).toBeNull();
  });

  it("restores preview density and clock ownership after a region render fails", async () => {
    const { options } = await committedCaptureFixture();
    vi.spyOn(effectTrust, "hashEffectDefinition").mockResolvedValue("hash");
    vi.spyOn(runtime, "renderInternal").mockRejectedValue(
      new Error("region-render-failure"),
    );
    await expect(
      runtime.captureCommittedCompositionPixels({
        ...options,
        cropRect: { x: -32, y: 20, width: 100, height: 80 },
        pixelRatio: 2,
      }),
    ).rejects.toThrow("region-render-failure");
    expect(
      document.documentElement.hasAttribute("data-an-native-region-export"),
    ).toBe(false);
    expect(runtime.compositionPixelRatio).toBe(1);
    expect(runtime.compositionOutputRegion).toBeNull();
    expect(runtime.restoreFromComposition).toHaveBeenCalledOnce();
  });

  it("retains the complete visible scene and texture across a GPU failure while rejecting edited parameters for capture", async () => {
    const { scene, provider, changeSource, frame } = fixture();
    await runtime.presentScene();
    const visible = scene.canvas;
    const committedTexture = scene.surface.resourceTextures.get("source");
    const fill = runtime.mounts.get("fill") as {
      instance: Record<string, unknown>;
      committedInstancePayload: string;
    };
    runtime.assertCurrentSceneCommit(scene);
    fill.instance.params = { amount: 0.5 };
    fill.committedInstancePayload = JSON.stringify(fill.instance);
    (
      runtime.device as { popErrorScope: ReturnType<typeof vi.fn> }
    ).popErrorScope.mockResolvedValueOnce({
      message: "validation-test-failure",
    });
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "gpu-validation",
    });
    expect(scene.canvas).toBe(visible);
    expect(visible.isConnected).toBe(true);
    expect(visible.style.visibility).toBe("visible");
    expect(scene.surface.resourceTextures.get("source")).toBe(committedTexture);
    expect(runtime.releaseScenePresentation).not.toHaveBeenCalled();
    expect(() => runtime.assertCurrentSceneCommit(scene)).toThrow(
      expect.objectContaining({ code: "composition-preview-stale" }),
    );
    provider.readScene.mockRejectedValueOnce(new Error("source-test-failure"));
    await expect(runtime.presentScene()).rejects.toThrow("source-test-failure");
    expect(scene.canvas).toBe(visible);
    expect(runtime.releaseScenePresentation).not.toHaveBeenCalled();
    expect(frame.hasAttribute("data-an-native-scene-suppressed")).toBe(true);
    changeSource();
    expect(() => runtime.assertCurrentSceneCommit(scene)).toThrow(
      expect.objectContaining({ code: "composition-preview-stale" }),
    );
    await runtime.presentScene();
    expect(scene.canvas).not.toBe(visible);
    runtime.assertCurrentSceneCommit(scene);
  });

  it("identifies a saved parameter mismatch without confusing it with the instance identity guard", async () => {
    const { savedInstance, options } = await committedCaptureFixture();
    savedInstance.params = { amount: 0.75 };
    await expect(
      runtime.captureCommittedCompositionPixels(options),
    ).rejects.toMatchObject({
      code: "composition-preview-stale",
      message: expect.stringContaining("saved-payload-changed"),
    });
  });

  it("identifies an unsuppressed Layer even when its DOM status still says ready", async () => {
    const { mount, options } = await committedCaptureFixture();
    mount.suppressed = false;
    await expect(
      runtime.captureCommittedCompositionPixels(options),
    ).rejects.toMatchObject({
      code: "composition-preview-stale",
      message: expect.stringContaining("presentation-not-suppressed"),
    });
  });

  it("identifies a committed definition hash mismatch for an otherwise current Layer", async () => {
    const { options } = await committedCaptureFixture();
    options.expectedDefinitions[0]!.executionHash = "changed-hash";
    await expect(
      runtime.captureCommittedCompositionPixels(options),
    ).rejects.toMatchObject({
      code: "composition-preview-stale",
      message: expect.stringContaining("definition-hash-changed"),
    });
  });

  it("continues to reject an actually scrolled document", async () => {
    const { submit } = fixture();
    vi.stubGlobal("scrollX", 24);
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "scene-scroll-unsupported",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses to publish overflow content when the source changes during composition", async () => {
    const { submit, changeSource } = fixture();
    runtime.composeScene.mockImplementation(async () => {
      changeSource();
      return {};
    });
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "scene-generation-changed",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(runtime.releaseScenePresentation).toHaveBeenCalledOnce();
  });

  it("refuses a viewport resize during composition", async () => {
    const { submit } = fixture();
    runtime.composeScene.mockImplementation(async () => {
      vi.stubGlobal("innerWidth", 1100);
      return {};
    });
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "scene-generation-changed",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("retains the bounded scene dimension limit", async () => {
    const { submit } = fixture();
    vi.stubGlobal("innerWidth", 4097);
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "scene-presentation-limit",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("represents a nested Layer flattened through a Fill into its parent Layer", async () => {
    const { submit, scene } = nestedLayerFixture();
    await runtime.presentScene();
    expect(submit).toHaveBeenCalledOnce();
    expect(scene.canvas.style.visibility).toBe("visible");
  });

  it("preserves contained native sources through the next Layer in the same-target chain", async () => {
    const { submit, parentLayer, provider, frame } = nestedLayerFixture();
    const nextCanvas = document.createElement("canvas");
    frame.after(nextCanvas);
    runtime.mounts.set("next-layer", {
      ...parentLayer,
      instance: { id: "next-layer", nodeId: "frame", placement: "layer" },
      canvas: nextCanvas,
      outputTexture: {},
      previousLayerId: "parent-layer",
      layerCommittedNativeSources: new Set(),
    });
    parentLayer.isTopLayer = false;
    provider.readScene.mockResolvedValue([
      { node: frame, nativeInstanceId: "next-layer" },
    ]);
    await runtime.presentScene();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not claim an unrelated visible Layer through another target's committed sources", async () => {
    const { submit, childLayer } = nestedLayerFixture();
    document.body.append(childLayer.target as Node);
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "composition-native-record-missing",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses an omitted visible fill surface", async () => {
    const { submit, provider } = fixture();
    provider.readScene.mockResolvedValue([]);
    await expect(runtime.presentScene()).rejects.toMatchObject({
      code: "composition-native-record-missing",
    });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("committed capture mutation ownership", () => {
  it("ignores editor chrome and retired presentation canvas style records after a pair swap", async () => {
    const { frame } = fixture();
    const first = document.createElement("canvas");
    first.setAttribute("data-an-native-presentation", "");
    frame.append(first);
    const pair = new NativePresentationPair(
      { canvas: first, context: {} },
      (front) => ({
        canvas: front.canvas.cloneNode(false) as HTMLCanvasElement,
        context: {},
      }),
      () => {},
    );
    const controller = new AbortController();
    runtime.compositionAbort = controller;
    let deliveries = 0;
    const observer = new MutationObserver((records) => {
      deliveries += 1;
      runtime.onAuthoredStyleMutations(records);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      subtree: true,
    });
    try {
      first.style.opacity = "0.5";
      pair.publish(pair.visible(), pair.prepare());
      const chrome = document.createElement("div");
      chrome.setAttribute("data-agent-native-editor-chrome-host", "");
      document.body.append(chrome);
      chrome.style.visibility = "hidden";
      await vi.waitFor(() => expect(deliveries).toBeGreaterThan(0));
      expect(first.isConnected).toBe(false);
      expect(controller.signal.aborted).toBe(false);
    } finally {
      observer.disconnect();
      pair.dispose();
    }
  });

  it("aborts a single mixed authored and runtime canvas mutation with a typed source failure", () => {
    fixture();
    const controller = new AbortController();
    runtime.compositionAbort = controller;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-an-native-presentation", "");
    const authored = document.createElement("div");
    document.body.append(canvas, authored);
    runtime.onAuthoredStyleMutations([
      {
        type: "childList",
        target: document.body,
        addedNodes: [canvas, authored],
        removedNodes: [],
      } as unknown as MutationRecord,
    ]);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toMatchObject({
      code: "composition-source-changed",
    });
  });

  it("continues to abort authored style edits during capture", async () => {
    const { frame } = fixture();
    const controller = new AbortController();
    runtime.compositionAbort = controller;
    const observer = new MutationObserver((records) =>
      runtime.onAuthoredStyleMutations(records),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
      subtree: true,
    });
    try {
      frame.style.opacity = "0.5";
      await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
      expect(controller.signal.reason).toMatchObject({
        code: "composition-source-changed",
      });
    } finally {
      observer.disconnect();
    }
  });
});

describe("stateless frame queue submission", () => {
  function submissionFixture() {
    fixture();
    const events: string[] = [];
    let validate!: (error: { message: string } | null) => void;
    const validation = new Promise<{ message: string } | null>((resolve) => {
      validate = resolve;
    });
    const device = runtime.device as {
      pushErrorScope: ReturnType<typeof vi.fn>;
      popErrorScope: ReturnType<typeof vi.fn>;
      queue: { submit: ReturnType<typeof vi.fn> };
    };
    device.popErrorScope.mockReturnValue(validation);
    device.queue.submit.mockImplementation(() => {
      events.push("submit");
    });
    let resolveSubmission!: () => void;
    let rejectSubmission!: (error: unknown) => void;
    const submission = new Promise<void>((resolve, reject) => {
      resolveSubmission = resolve;
      rejectSubmission = reject;
    });
    const submissionOutcome = submission.then(
      () => ({ status: "fulfilled" as const }),
      (reason) => ({ status: "rejected" as const, reason }),
    );
    const transaction = new NativeStatelessFrameTransaction<unknown>();
    const frame = {
      transaction,
      candidates: new Map(),
      jobs: new Map(),
      publishing: false,
      statuses: [],
      commands: [{ first: true }, { second: true }],
      markQueued: [() => events.push("queued0"), () => events.push("queued1")],
      afterSubmit: [
        () => events.push("profile0"),
        () => events.push("profile1"),
      ],
      submission,
      submissionOutcome,
      resolveSubmission,
      rejectSubmission,
      validationScope: { device, epoch: runtime.deviceEpoch, open: true },
    };
    (device.pushErrorScope as (filter: string) => void)("validation");
    const submit = () =>
      (
        runtime as unknown as {
          submitStatelessFrame(frame: unknown): Promise<void>;
        }
      ).submitStatelessFrame(frame);
    const drain = async () =>
      Promise.all(
        [...frame.jobs.values()].map(
          (job: { outcome: Promise<unknown> }) => job.outcome,
        ),
      );
    return { device, frame, transaction, events, validate, submit, drain };
  }

  it("submits ordered buffers once and waits for queue validation before publication", async () => {
    const { device, frame, transaction, events, validate, submit, drain } =
      submissionFixture();
    transaction.register("mount");
    const published = vi.fn();
    const participant = (async () => {
      await frame.submission;
      await transaction.prepare("mount", {
        assert() {},
        commit: published,
        rollback() {},
        retire() {},
      });
    })();
    await submit();
    expect(device.queue.submit).toHaveBeenCalledExactlyOnceWith(frame.commands);
    expect(events).toEqual([
      "submit",
      "queued0",
      "queued1",
      "profile0",
      "profile1",
    ]);
    const finishing = transaction.finish();
    await Promise.resolve();
    expect(published).not.toHaveBeenCalled();
    validate(null);
    await finishing;
    await participant;
    await drain();
    expect(published).toHaveBeenCalledOnce();
  });

  it("retains previous output and unblocks every participant when submit validation fails", async () => {
    const { frame, transaction, validate, submit, drain } = submissionFixture();
    transaction.register("mount");
    const published = vi.fn();
    const participant = frame.submission.then(
      () =>
        transaction.prepare("mount", {
          assert() {},
          commit: published,
          rollback() {},
          retire() {},
        }),
      (error) => {
        transaction.fail("mount", error);
      },
    );
    await submit();
    const finishing = transaction.finish();
    validate({ message: "invalid queue command" });
    await expect(finishing).rejects.toMatchObject({ code: "gpu-validation" });
    await participant;
    await drain();
    expect(published).not.toHaveBeenCalled();
    expect((await frame.submissionOutcome).status).toBe("rejected");
  });

  it("marks every queued owner before a profiler failure and closes its scope once", async () => {
    const { device, frame, transaction, events, validate, submit, drain } =
      submissionFixture();
    frame.afterSubmit = [
      () => {
        throw new Error("profiling failed");
      },
    ];
    await expect(submit()).rejects.toThrow("profiling failed");
    expect(events).toEqual(["submit", "queued0", "queued1"]);
    expect(device.popErrorScope).toHaveBeenCalledOnce();
    validate(null);
    await expect(transaction.finish()).rejects.toThrow("profiling failed");
    await drain();
    expect((await frame.submissionOutcome).status).toBe("rejected");
  });
});
