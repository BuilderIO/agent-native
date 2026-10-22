// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CATALOG_EDGE,
  catalogShader,
} from "../../../../shared/native-effect-catalog-kit";
import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "../../../../shared/native-effect-presets";
import {
  validateEffectDocument,
  type EffectDefinition,
  type EffectDocument,
  type EffectInstance,
} from "../../../../shared/native-effects";
import {
  NativeSourceCapabilityError,
  NativeSourceError,
} from "./native-source-provider";
import {
  NativeWorkerSceneHost,
  NativeWorkerSceneSourceError,
  type NativeWorkerSceneEntry,
} from "./native-worker-scene-host";
import { NativeWorkerSourceSnapshot } from "./native-worker-source-snapshot";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const plainStyle: Partial<CSSStyleDeclaration> = {
  backgroundImage: "none",
  backgroundColor: "rgb(255, 255, 255)",
  transform: "none",
  transformOrigin: "0px 0px",
  translate: "none",
  rotate: "none",
  scale: "none",
  opacity: "1",
  zIndex: "auto",
  perspective: "none",
  transformStyle: "flat",
  overflow: "visible",
  overflowX: "visible",
  overflowY: "visible",
  borderTopLeftRadius: "0px",
  borderTopRightRadius: "0px",
  borderBottomRightRadius: "0px",
  borderBottomLeftRadius: "0px",
  boxShadow: "none",
  outlineStyle: "none",
  outlineWidth: "0px",
  outlineOffset: "0px",
  getPropertyValue: (property: string) => {
    if (property === "overflow-clip-margin") return "0px";
    if (property.startsWith("overflow")) return "visible";
    if (property === "box-shadow" || property === "filter") return "none";
    return "0px";
  },
};

function effectInstance(
  definition: EffectDefinition,
  id: string,
  placement: EffectInstance["placement"],
): EffectInstance {
  return {
    id,
    nodeId: `node-${id}`,
    definitionId: definition.id,
    definitionVersion: definition.version,
    placement,
    params: {},
    enabled: true,
    opacity: 1,
    seed: 1,
    clip: "bounds",
    blend: "normal",
    timing: { speed: 1, paused: false, time: 0 },
  };
}

function validatedDocument(
  definition: EffectDefinition,
  placement: EffectInstance["placement"],
  id: string,
): EffectDocument {
  const result = validateEffectDocument({
    schemaVersion: 2,
    definitions: [definition],
    instances: [effectInstance(definition, id, placement)],
  });
  if (!result.valid || !result.document)
    throw new Error(
      `${definition.id} was invalid: ${result.errors.join("; ")}`,
    );
  return result.document;
}

async function captureRootCapabilityFailure(
  definitions: readonly {
    definition: EffectDefinition;
    instance: EffectInstance;
  }[],
  targetCapabilityFailure?: NativeSourceCapabilityError,
  rootFailure?: Error,
): Promise<{
  error: NativeWorkerSceneSourceError;
  rootReads: ReturnType<typeof vi.fn>;
  targetReads: ReturnType<typeof vi.fn>;
  receiverReads: ReturnType<typeof vi.fn>;
}> {
  const capability =
    rootFailure instanceof NativeSourceCapabilityError
      ? rootFailure
      : new NativeSourceCapabilityError(
          "source-webfont-style",
          "The full root text scene needs browser-shaped glyph capture.",
        );
  const rootReads = vi.fn(async (_target?: unknown, scope?: string) => {
    if (scope === "scene-presentation") throw rootFailure ?? capability;
    return [];
  });
  const targetReads = vi.fn(async () => {
    if (targetCapabilityFailure) throw targetCapabilityFailure;
    return [];
  });
  const receiverReads = vi.fn(async () => ({
    source: document.createElement("canvas"),
    cssBox: { width: 100, height: 80 },
    width: 100,
    height: 80,
    revision: 1,
    geometryKind: "box" as const,
  }));
  const rootProvider = {
    setDensity: vi.fn(),
    readScene: rootReads,
    sourceEpoch: () => 1,
    authoredSourceEpoch: () => 1,
    needsContinuousFrames: () => false,
    replaySafety: async () => "static" as const,
  };
  const target = document.createElement("div");
  target.getBoundingClientRect = () => new DOMRect(0, 0, 100, 80);
  const entries: NativeWorkerSceneEntry[] = definitions.map(
    ({ definition, instance }, index) => {
      const entryTarget = index === 0 ? target : document.createElement("div");
      entryTarget.getBoundingClientRect = () => new DOMRect(0, 0, 100, 80);
      return {
        definition,
        definitionHash: `${definition.id}:${definition.version}`,
        instance,
        target: entryTarget,
      };
    },
  );
  const targetProvider = {
    setDensity: vi.fn(),
    readScene: targetReads,
    readReceiverCoverage: receiverReads,
    sourceEpoch: () => 1,
    authoredSourceEpoch: () => 1,
    needsContinuousFrames: () => false,
    replaySafety: async () => "static" as const,
  };
  const host = Object.create(
    NativeWorkerSceneHost.prototype,
  ) as NativeWorkerSceneHost;
  Object.assign(host, {
    disposed: false,
    generation: 0,
    entries,
    assetRevisions: new Map(),
    canvas: document.createElement("canvas"),
    worker: { sceneId: "root-capability-test" },
    provider: rootProvider,
    targets: new Map(
      entries.map((entry) => [
        entry.instance.id,
        {
          entry,
          provider: targetProvider,
          marker: document.createElement("canvas"),
          captureScope: 1,
        },
      ]),
    ),
    sceneGeometry: () => ({
      viewport: { x: 0, y: 0, width: 300, height: 200 },
      pixelRatio: 1,
    }),
    layout: () => ({
      width: 100,
      height: 80,
      offsetLeft: 0,
      offsetTop: 0,
      transform: "none",
      transformOrigin: "0px 0px",
      translate: "none",
      rotate: "none",
      scale: "none",
    }),
    sceneCadence: () => ({ frameRateTarget: 60, compact: false }),
    clock: () => ({ playing: false, timeSeconds: 0, speed: 1 }),
    fillPhases: vi.fn().mockResolvedValue(undefined),
  });
  vi.spyOn(window, "getComputedStyle").mockReturnValue(
    plainStyle as CSSStyleDeclaration,
  );
  vi.spyOn(NativeWorkerSourceSnapshot.prototype, "receiver").mockResolvedValue({
    maskAssetId: "mask",
  });

  try {
    await (
      host as unknown as { captureSnapshot(): Promise<unknown> }
    ).captureSnapshot();
  } catch (error) {
    if (!(error instanceof NativeWorkerSceneSourceError)) throw error;
    expect(error.captureFailure).toBe(capability);
    return { error, rootReads, targetReads, receiverReads };
  }
  throw new Error("The root scene capability failure was not propagated.");
}

describe("root-scene capability fallback eligibility", () => {
  it("routes every active catalog definition after its target capture succeeds", async () => {
    const entries = NATIVE_EFFECT_LATEST_DEFINITIONS.map(
      (definition, index) => {
        const placement = definition.placements[0];
        if (!placement)
          throw new Error(`${definition.id} has no active placement`);
        const doc = validatedDocument(
          definition,
          placement,
          `catalog-${index}`,
        );
        return {
          definition: doc.definitions[0]!,
          instance: doc.instances[0]!,
        };
      },
    );

    const result = await captureRootCapabilityFailure(entries);

    expect(result.error.code).toBe("worker-scene-source-unsupported");
    expect(result.receiverReads).toHaveBeenCalledTimes(entries.length);
    expect(result.targetReads.mock.calls.length).toBe(
      entries.filter(({ instance }) => instance.placement !== "fill").length,
    );
    expect(result.rootReads).toHaveBeenLastCalledWith(
      undefined,
      "scene-presentation",
    );
  });

  it.each([
    [
      "custom generator Fill",
      catalogShader({
        id: "custom-root-fallback-generator",
        name: "Custom Root Fallback Generator",
        kind: "generator",
        properties: {},
        fragment: () => "return vec4f(1.0);",
      }),
      "fill",
    ],
    [
      "custom processor Layer",
      catalogShader({
        id: "custom-root-fallback-layer",
        name: "Custom Root Fallback Layer",
        kind: "processor",
        properties: { edge: CATALOG_EDGE },
        fragment: () => "return sampleSource(input.uv);",
      }),
      "layer",
    ],
    [
      "custom processor Backdrop",
      catalogShader({
        id: "custom-root-fallback-backdrop",
        name: "Custom Root Fallback Backdrop",
        kind: "processor",
        properties: { edge: CATALOG_EDGE },
        fragment: () => "return sampleSource(input.uv);",
        backdrop: true,
      }),
      "backdrop",
    ],
  ] as const)(
    "validates and routes a %s through capture",
    async (_label, definition, placement) => {
      const doc = validatedDocument(
        definition,
        placement,
        `custom-${placement}`,
      );
      const result = await captureRootCapabilityFailure(
        doc.instances.map((instance) => ({
          definition: doc.definitions.find(
            (candidate) =>
              candidate.id === instance.definitionId &&
              candidate.version === instance.definitionVersion,
          )!,
          instance,
        })),
      );

      expect(result.error.code).toBe("worker-scene-source-unsupported");
      expect(result.receiverReads).toHaveBeenCalledOnce();
      expect(result.rootReads).toHaveBeenLastCalledWith(
        undefined,
        "scene-presentation",
      );
    },
  );

  it("routes unsupported collapsed paint only at the optional root boundary", async () => {
    const definition = NATIVE_EFFECT_LATEST_DEFINITIONS.find((item) =>
      item.placements.includes("fill"),
    )!;
    const doc = validatedDocument(definition, "fill", "collapsed-root");
    const failure = new NativeSourceCapabilityError(
      "source-empty-own-paint-unsupported",
      "A collapsed source has unsupported visible paint.",
    );
    const entries = [
      { definition: doc.definitions[0]!, instance: doc.instances[0]! },
    ];
    const result = await captureRootCapabilityFailure(
      entries,
      undefined,
      failure,
    );
    expect(result.error.captureFailure).toBe(failure);
    const processor = NATIVE_EFFECT_LATEST_DEFINITIONS.find((item) =>
      item.placements.includes("layer"),
    )!;
    const targetDoc = validatedDocument(processor, "layer", "collapsed-target");
    await expect(
      captureRootCapabilityFailure(
        [
          {
            definition: targetDoc.definitions[0]!,
            instance: targetDoc.instances[0]!,
          },
        ],
        failure,
      ),
    ).rejects.toBe(failure);
  });

  it("does not reclassify a target-local capability failure as a root fallback", async () => {
    const targetFailure = new NativeSourceCapabilityError(
      "source-native-text-style",
      "The effect target needs unsupported glyph capture.",
    );
    const definition = catalogShader({
      id: "custom-root-fallback-target-failure",
      name: "Custom Root Fallback Target Failure",
      kind: "processor",
      properties: { edge: CATALOG_EDGE },
      fragment: () => "return sampleSource(input.uv);",
    });
    const result = validatedDocument(definition, "layer", "target-failure");

    await expect(
      captureRootCapabilityFailure(
        result.instances.map((instance) => ({
          definition: result.definitions[0]!,
          instance,
        })),
        targetFailure,
      ),
    ).rejects.toBe(targetFailure);
  });

  it.each([
    new NativeSourceError(
      "source-epoch-stale",
      "The authored source changed during capture.",
    ),
    new Error("unexpected root capture failure"),
  ])("keeps non-capability root failure typed: %s", async (rootFailure) => {
    const definition = catalogShader({
      id: "custom-root-fallback-non-capability",
      name: "Custom Root Fallback Non Capability",
      kind: "generator",
      properties: {},
      fragment: () => "return vec4f(1.0);",
    });
    const doc = validatedDocument(definition, "fill", "non-capability");

    await expect(
      captureRootCapabilityFailure(
        doc.instances.map((instance) => ({
          definition: doc.definitions[0]!,
          instance,
        })),
        undefined,
        rootFailure,
      ),
    ).rejects.toBe(rootFailure);
  });
});
