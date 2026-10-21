// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import type { NativeWorkerSourceRecord } from "./native-worker-protocol";
import {
  NativeWorkerSceneHost,
  nativeWorkerDefinitions,
  nativeWorkerOutputRecords,
  nativeWorkerOutputSceneRecords,
  type NativeWorkerSceneEntry,
} from "./native-worker-scene-host";

afterEach(() => vi.useRealTimers());

describe("native worker definition snapshots", () => {
  it("shares an identical definition across instances while retaining distinct versions", () => {
    const target = document.createElement("div");
    const first = { id: "mesh", version: 3 } as EffectDefinition;
    const duplicate = { id: "mesh", version: 3 } as EffectDefinition;
    const next = { id: "mesh", version: 4 } as EffectDefinition;
    const entry = (
      definition: EffectDefinition,
      definitionHash: string,
    ): NativeWorkerSceneEntry => ({
      definition,
      definitionHash,
      instance: {
        id: `${definition.id}-${definition.version}`,
      } as EffectInstance,
      target,
    });
    const definitions = nativeWorkerDefinitions([
      entry(first, "same-hash"),
      entry(duplicate, "same-hash"),
      entry(next, "new-hash"),
    ]);
    expect(definitions).toHaveLength(2);
    expect(definitions[0]).toBe(duplicate);
    expect(definitions[1]).toBe(next);
    expect(() =>
      nativeWorkerDefinitions([
        entry(first, "same-hash"),
        entry(duplicate, "different-hash"),
      ]),
    ).toThrow("conflicting definitions");
  });
});

function nativeRecord(
  instanceId: string,
  width: number,
  height: number,
  localBox: { x: number; y: number; width: number; height: number },
): NativeWorkerSourceRecord {
  return {
    key: 1,
    nodeId: instanceId,
    kind: "native",
    nativeInstanceId: instanceId,
    imageRendering: { value: "auto" },
    width,
    height,
    revision: 1,
    coordinateSpace: "target-local-global",
    rect: { ...localBox },
    localBox,
    localToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    clip: { ...localBox },
    clips: [],
    groupClips: [],
    isolationPath: [],
    opacity: 1,
  };
}

describe("native worker record dimensions", () => {
  it("uses current GPU output sizes when Glass captures a later Fill's stale presentation", () => {
    const wave = nativeRecord("wave-fill", 1, 1, {
      x: -32,
      y: -156,
      width: 715,
      height: 475,
    });
    const target = {
      sourceRecords: [wave],
      fillLocalSourceRecords: [wave],
      fillPhases: {
        backgroundRecords: [wave],
        borderRecords: [],
        outerCoverageRecords: [],
        innerCoverageRecords: [],
        glyphRecords: [],
        insetShadowRecords: [],
        outerShadowRecords: [],
        outlineRecords: [],
        foregroundRecords: [],
      },
    };
    const [root] = nativeWorkerOutputSceneRecords(
      [target],
      [wave],
      new Map([["wave-fill", { width: 715, height: 475 }]]),
    );
    for (const record of [
      target.sourceRecords[0],
      target.fillLocalSourceRecords[0],
      target.fillPhases.backgroundRecords[0],
      root,
    ]) {
      expect([record?.width, record?.height]).toEqual([715, 475]);
      expect(record?.rect).toEqual(wave.rect);
      expect(record?.localToTarget).toBe(wave.localToTarget);
    }
    expect([wave.width, wave.height]).toEqual([1, 1]);
  });

  it("uses export-density GPU sizes for sibling Fill and Glass while retaining paint geometry", () => {
    const wave = nativeRecord("wave-fill", 310, 206, {
      x: -32,
      y: -156,
      width: 715,
      height: 475,
    });
    const glass = nativeRecord("glass-backdrop", 157, 131, {
      x: 40,
      y: -80,
      width: 360,
      height: 300,
    });
    const records = nativeWorkerOutputRecords(
      [wave, glass],
      new Map([
        ["wave-fill", { width: 715, height: 475 }],
        ["glass-backdrop", { width: 360, height: 300 }],
      ]),
    );
    expect(records.map(({ width, height }) => [width, height])).toEqual([
      [715, 475],
      [360, 300],
    ]);
    expect(records[0]?.localBox).toBe(wave.localBox);
    expect(records[1]?.localToTarget).toBe(glass.localToTarget);
    expect(records[1]?.clip).toBe(glass.clip);
  });

  it("keeps a padded Fill's signed CSS placement while matching its presentation texture", () => {
    const paddedFill = nativeRecord("padded-fill", 100, 55, {
      x: -12,
      y: -8,
      width: 220,
      height: 120,
    });
    const [record] = nativeWorkerOutputRecords(
      [paddedFill],
      new Map([["padded-fill", { width: 220, height: 120 }]]),
    );
    expect([record?.width, record?.height]).toEqual([220, 120]);
    expect(record?.localBox).toEqual({
      x: -12,
      y: -8,
      width: 220,
      height: 120,
    });
    expect(record?.rect).toEqual(paddedFill.rect);
    expect(record?.imageRendering).toBe(paddedFill.imageRendering);
  });
});

describe("native worker camera coverage", () => {
  it("retains a committed scene only while viewport, density, source and targets still match", () => {
    vi.stubGlobal("innerWidth", 1044);
    vi.stubGlobal("innerHeight", 1042);
    const target = {
      getBoundingClientRect: vi.fn(() => ({
        x: 30,
        y: 40,
        width: 100,
        height: 80,
      })),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const marker = {
      isConnected: true,
      style: { visibility: "visible" },
      getBoundingClientRect: () => ({ x: 30, y: 40, width: 100, height: 80 }),
    };
    const entry = {
      instance: { id: "fill" },
      definitionHash: "definition-1",
      target,
    };
    const provider = {
      sourceEpoch: vi.fn().mockReturnValue(7),
      authoredSourceEpoch: vi.fn().mockReturnValue(3),
    };
    const targetProvider = {
      sourceEpoch: vi.fn().mockReturnValue(5),
      authoredSourceEpoch: vi.fn().mockReturnValue(2),
    };
    const scene = {
      generation: 4,
      viewport: { x: 0, y: 0, width: 1044, height: 1042 },
      pixelRatio: 1,
      clock: { playing: true, timeSeconds: 4, speed: 1 },
      targets: [
        { instanceId: "fill", rect: { x: 30, y: 40, width: 100, height: 80 } },
      ],
    };
    const publication = {
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      rootWidth: 1044,
      rootHeight: 1042,
      targetEpochs: new Map([["fill", { source: 5, authored: 2 }]]),
      payloads: new Map([
        [
          "fill",
          {
            payload: JSON.stringify(entry.instance),
            definitionHash: "definition-1",
          },
        ],
      ]),
    };
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    Object.assign(host, {
      visible: true,
      disposed: false,
      dirty: false,
      updating: false,
      capturingExport: false,
      preparingExport: false,
      provider,
      entries: [entry],
      targets: new Map([["fill", { entry, marker, provider: targetProvider }]]),
      clock: () => ({ playing: true, timeSeconds: 5, speed: 1 }),
      committed: publication,
      committedSceneSnapshot: scene,
      lastScene: scene,
    });
    const crop = { x: 80, y: 60, width: 300, height: 250 };
    try {
      expect(host.retainsPreviewViewport(crop, 1)).toBe(true);
      expect(
        host.retainsPreviewViewport(
          { x: 400, y: 400, width: 100, height: 100 },
          1,
        ),
      ).toBe(false);
      const targetGeometryReads =
        target.getBoundingClientRect.mock.calls.length;
      const sourceEpochReads = provider.sourceEpoch.mock.calls.length;
      const targetEpochReads = targetProvider.sourceEpoch.mock.calls.length;
      expect(
        host.retainsPreviewViewport(
          { x: 900, y: 60, width: 200, height: 250 },
          1,
        ),
      ).toBe(false);
      expect(target.getBoundingClientRect).toHaveBeenCalledTimes(
        targetGeometryReads,
      );
      expect(provider.sourceEpoch).toHaveBeenCalledTimes(sourceEpochReads);
      expect(targetProvider.sourceEpoch).toHaveBeenCalledTimes(
        targetEpochReads,
      );
      expect(host.retainsPreviewViewport(crop, 2)).toBe(false);
      target.getBoundingClientRect.mockReturnValueOnce({
        x: 31,
        y: 40,
        width: 100,
        height: 80,
      });
      expect(host.retainsPreviewViewport(crop, 1)).toBe(false);
      targetProvider.authoredSourceEpoch.mockReturnValue(4);
      expect(host.retainsPreviewViewport(crop, 1)).toBe(false);
      targetProvider.authoredSourceEpoch.mockReturnValue(2);
      provider.sourceEpoch.mockReturnValue(8);
      expect(host.retainsPreviewViewport(crop, 1)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("pauses offscreen preview ticks, keeps export time live, and catches up on reentry", () => {
    let timeSeconds = 12;
    let sampledAtEpochMs = performance.timeOrigin + performance.now();
    const marker = document.createElement("canvas");
    marker.style.visibility = "visible";
    marker.getBoundingClientRect = () =>
      ({ x: 30, y: 40, width: 100, height: 80 }) as DOMRect;
    document.body.append(marker);
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    Object.assign(host, {
      entries: [{ instance: { id: "fill" } }],
      targets: new Map([["fill", { marker }]]),
      clock: () => ({
        playing: true,
        timeSeconds,
        speed: 1,
        sampledAtEpochMs,
      }),
    });
    const sceneClock = (
      host as unknown as {
        snapshotClock(
          viewport: { x: number; y: number; width: number; height: number },
          exportCapture: boolean,
        ): {
          playing: boolean;
          timeSeconds: number;
          speed: number;
          sampledAtEpochMs?: number;
        };
      }
    ).snapshotClock.bind(host);
    const offscreen = { x: 400, y: 400, width: 100, height: 100 };
    try {
      expect(sceneClock(offscreen, false)).toEqual({
        playing: false,
        timeSeconds: 12,
        speed: 1,
        sampledAtEpochMs,
      });
      expect(sceneClock(offscreen, true)).toEqual({
        playing: true,
        timeSeconds: 12,
        speed: 1,
        sampledAtEpochMs,
      });
      timeSeconds = 18;
      sampledAtEpochMs = performance.timeOrigin + performance.now();
      expect(
        sceneClock({ x: 50, y: 50, width: 100, height: 100 }, false),
      ).toEqual({ playing: true, timeSeconds: 18, speed: 1, sampledAtEpochMs });
    } finally {
      marker.remove();
    }
  });

  it("reprojects an exposed viewport edge without recapturing unchanged authored sources", async () => {
    vi.stubGlobal("innerWidth", 1044);
    vi.stubGlobal("innerHeight", 1042);
    const target = document.createElement("div");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      x: 30,
      y: 40,
      width: 100,
      height: 80,
    } as DOMRect);
    const entry = {
      instance: { id: "fill" },
      definitionHash: "definition-1",
      target,
    };
    const scene = {
      sceneId: "scene",
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      viewport: { x: 0, y: 0, width: 300, height: 250 },
      width: 300,
      height: 250,
      pixelRatio: 1,
      requiredAssets: [{ assetId: "paint", revision: 2 }],
      targets: [
        { instanceId: "fill", rect: { x: 30, y: 40, width: 100, height: 80 } },
      ],
    };
    const publication = {
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      rootWidth: 1044,
      rootHeight: 1042,
      targetEpochs: new Map([["fill", { source: 5, authored: 2 }]]),
      rootRecords: [],
      payloads: new Map([
        [
          "fill",
          {
            payload: JSON.stringify(entry.instance),
            definitionHash: "definition-1",
          },
        ],
      ]),
    };
    const captureSnapshot = vi
      .fn()
      .mockRejectedValue(new Error("unexpected source capture"));
    const sendScene = vi.fn().mockResolvedValue(undefined);
    let density = 1;
    let sourceEpoch = 7;
    let cropWidth = 300;
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    Object.assign(host, {
      visible: true,
      disposed: false,
      capturingExport: false,
      preparingExport: false,
      provider: {
        sourceEpoch: () => sourceEpoch,
        authoredSourceEpoch: () => 3,
      },
      entries: [entry],
      targets: new Map([
        [
          "fill",
          {
            entry,
            provider: { sourceEpoch: () => 5, authoredSourceEpoch: () => 2 },
          },
        ],
      ]),
      generation: 4,
      cameraInFlightGeneration: null,
      cameraUpdatePending: false,
      cameraPublishTimer: null,
      committed: publication,
      committedSceneSnapshot: scene,
      lastScene: scene,
      assetRevisions: new Map([["paint", 2]]),
      pendingAssetRevisions: new Map(),
      staged: new Map(),
      scenes: new Map([[4, scene]]),
      canvas: document.createElement("canvas"),
      suppressed: new Set(),
      committedFrameTimes: [],
      publicationWaiters: new Set(),
      onCommitted: vi.fn(),
      worker: { sceneId: "scene", sendScene },
      clock: () => ({ playing: true, timeSeconds: 2, speed: 1 }),
      sceneGeometry: () => ({
        viewport: { x: 200, y: 40, width: cropWidth, height: 250 },
        pixelRatio: density,
      }),
      captureSnapshot,
    });
    const publish = (generation: number) =>
      (
        host as unknown as {
          publish(message: {
            generation: number;
            sourceEpoch: number;
            timeSeconds: number;
            presentedAtMs: number;
            committedInstances: readonly {
              instanceId: string;
              definitionHash: string;
              payload: string;
              localTime: number;
            }[];
          }): void;
        }
      ).publish({
        generation,
        sourceEpoch: 7,
        timeSeconds: 2,
        presentedAtMs: generation * 16,
        committedInstances: [
          {
            instanceId: "fill",
            definitionHash: "definition-1",
            payload: JSON.stringify(entry.instance),
            localTime: 2,
          },
        ],
      });
    try {
      await (
        host as unknown as { sendSnapshot(): Promise<void> }
      ).sendSnapshot();
      expect(captureSnapshot).not.toHaveBeenCalled();
      expect(sendScene).toHaveBeenCalledWith(
        expect.objectContaining({
          generation: 5,
          viewport: { x: 200, y: 40, width: 300, height: 250 },
          requiredAssets: [{ assetId: "paint", revision: 2 }],
        }),
        [],
        { retainActiveCommitsWhileStaged: true },
      );
      const committedFramesBefore = host.workerCadenceTimes().length;
      publish(4);
      expect(host.workerCadenceTimes()).toHaveLength(committedFramesBefore + 1);
      expect(host.committedScene()?.scene.generation).toBe(4);
      expect(sendScene).toHaveBeenCalledTimes(1);
      publish(5);
      cropWidth = 250;
      await (
        host as unknown as { sendSnapshot(): Promise<void> }
      ).sendSnapshot();
      publish(6);
      cropWidth = 350;
      await (
        host as unknown as { sendSnapshot(): Promise<void> }
      ).sendSnapshot();
      publish(7);
      expect(captureSnapshot).not.toHaveBeenCalled();
      expect(sendScene).toHaveBeenLastCalledWith(
        expect.objectContaining({
          generation: 7,
          viewport: { x: 200, y: 40, width: 350, height: 250 },
          width: 350,
          height: 250,
        }),
        [],
        { retainActiveCommitsWhileStaged: true },
      );
      captureSnapshot.mockResolvedValue({
        scene: { ...scene, generation: 8, pixelRatio: 2 },
        assets: [],
        revisions: new Map(),
        publication: { ...publication, generation: 8 },
      });
      density = 2;
      await (
        host as unknown as { sendSnapshot(): Promise<void> }
      ).sendSnapshot();
      expect(captureSnapshot).toHaveBeenCalledOnce();

      captureSnapshot.mockResolvedValue({
        scene: { ...scene, generation: 9, sourceEpoch: 8 },
        assets: [],
        revisions: new Map(),
        publication: { ...publication, generation: 9, sourceEpoch: 8 },
      });
      density = 1;
      sourceEpoch = 8;
      await (
        host as unknown as { sendSnapshot(): Promise<void> }
      ).sendSnapshot();
      expect(captureSnapshot).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("advances camera-only commits without repeating scene DOM or ready status writes", async () => {
    const root = document.createElement("section");
    const source = document.createElement("div");
    root.append(source);
    document.body.append(root);
    root.setAttribute("data-an-native-scene-suppressed", "");
    root.setAttribute("data-an-native-authored-opacity", "1");
    document.documentElement.setAttribute("data-an-native-scene-managed", "");
    const target = document.createElement("div");
    target.setAttribute("data-an-native-status", "ready");
    target.setAttribute("data-an-native-backend", "webgpu-worker");
    const instance = { id: "fill" } as EffectInstance;
    const payload = JSON.stringify(instance);
    const targetEpochs = new Map([["fill", { source: 5, authored: 2 }]]);
    const rootRecords = [{ node: source }];
    const payloads = new Map([
      ["fill", { payload, definitionHash: "definition-1" }],
    ]);
    const previous = {
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      rootWidth: 1000,
      rootHeight: 800,
      targetEpochs,
      rootRecords,
      payloads,
    };
    const cameraPublication = { ...previous, generation: 5 };
    const scene = {
      generation: 5,
      viewport: { x: 30, y: 40, width: 300, height: 200 },
    };
    const canvas = document.createElement("canvas");
    canvas.style.visibility = "visible";
    canvas.style.left = "30px";
    canvas.style.top = "40px";
    canvas.style.width = "300px";
    canvas.style.height = "200px";
    const sceneMarkerWrites: MutationRecord[] = [];
    const sceneMarkerObserver = new MutationObserver((records) =>
      sceneMarkerWrites.push(...records),
    );
    sceneMarkerObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-an-native-scene-managed"],
    });
    sceneMarkerObserver.observe(canvas, {
      attributes: true,
      attributeFilter: ["style"],
    });
    const matches = vi.spyOn(root, "matches");
    const setTargetAttribute = vi.spyOn(target, "setAttribute");
    const removeTargetAttribute = vi.spyOn(target, "removeAttribute");
    const resolveWaiter = vi.fn();
    const waiterTimer = setTimeout(() => undefined, 60_000);
    const onCommitted = vi.fn();
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    Object.assign(host, {
      committed: previous,
      committedSceneSnapshot: { generation: 4 },
      provider: {
        sourceEpoch: () => 7,
        authoredSourceEpoch: () => 3,
      },
      entries: [{ target }],
      suppressed: new Set([root]),
      staged: new Map([[5, cameraPublication]]),
      scenes: new Map([[5, scene]]),
      canvas,
      committedFrameTimes: [],
      cameraInFlightGeneration: 5,
      cameraUpdatePending: false,
      cameraPublishTimer: null,
      publicationWaiters: new Set([
        {
          instanceId: "fill",
          payload,
          definitionHash: "definition-1",
          minimumGeneration: 5,
          expectedTimeSeconds: null,
          resolve: resolveWaiter,
          reject: vi.fn(),
          timer: waiterTimer,
        },
      ]),
      onCommitted,
      onFailure: vi.fn(),
      requestUpdate: vi.fn(),
    });
    try {
      (
        host as unknown as {
          publish(message: {
            generation: number;
            sourceEpoch: number;
            timeSeconds: number;
            presentedAtMs: number;
            committedInstances: readonly {
              instanceId: string;
              definitionHash: string;
              payload: string;
              localTime: number;
            }[];
          }): void;
        }
      ).publish({
        generation: 5,
        sourceEpoch: 7,
        timeSeconds: 2,
        presentedAtMs: 80,
        committedInstances: [
          {
            instanceId: "fill",
            definitionHash: "definition-1",
            payload,
            localTime: 2,
          },
        ],
      });
      expect(matches).not.toHaveBeenCalled();
      expect(setTargetAttribute).not.toHaveBeenCalled();
      expect(removeTargetAttribute).not.toHaveBeenCalled();
      expect(canvas.style.left).toBe("30px");
      expect(canvas.style.top).toBe("40px");
      await Promise.resolve();
      expect(sceneMarkerWrites).toEqual([]);
      expect(host.committedScene()?.scene.generation).toBe(5);
      expect(onCommitted).toHaveBeenCalledWith(
        cameraPublication,
        expect.objectContaining({ contentChanged: false }),
      );
      expect(resolveWaiter).toHaveBeenCalledOnce();
    } finally {
      sceneMarkerObserver.disconnect();
      clearTimeout(waiterTimer);
      root.remove();
      document.documentElement.removeAttribute("data-an-native-scene-managed");
    }
  });

  it("uses the full publish path after changed provenance or a target error", () => {
    const root = document.createElement("section");
    const source = document.createElement("div");
    root.append(source);
    document.body.append(root);
    root.setAttribute("data-an-native-scene-suppressed", "");
    root.setAttribute("data-an-native-authored-opacity", "1");
    document.documentElement.setAttribute("data-an-native-scene-managed", "");
    const target = document.createElement("div");
    target.setAttribute("data-an-native-status", "error");
    target.setAttribute("data-an-native-backend", "webgpu-worker");
    target.setAttribute("data-an-native-error", "worker-failed");
    const instance = { id: "fill" } as EffectInstance;
    const previousPayload = JSON.stringify({
      ...instance,
      params: { amount: 0.5 },
    });
    const nextPayload = JSON.stringify({
      ...instance,
      params: { amount: 0.75 },
    });
    const previous = {
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      rootWidth: 1000,
      rootHeight: 800,
      targetEpochs: new Map([["fill", { source: 5, authored: 2 }]]),
      rootRecords: [{ node: source }],
      payloads: new Map([
        ["fill", { payload: previousPayload, definitionHash: "definition-1" }],
      ]),
    };
    const changed = {
      ...previous,
      generation: 5,
      rootRecords: [{ node: source }],
      payloads: new Map([
        ["fill", { payload: nextPayload, definitionHash: "definition-1" }],
      ]),
    };
    const canvas = document.createElement("canvas");
    const onCommitted = vi.fn();
    const requestUpdate = vi.fn();
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    const waiterResolve = vi.fn();
    const waiterTimer = setTimeout(() => undefined, 60_000);
    Object.assign(host, {
      committed: previous,
      committedSceneSnapshot: { generation: 4 },
      provider: {
        sourceEpoch: () => 7,
        authoredSourceEpoch: () => 3,
      },
      entries: [{ target }],
      targets: new Map(),
      suppressed: new Set([root]),
      staged: new Map([[5, changed]]),
      scenes: new Map([
        [
          5,
          { generation: 5, viewport: { x: 1, y: 2, width: 300, height: 200 } },
        ],
      ]),
      canvas,
      committedFrameTimes: [],
      cameraInFlightGeneration: null,
      cameraUpdatePending: false,
      cameraPublishTimer: null,
      publicationWaiters: new Set([
        {
          instanceId: "fill",
          payload: nextPayload,
          definitionHash: "definition-1",
          minimumGeneration: 5,
          expectedTimeSeconds: null,
          resolve: waiterResolve,
          reject: vi.fn(),
          timer: waiterTimer,
        },
      ]),
      onCommitted,
      onFailure: vi.fn(),
      requestUpdate,
    });
    const publish = (generation: number, messagePayload: string) => {
      (
        host as unknown as {
          publish(message: {
            generation: number;
            sourceEpoch: number;
            timeSeconds: number;
            presentedAtMs: number;
            committedInstances: readonly {
              instanceId: string;
              definitionHash: string;
              payload: string;
              localTime: number;
            }[];
          }): void;
        }
      ).publish({
        generation,
        sourceEpoch: 7,
        timeSeconds: 2,
        presentedAtMs: generation * 16,
        committedInstances: [
          {
            instanceId: "fill",
            definitionHash: "definition-1",
            payload: messagePayload,
            localTime: 2,
          },
        ],
      });
    };
    const matches = vi.spyOn(root, "matches");
    try {
      publish(5, "mismatched-payload");
      expect(requestUpdate).toHaveBeenCalledOnce();
      expect(host.committedScene()?.scene.generation).toBe(4);
      expect(onCommitted).not.toHaveBeenCalled();
      expect(waiterResolve).not.toHaveBeenCalled();

      publish(5, nextPayload);
      expect(matches).toHaveBeenCalledOnce();
      expect(target.getAttribute("data-an-native-status")).toBe("ready");
      expect(target.hasAttribute("data-an-native-error")).toBe(false);
      expect(host.committedScene()?.scene.generation).toBe(5);
      expect(onCommitted).toHaveBeenCalledWith(
        changed,
        expect.objectContaining({ contentChanged: true }),
      );
      expect(waiterResolve).toHaveBeenCalledOnce();
    } finally {
      clearTimeout(waiterTimer);
      root.remove();
      document.documentElement.removeAttribute("data-an-native-scene-managed");
    }
  });

  it("bounds camera submissions until the previous worker generation commits", async () => {
    const sendScene = vi.fn().mockResolvedValue(undefined);
    const captureSnapshot = vi.fn();
    const cameraSource = {
      scene: {
        viewport: { x: 0, y: 0, width: 300, height: 250 },
        width: 300,
        height: 250,
        pixelRatio: 1,
        clock: { playing: true, timeSeconds: 0, speed: 1 },
      },
      publication: {
        clockIdentity: { origin: 100, sourcePlaying: true },
      },
    };
    const currentCameraSource = vi.fn().mockReturnValue(cameraSource);
    const onFailure = vi.fn();
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    let cameraX = 0;
    Object.assign(host, {
      visible: true,
      disposed: false,
      dirty: false,
      updating: false,
      capturingExport: false,
      preparingExport: false,
      holdingLastFrame: false,
      generation: 4,
      cameraInFlightGeneration: null,
      cameraUpdatePending: false,
      cameraPublishTimer: null,
      staged: new Map(),
      scenes: new Map(),
      pendingAssetRevisions: new Map(),
      assetRevisions: new Map(),
      worker: { sendScene, setVisible: vi.fn(), dispose: vi.fn() },
      clock: () => ({ playing: true, timeSeconds: 0, speed: 1 }),
      getClockOrigin: () => 100,
      sceneGeometry: () => ({
        viewport: { x: cameraX, y: 0, width: 300, height: 250 },
        pixelRatio: 1,
      }),
      currentCameraSource,
      provider: {
        sourceEpoch: () => 7,
        authoredSourceEpoch: () => 3,
        dispose: vi.fn(),
      },
      entries: [],
      targets: new Map(),
      canvas: document.createElement("canvas"),
      suppressed: new Set(),
      committedFrameTimes: [],
      publicationWaiters: new Set(),
      onCommitted: vi.fn(),
      captureSnapshot,
      reprojectSnapshot: () => {
        if (!currentCameraSource()) return null;
        const generation = ++(host as unknown as { generation: number })
          .generation;
        return {
          scene: {
            sceneId: "scene",
            generation,
            sourceEpoch: 7,
            viewport: { x: cameraX, y: 0, width: 300, height: 250 },
            width: 300,
            height: 250,
            pixelRatio: 1,
            clock: { playing: true, timeSeconds: 0, speed: 1 },
          },
          assets: [],
          revisions: new Map(),
          publication: {
            generation,
            sourceEpoch: 7,
            authoredEpoch: 3,
            clockIdentity: { origin: 100, sourcePlaying: true },
            rootRecords: [],
            payloads: new Map(),
          },
        };
      },
      onFailure,
    });
    const sendSnapshot = (
      host as unknown as {
        sendSnapshot(): Promise<void>;
      }
    ).sendSnapshot.bind(host);
    Object.assign(host, { requestUpdate: () => void sendSnapshot() });
    vi.useFakeTimers();
    cameraX = 10;
    await sendSnapshot();
    host.setVisible(false);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(onFailure).not.toHaveBeenCalled();
    host.setVisible(true);
    for (const x of [20, 30, 40, 50]) {
      cameraX = x;
      await sendSnapshot();
    }
    expect(sendScene).toHaveBeenCalledTimes(1);
    expect(sendScene.mock.calls[0]?.[0]).toMatchObject({
      viewport: { x: 10, y: 0, width: 300, height: 250 },
    });
    (
      host as unknown as {
        publish(message: {
          generation: number;
          sourceEpoch: number;
          timeSeconds: number;
          presentedAtMs: number;
          committedInstances: readonly [];
        }): void;
      }
    ).publish({
      generation: 5,
      sourceEpoch: 7,
      timeSeconds: 0,
      presentedAtMs: 16,
      committedInstances: [],
    });
    await Promise.resolve();
    expect(sendScene).toHaveBeenCalledTimes(2);
    expect(sendScene.mock.calls[1]?.[0]).toMatchObject({
      viewport: { x: 50, y: 0, width: 300, height: 250 },
    });
    expect(captureSnapshot).not.toHaveBeenCalled();

    currentCameraSource.mockReturnValue(null);
    captureSnapshot.mockImplementation(async () => {
      (host as unknown as { generation: number }).generation = 7;
      return {
        scene: {
          sceneId: "scene",
          generation: 7,
          sourceEpoch: 8,
          viewport: { x: 50, y: 0, width: 300, height: 250 },
        },
        assets: [],
        revisions: new Map(),
        publication: {
          generation: 7,
          sourceEpoch: 8,
          authoredEpoch: 4,
          rootRecords: [],
          payloads: new Map(),
        },
      };
    });
    await sendSnapshot();
    expect(captureSnapshot).toHaveBeenCalledOnce();
    expect(sendScene).toHaveBeenCalledTimes(3);
    expect(sendScene.mock.calls[2]?.[0]).toMatchObject({
      generation: 7,
      sourceEpoch: 8,
    });
    expect(
      (host as unknown as { cameraInFlightGeneration: number | null })
        .cameraInFlightGeneration,
    ).toBeNull();

    currentCameraSource.mockReturnValue(cameraSource);
    sendScene.mockRejectedValueOnce(new Error("scene send failed"));
    await expect(sendSnapshot()).rejects.toThrow("scene send failed");
    expect(
      (host as unknown as { cameraInFlightGeneration: number | null })
        .cameraInFlightGeneration,
    ).toBeNull();
    expect(
      (host as unknown as { cameraUpdatePending: boolean }).cameraUpdatePending,
    ).toBe(false);

    await sendSnapshot();
    expect(
      (host as unknown as { cameraInFlightGeneration: number | null })
        .cameraInFlightGeneration,
    ).toBe(9);
    host.dispose();
    expect(
      (host as unknown as { cameraInFlightGeneration: number | null })
        .cameraInFlightGeneration,
    ).toBeNull();
  });

  it("skips unchanged camera geometry during continuous playback without dropping clock changes", async () => {
    const sendScene = vi.fn().mockResolvedValue(undefined);
    const viewport = { x: 175.5, y: 0, width: 1054, height: 916 };
    const scene = {
      sceneId: "scene",
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      viewport: { ...viewport },
      width: 2108,
      height: 1832,
      pixelRatio: 2,
      clock: { playing: true, timeSeconds: 5, speed: 1 },
    };
    const publication = {
      generation: 4,
      sourceEpoch: 7,
      authoredEpoch: 3,
      clockIdentity: { origin: 100, sourcePlaying: true },
    };
    let clock = { playing: true, timeSeconds: 6, speed: 1 };
    let origin = 100;
    let requestedRatio = 2;
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    Object.assign(host, {
      visible: true,
      disposed: false,
      capturingExport: false,
      preparingExport: false,
      generation: 4,
      cameraInFlightGeneration: null,
      cameraUpdatePending: false,
      staged: new Map(),
      scenes: new Map(),
      pendingAssetRevisions: new Map(),
      assetRevisions: new Map(),
      publicationWaiters: new Set(),
      worker: { sendScene },
      entries: [],
      sceneGeometry: () => ({
        viewport: { ...viewport },
        pixelRatio: requestedRatio,
      }),
      currentCameraSource: () => ({ scene, publication }),
      clock: () => clock,
      getClockOrigin: () => origin,
      armCameraPublishTimeout: vi.fn(),
    });
    const sendSnapshot = (
      host as unknown as { sendSnapshot(): Promise<void> }
    ).sendSnapshot.bind(host);
    await sendSnapshot();
    expect(sendScene).not.toHaveBeenCalled();
    requestedRatio += 0.0000005;
    await sendSnapshot();
    expect(sendScene).not.toHaveBeenCalled();

    viewport.x += 1;
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(1);
    expect(sendScene.mock.calls[0]?.[0].viewport.x).toBe(176.5);
    expect(sendScene.mock.calls[0]?.[0].pixelRatio).toBe(2);
    requestedRatio = 2;

    const pendingGeneration = sendScene.mock.calls[0]?.[0].generation as number;
    viewport.x -= 1;
    await sendSnapshot();
    expect(
      (host as unknown as { cameraUpdatePending: boolean }).cameraUpdatePending,
    ).toBe(true);
    viewport.x += 1;
    await sendSnapshot();
    expect(
      (host as unknown as { cameraUpdatePending: boolean }).cameraUpdatePending,
    ).toBe(false);
    expect(sendScene).toHaveBeenCalledTimes(1);

    Object.assign(host, { cameraInFlightGeneration: null });
    origin = 101;
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(2);
    expect(sendScene.mock.calls[1]?.[0].generation).toBeGreaterThan(
      pendingGeneration,
    );

    Object.assign(host, { cameraInFlightGeneration: null });
    origin = 100;
    clock = { playing: false, timeSeconds: 6, speed: 1 };
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(3);
    expect(sendScene.mock.calls[2]?.[0].clock.playing).toBe(false);

    Object.assign(host, { cameraInFlightGeneration: null });
    clock = { playing: true, timeSeconds: 6, speed: 2 };
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(4);

    Object.assign(host, { cameraInFlightGeneration: null });
    viewport.x = scene.viewport.x;
    scene.clock = { playing: false, timeSeconds: 8, speed: 1 };
    publication.clockIdentity = { origin: 100, sourcePlaying: false };
    clock = { playing: false, timeSeconds: 8, speed: 1 };
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(4);
    clock = { playing: false, timeSeconds: 9, speed: 1 };
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(5);

    Object.assign(host, { cameraInFlightGeneration: null });
    scene.clock = { playing: false, timeSeconds: 8, speed: 1 };
    publication.clockIdentity = { origin: 100, sourcePlaying: true };
    clock = { playing: true, timeSeconds: 10, speed: 1 };
    Object.assign(host, {
      snapshotClock: () => ({ ...clock, playing: false }),
    });
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(5);

    Object.assign(host, { cameraInFlightGeneration: null });
    publication.clockIdentity = { origin: 100, sourcePlaying: false };
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(6);

    Object.assign(host, { cameraInFlightGeneration: null });
    Reflect.deleteProperty(host, "snapshotClock");
    scene.clock = { playing: true, timeSeconds: 5, speed: 1 };
    publication.clockIdentity = { origin: 100, sourcePlaying: true };
    (
      host as unknown as { publicationWaiters: Set<unknown> }
    ).publicationWaiters.add({});
    await sendSnapshot();
    expect(sendScene).toHaveBeenCalledTimes(7);
  });
});

describe("hidden native worker export", () => {
  function fixture() {
    const instance = { id: "fill", params: { amount: 0.5 } };
    const entry = { instance, definitionHash: "definition-1" };
    const provider = {
      sourceEpoch: vi.fn().mockReturnValue(8),
      authoredSourceEpoch: vi.fn().mockReturnValue(4),
    };
    const targetProvider = {
      sourceEpoch: vi.fn().mockReturnValue(6),
      authoredSourceEpoch: vi.fn().mockReturnValue(3),
    };
    const scene = {
      generation: 9,
      sourceEpoch: 8,
      authoredEpoch: 4,
      instances: [instance],
      targets: [{ instanceId: "fill", definitionHash: "definition-1" }],
    };
    const exported = {
      type: "exported",
      generation: 9,
      sourceEpoch: 8,
      width: 10,
      height: 10,
      rgba: new ArrayBuffer(400),
      committedInstances: [],
    };
    const exportScene = vi.fn().mockResolvedValue(exported);
    const captureSnapshot = vi.fn().mockResolvedValue({
      scene,
      assets: [],
      publication: {
        targetEpochs: new Map([["fill", { source: 6, authored: 3 }]]),
      },
    });
    const host = Object.create(
      NativeWorkerSceneHost.prototype,
    ) as NativeWorkerSceneHost;
    Object.assign(host, {
      visible: false,
      disposed: false,
      dirty: true,
      updating: false,
      capturingExport: false,
      preparingExport: false,
      provider,
      entries: [entry],
      targets: new Map([["fill", { entry, provider: targetProvider }]]),
      worker: { exportScene },
      captureSnapshot,
      requestUpdate: vi.fn(),
    });
    return { host, instance, provider, exportScene, captureSnapshot };
  }

  const options = {
    cropRect: { x: 0, y: 0, width: 10, height: 10 },
    pixelRatio: 1,
    timeSeconds: 2,
    regionExport: false,
    timeoutMs: 1000,
  };

  it("exports a fresh authored scene while preview frames remain culled", async () => {
    const { host, exportScene, captureSnapshot } = fixture();
    const result = await host.captureExportScene(options);
    expect(result.previewGeneration).toBeNull();
    expect(captureSnapshot).toHaveBeenCalledOnce();
    expect(exportScene).toHaveBeenCalledOnce();
  });

  it("rejects an edited native payload during hidden capture", async () => {
    const { host, instance, captureSnapshot, exportScene } = fixture();
    captureSnapshot.mockImplementation(async () => {
      instance.params.amount = 0.75;
      return {
        scene: {
          generation: 9,
          sourceEpoch: 8,
          authoredEpoch: 4,
          instances: [{ id: "fill", params: { amount: 0.75 } }],
          targets: [{ instanceId: "fill", definitionHash: "definition-1" }],
        },
        assets: [],
        publication: {
          targetEpochs: new Map([["fill", { source: 6, authored: 3 }]]),
        },
      };
    });
    await expect(host.captureExportScene(options)).rejects.toMatchObject({
      code: "composition-preview-stale",
    });
    expect(exportScene).not.toHaveBeenCalled();
  });

  it("rejects a native payload edited while the worker reads back the hidden still", async () => {
    const { host, instance, exportScene } = fixture();
    exportScene.mockImplementation(async () => {
      instance.params.amount = 0.75;
      return {
        type: "exported",
        generation: 9,
        sourceEpoch: 8,
        width: 10,
        height: 10,
        rgba: new ArrayBuffer(400),
        committedInstances: [],
      };
    });
    await expect(host.captureExportScene(options)).rejects.toMatchObject({
      code: "composition-preview-stale",
    });
  });
});
