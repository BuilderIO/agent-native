// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NativeWorkerSourceRecord } from "./native-worker-protocol";
import {
  NativeWorkerSceneHost,
  nativeWorkerOutputRecords,
} from "./native-worker-scene-host";

afterEach(() => vi.useRealTimers());

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

describe("native worker export record dimensions", () => {
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
      getBoundingClientRect: () => ({ x: 30, y: 40, width: 100, height: 80 }),
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
      expect(host.retainsPreviewViewport(crop, 2)).toBe(false);
      expect(
        host.retainsPreviewViewport(
          { x: 900, y: 60, width: 200, height: 250 },
          1,
        ),
      ).toBe(false);
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
      clock: () => ({ playing: true, timeSeconds, speed: 1 }),
    });
    const sceneClock = (
      host as unknown as {
        snapshotClock(
          viewport: { x: number; y: number; width: number; height: number },
          exportCapture: boolean,
        ): { playing: boolean; timeSeconds: number; speed: number };
      }
    ).snapshotClock.bind(host);
    const offscreen = { x: 400, y: 400, width: 100, height: 100 };
    try {
      expect(sceneClock(offscreen, false)).toEqual({
        playing: false,
        timeSeconds: 12,
        speed: 1,
      });
      expect(sceneClock(offscreen, true)).toEqual({
        playing: true,
        timeSeconds: 12,
        speed: 1,
      });
      timeSeconds = 18;
      expect(
        sceneClock({ x: 50, y: 50, width: 100, height: 100 }, false),
      ).toEqual({ playing: true, timeSeconds: 18, speed: 1 });
    } finally {
      marker.remove();
    }
  });

  it("reprojects an exposed viewport edge without recapturing unchanged authored sources", async () => {
    vi.stubGlobal("innerWidth", 1044);
    vi.stubGlobal("innerHeight", 1042);
    const target = {
      getBoundingClientRect: () => ({ x: 30, y: 40, width: 100, height: 80 }),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
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

  it("bounds camera submissions until the previous worker generation commits", async () => {
    const sendScene = vi.fn().mockResolvedValue(undefined);
    const captureSnapshot = vi.fn();
    const currentCameraSource = vi.fn().mockReturnValue(true);
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
          },
          assets: [],
          revisions: new Map(),
          publication: {
            generation,
            sourceEpoch: 7,
            authoredEpoch: 3,
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

    currentCameraSource.mockReturnValue(true);
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
