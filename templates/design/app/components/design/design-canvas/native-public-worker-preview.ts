import { injectDocumentMarkup } from "@agent-native/core/shared";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import {
  nativeBuiltinDefinitionIds,
  nativeBuiltinExecutionMetadata,
} from "../../../../.generated/bridge/native-builtin-metadata.generated";
import { nativeWorkerSource } from "../../../../.generated/bridge/native-worker-source.generated";
import {
  hashEffectDefinition,
  MAX_NATIVE_SCENE_EXECUTABLE_HASHES,
  nativeDefinitionAuthorizationError,
  parseNativeEffectApprovalState,
} from "../../../../shared/native-effect-trust";
import {
  validateEffectDocument,
  type EffectDocument,
} from "../../../../shared/native-effects";
import {
  acquireNativeWorkerLease,
  installNativeWorkerBroker,
  isNativeWorkerBrokerError,
  type NativeWorkerLease,
} from "../bridge/native-worker-broker";
import {
  nativeWorkerClockSampleValid,
  type NativeWorkerFromGpu,
  type NativeWorkerCamera,
  type NativeWorkerScene,
  type NativeWorkerToGpu,
} from "../bridge/native-worker-protocol";

const READY = "native-public-worker-ready";
const CONNECT = "native-public-worker-connect";
const MESSAGE = "native-public-worker-message";
const FAILURE = "native-public-worker-failure";
const DISPOSE = "native-public-worker-dispose";
const PING = "native-public-worker-ping";
const PONG = "native-public-worker-pong";
const NONCE = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_SCENE_PIXELS = 8192 * 8192;
const MAX_SCENE_DIMENSION = 8192;
const MAX_ASSET_PIXELS = 8_388_608;
const MAX_ASSET_DIMENSION = 4096;
const MAX_INSTANCES = 128;
const MAX_RECORDS = 2048;
const MAX_ASSETS = 256;
const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_EXPORTS = 4;
const MAX_MESSAGES_PER_SECOND = 240;
const cleanupByFrame = new WeakMap<HTMLIFrameElement, () => void>();
const packetKeys = new Set(["type", "message"]);
const viewportKeys = new Set(["x", "y", "width", "height"]);
const clockKeys = new Set([
  "playing",
  "timeSeconds",
  "speed",
  "sampledAtEpochMs",
]);
const sceneKeys = new Set([
  "sceneId",
  "generation",
  "sourceEpoch",
  "authoredEpoch",
  "viewport",
  "width",
  "height",
  "pixelRatio",
  "colorSpace",
  "frameRateTarget",
  "compact",
  "clock",
  "requiredAssets",
  "definitions",
  "instances",
  "targets",
  "records",
  "backdropRecords",
]);
const cameraKeys = new Set([
  "type",
  "sceneId",
  "generation",
  "baseGeneration",
  "sourceEpoch",
  "authoredEpoch",
  "viewport",
  "width",
  "height",
  "pixelRatio",
  "clock",
]);
const messageKeys: Record<NativeWorkerToGpu["type"], ReadonlySet<string>> = {
  init: new Set(["type", "protocol", "sceneId", "canvas"]),
  scene: new Set(["type", "scene"]),
  camera: cameraKeys,
  asset: new Set([
    "type",
    "kind",
    "sceneId",
    "generation",
    "assetId",
    "revision",
    "bitmap",
    "sampleEncoding",
    "width",
    "height",
    "data",
  ]),
  export: new Set([
    "type",
    "sceneId",
    "requestId",
    "generation",
    "sourceEpoch",
    "timeSeconds",
    "selectedInstanceIds",
    "selectedNodeIds",
    "cropRect",
    "pixelRatio",
  ]),
  "export-scene": new Set([
    "type",
    "sceneId",
    "requestId",
    "scene",
    "timeSeconds",
    "selectionFiltered",
    "selectedInstanceIds",
    "selectedNodeIds",
    "cropRect",
    "pixelRatio",
  ]),
  "cancel-export": new Set(["type", "sceneId", "requestId"]),
  visibility: new Set(["type", "sceneId", "visible"]),
  dispose: new Set(["type", "sceneId"]),
};

function hasOnlyKeys(value: unknown, keys: ReadonlySet<string>): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

export class NativePublicWorkerPreviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativePublicWorkerPreviewError";
  }
}

export interface NativePublicWorkerPreviewDocument {
  html: string;
  nonce: string;
  manifest: EffectDocument;
  approvedHashes: readonly string[];
}

export function prepareNativePublicWorkerPreviewDocument(
  html: string,
  approvedHashes: readonly string[] = [],
): NativePublicWorkerPreviewDocument | null {
  type Node = DefaultTreeAdapterMap["node"];
  const scripts: string[] = [];
  let inert = false;
  const visit = (node: Node, insideTemplate: boolean) => {
    const tag = "tagName" in node ? node.tagName.toLowerCase() : "";
    if (
      tag === "script" &&
      "attrs" in node &&
      node.attrs.some(
        (attr) =>
          attr.name === "type" &&
          attr.value === "application/x-agent-native-effects",
      )
    ) {
      if (insideTemplate) inert = true;
      else
        scripts.push(
          "childNodes" in node
            ? node.childNodes
                .filter(
                  (child): child is typeof child & { value: string } =>
                    "value" in child,
                )
                .map((child) => child.value)
                .join("")
            : "",
        );
    }
    if ("childNodes" in node)
      for (const child of node.childNodes)
        visit(child, insideTemplate || tag === "template");
    if (tag === "template" && "content" in node && node.content)
      visit(node.content, true);
  };
  visit(parse(html), false);
  if (!scripts.length && !inert) return null;
  if (inert || scripts.length !== 1)
    throw new NativePublicWorkerPreviewError(
      "worker-public-manifest-invalid",
      "The public native effect manifest is ambiguous.",
    );
  let value: unknown;
  try {
    value = JSON.parse(scripts[0]!);
  } catch {
    throw new NativePublicWorkerPreviewError(
      "worker-public-manifest-invalid",
      "The public native effect manifest is unreadable.",
    );
  }
  const validation = validateEffectDocument(value);
  if (!validation.valid || !validation.document)
    throw new NativePublicWorkerPreviewError(
      "worker-public-manifest-invalid",
      "The public native effect manifest is invalid.",
    );
  if (
    validation.document.instances.length > MAX_INSTANCES ||
    validation.document.definitions.length > MAX_NATIVE_SCENE_EXECUTABLE_HASHES
  )
    throw new NativePublicWorkerPreviewError(
      "worker-public-scene-limit",
      "The public native effect manifest exceeds its bounded limits.",
    );
  const approved = parseNativeEffectApprovalState({
    schemaVersion: 1,
    hashes: [...approvedHashes],
  });
  const nonce = crypto.randomUUID();
  return {
    html: injectDocumentMarkup(
      html,
      `<meta name="an-native-public-worker-nonce" content="${nonce}">`,
    ),
    nonce,
    manifest: validation.document,
    approvedHashes: approved.hashes,
  };
}

function boundedRecordTree(value: unknown): boolean {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 50_000 || depth > 16) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") return item.length <= 4096;
    if (typeof item !== "object" || ancestors.has(item)) return false;
    ancestors.add(item);
    const valid = Array.isArray(item)
      ? item.length <= MAX_RECORDS &&
        item.every((child) => visit(child, depth + 1))
      : (() => {
          const entries = Object.entries(item);
          return (
            entries.length <= 64 &&
            entries.every(
              ([key, child]) => key.length <= 128 && visit(child, depth + 1),
            )
          );
        })();
    ancestors.delete(item);
    return valid;
  };
  return visit(value, 0);
}

function boundedInputAssetBindings(
  target: NativeWorkerScene["targets"][number],
): boolean {
  const bindings = target.inputAssetIds;
  if (bindings === undefined) return true;
  if (
    typeof bindings !== "object" ||
    bindings === null ||
    Array.isArray(bindings)
  )
    return false;
  const entries = Object.entries(bindings);
  return (
    entries.length <= MAX_ASSETS &&
    entries.every(
      ([resource, assetId]) =>
        resource.length > 0 &&
        resource.length <= 128 &&
        typeof assetId === "string" &&
        Boolean(assetId.length) &&
        assetId.length <= 4096,
    )
  );
}

function boundedScene(scene: NativeWorkerScene): boolean {
  return (
    typeof scene === "object" &&
    scene !== null &&
    hasOnlyKeys(scene, sceneKeys) &&
    hasOnlyKeys(scene.viewport, viewportKeys) &&
    hasOnlyKeys(scene.clock, clockKeys) &&
    (scene.compact === undefined || typeof scene.compact === "boolean") &&
    nativeWorkerClockSampleValid(
      scene.clock,
      performance.timeOrigin + performance.now(),
    ) &&
    Array.isArray(scene.definitions) &&
    Array.isArray(scene.instances) &&
    Array.isArray(scene.targets) &&
    Array.isArray(scene.records) &&
    Array.isArray(scene.requiredAssets) &&
    (scene.backdropRecords === undefined ||
      Array.isArray(scene.backdropRecords)) &&
    Number.isSafeInteger(scene.width) &&
    Number.isSafeInteger(scene.height) &&
    scene.width > 0 &&
    scene.height > 0 &&
    scene.width <= MAX_SCENE_DIMENSION &&
    scene.height <= MAX_SCENE_DIMENSION &&
    scene.width * scene.height <= MAX_SCENE_PIXELS &&
    scene.targets.length <= MAX_INSTANCES &&
    scene.targets.every(boundedInputAssetBindings) &&
    scene.instances.length <= MAX_INSTANCES &&
    scene.definitions.length <= MAX_NATIVE_SCENE_EXECUTABLE_HASHES &&
    scene.requiredAssets.length <= MAX_ASSETS &&
    scene.records.length <= MAX_RECORDS &&
    (scene.backdropRecords?.length ?? 0) <= MAX_RECORDS &&
    boundedRecordTree([
      scene.targets,
      scene.records,
      scene.backdropRecords ?? [],
      scene.requiredAssets,
      scene.viewport,
      scene.clock,
    ]) &&
    Number.isFinite(scene.pixelRatio) &&
    0 < scene.pixelRatio &&
    scene.pixelRatio <= 4
  );
}

function boundedCamera(camera: NativeWorkerCamera): boolean {
  return (
    hasOnlyKeys(camera.viewport, viewportKeys) &&
    hasOnlyKeys(camera.clock, clockKeys) &&
    nativeWorkerClockSampleValid(
      camera.clock,
      performance.timeOrigin + performance.now(),
    ) &&
    Number.isSafeInteger(camera.generation) &&
    Number.isSafeInteger(camera.baseGeneration) &&
    Number.isSafeInteger(camera.sourceEpoch) &&
    Number.isSafeInteger(camera.authoredEpoch) &&
    Number.isSafeInteger(camera.width) &&
    Number.isSafeInteger(camera.height) &&
    camera.width > 0 &&
    camera.height > 0 &&
    MAX_SCENE_DIMENSION >= camera.width &&
    MAX_SCENE_DIMENSION >= camera.height &&
    MAX_SCENE_PIXELS >= camera.width * camera.height &&
    Number.isFinite(camera.pixelRatio) &&
    camera.pixelRatio > 0 &&
    4 >= camera.pixelRatio &&
    [
      camera.viewport.x,
      camera.viewport.y,
      camera.viewport.width,
      camera.viewport.height,
      camera.clock.timeSeconds,
      camera.clock.speed,
    ].every(Number.isFinite) &&
    camera.viewport.width > 0 &&
    camera.viewport.height > 0 &&
    camera.width === Math.ceil(camera.viewport.width * camera.pixelRatio) &&
    camera.height === Math.ceil(camera.viewport.height * camera.pixelRatio) &&
    typeof camera.clock.playing === "boolean"
  );
}

function boundedExport(
  request: Extract<NativeWorkerToGpu, { type: "export" | "export-scene" }>,
): boolean {
  const crop = request.cropRect;
  const ids = (values?: readonly string[]) =>
    values === undefined ||
    (Array.isArray(values) &&
      values.length <= MAX_INSTANCES &&
      values.every(
        (value) => typeof value === "string" && value.length <= 160,
      ));
  return (
    typeof request.requestId === "string" &&
    0 < request.requestId.length &&
    request.requestId.length <= 160 &&
    crop !== null &&
    typeof crop === "object" &&
    [
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      request.pixelRatio,
      request.timeSeconds,
    ].every(Number.isFinite) &&
    crop.width > 0 &&
    crop.height > 0 &&
    0 < request.pixelRatio &&
    request.pixelRatio <= 4 &&
    Math.ceil(crop.width * request.pixelRatio) <= MAX_SCENE_DIMENSION &&
    Math.ceil(crop.height * request.pixelRatio) <= MAX_SCENE_DIMENSION &&
    Math.ceil(crop.width * request.pixelRatio) *
      Math.ceil(crop.height * request.pixelRatio) <=
      MAX_SCENE_PIXELS &&
    ids(request.selectedInstanceIds) &&
    ids(request.selectedNodeIds)
  );
}

function addressedSceneId(message: NativeWorkerToGpu): string {
  return message.type === "scene" ? message.scene.sceneId : message.sceneId;
}

function internalMessage(
  message: NativeWorkerToGpu,
  sceneId: string,
): NativeWorkerToGpu {
  if (message.type === "scene")
    return { ...message, scene: { ...message.scene, sceneId } };
  if (message.type === "export-scene")
    return {
      ...message,
      sceneId,
      scene: { ...message.scene, sceneId },
    };
  return { ...message, sceneId };
}

function createParentPresentation(frame: HTMLIFrameElement) {
  const host = frame.ownerDocument.defaultView;
  const parent = frame.parentElement;
  if (!host || !parent)
    throw new NativePublicWorkerPreviewError(
      "worker-public-host-unavailable",
      "The public preview host is unavailable.",
    );
  const box = frame.ownerDocument.createElement("div");
  box.setAttribute("data-an-native-public-presentation", "");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText =
    "position:absolute;pointer-events:none;overflow:hidden;visibility:hidden;max-width:none;max-height:none;";
  const canvas = frame.ownerDocument.createElement("canvas");
  canvas.setAttribute("data-an-native-public-canvas", "");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:absolute;pointer-events:none;max-width:none;max-height:none;";
  box.append(canvas);
  const offscreen = canvas.transferControlToOffscreen();
  frame.after(box);
  let committed = false;
  let pendingFrame = 0;
  const syncBox = () => {
    pendingFrame = 0;
    if (!frame.isConnected || !box.isConnected) return;
    const style = host.getComputedStyle(frame);
    box.style.left = `${frame.offsetLeft}px`;
    box.style.top = `${frame.offsetTop}px`;
    box.style.width = `${frame.offsetWidth}px`;
    box.style.height = `${frame.offsetHeight}px`;
    box.style.transform = style.transform;
    box.style.transformOrigin = style.transformOrigin;
    box.style.translate = style.translate;
    box.style.rotate = style.rotate;
    box.style.scale = style.scale;
    box.style.borderRadius = style.borderRadius;
    box.style.clipPath = style.clipPath;
    box.style.opacity = style.opacity;
    box.style.zIndex = style.zIndex;
    box.style.visibility =
      committed && style.visibility !== "hidden" && style.display !== "none"
        ? "visible"
        : "hidden";
  };
  const scheduleSync = () => {
    if (!pendingFrame) pendingFrame = host.requestAnimationFrame(syncBox);
  };
  const resizeObserver = new host.ResizeObserver(scheduleSync);
  resizeObserver.observe(frame);
  resizeObserver.observe(parent);
  const mutationObserver = new host.MutationObserver(scheduleSync);
  mutationObserver.observe(frame, {
    attributes: true,
    attributeFilter: ["style", "class", "hidden"],
  });
  host.addEventListener("resize", scheduleSync);
  syncBox();
  return {
    offscreen,
    commit(viewport: NativeWorkerScene["viewport"]) {
      canvas.style.left = `${viewport.x}px`;
      canvas.style.top = `${viewport.y}px`;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      committed = true;
      syncBox();
    },
    dispose() {
      if (pendingFrame) host.cancelAnimationFrame(pendingFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      host.removeEventListener("resize", scheduleSync);
      box.remove();
    },
  };
}

export function connectNativePublicWorkerPreview(
  frame: HTMLIFrameElement,
  prepared: NativePublicWorkerPreviewDocument,
  expectedSrcdoc: string,
): () => void {
  cleanupByFrame.get(frame)?.();
  const host = frame.ownerDocument.defaultView;
  if (!host)
    throw new NativePublicWorkerPreviewError(
      "worker-public-host-unavailable",
      "The public preview host is unavailable.",
    );
  installNativeWorkerBroker(host);
  let closed = false;
  let port: MessagePort | null = null;
  let workerLease: NativeWorkerLease | null = null;
  let workerSceneId: string | null = null;
  let initSeen = false;
  let presentation: ReturnType<typeof createParentPresentation> | null = null;
  let disposeForwarded = false;
  let lastGeneration = 0;
  let committedGeneration = 0;
  let lastCameraBaseGeneration: number | null = null;
  const sceneViewports = new Map<
    number,
    {
      sourceEpoch: number;
      authoredEpoch: number;
      pixelRatio: number;
      viewport: NativeWorkerScene["viewport"];
    }
  >();
  const pendingAssets = new Map<number, { count: number; bytes: number }>();
  const pendingExports = new Set<string>();
  let windowStart = 0;
  let windowMessages = 0;
  let loadProbe = 0;
  let loadProbeTimer: ReturnType<typeof setTimeout> | null = null;
  const definitions = new Map(
    prepared.manifest.definitions.map((definition) => [
      `${definition.id}@${definition.version}`,
      JSON.stringify(definition),
    ]),
  );
  const instances = new Map(
    prepared.manifest.instances.map((instance) => [
      instance.id,
      JSON.stringify(instance),
    ]),
  );
  const allowed = (scene: NativeWorkerScene): boolean => {
    if (!boundedScene(scene)) return false;
    try {
      return (
        scene.definitions.every(
          (definition) =>
            definitions.get(`${definition.id}@${definition.version}`) ===
            JSON.stringify(definition),
        ) &&
        scene.instances.every(
          (instance) => instances.get(instance.id) === JSON.stringify(instance),
        )
      );
    } catch {
      throw new NativePublicWorkerPreviewError(
        "worker-public-scene-denied",
        "The public worker scene could not be verified.",
      );
    }
  };
  const frameCurrent = () =>
    frame.isConnected && frame.srcdoc === expectedSrcdoc;
  const closeLease = () => {
    if (loadProbeTimer !== null) clearTimeout(loadProbeTimer);
    loadProbeTimer = null;
    if (workerLease && initSeen && workerSceneId && !disposeForwarded)
      try {
        workerLease.post({ type: "dispose", sceneId: workerSceneId });
      } catch (error) {
        if (
          !isNativeWorkerBrokerError(error) ||
          error.code !== "worker-disposed"
        )
          console.error(
            new NativePublicWorkerPreviewError(
              "worker-public-dispose-failed",
              `The public GPU scene could not be retired: ${String(error)}`,
            ),
          );
      }
    workerLease?.release();
    presentation?.dispose();
    presentation = null;
    workerLease = null;
    workerSceneId = null;
    port?.close();
    port = null;
    initSeen = false;
    disposeForwarded = false;
    lastGeneration = 0;
    committedGeneration = 0;
    lastCameraBaseGeneration = null;
    sceneViewports.clear();
    pendingAssets.clear();
    pendingExports.clear();
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    host.removeEventListener("message", onReady);
    frame.removeEventListener("load", onLoad);
    closeLease();
    cleanupByFrame.delete(frame);
  };
  const fail = (code: string, message: string) => {
    port?.postMessage({ type: FAILURE, code, message });
    closeLease();
  };
  const onLoad = () => {
    if (!port || !workerLease) return;
    const nonce = ++loadProbe;
    port.postMessage({ type: PING, nonce });
    if (loadProbeTimer !== null) clearTimeout(loadProbeTimer);
    loadProbeTimer = setTimeout(() => {
      if (loadProbe === nonce) closeLease();
    }, 500);
  };
  const onReady = (event: MessageEvent) => {
    if (
      closed ||
      !frameCurrent() ||
      event.source !== frame.contentWindow ||
      event.origin !== "null" ||
      event.data?.type !== READY ||
      event.data?.nonce !== prepared.nonce ||
      !NONCE.test(prepared.nonce) ||
      typeof event.data?.sceneId !== "string" ||
      !/^[A-Za-z0-9:_-]{1,160}$/.test(event.data.sceneId) ||
      event.ports.length !== 1
    )
      return;
    if (port) {
      event.ports[0]?.close();
      return;
    }
    const candidate = event.ports[0]!;
    port = candidate;
    const childSceneId = event.data.sceneId as string;
    const internalSceneId = `public:${crypto.randomUUID()}`;
    const accept = async () => {
      const builtinIds = new Set(nativeBuiltinDefinitionIds);
      const builtinHashes = new Set(
        nativeBuiltinExecutionMetadata.map(([hash]) => hash),
      );
      const approvedHashes = new Set(prepared.approvedHashes);
      for (const definition of prepared.manifest.definitions) {
        const hash = await hashEffectDefinition(definition);
        const denial = nativeDefinitionAuthorizationError({
          definitionId: definition.id,
          executionHash: hash,
          builtinIds,
          builtinHashes,
          approvedHashes,
          approvalStatus: "ready",
        });
        if (denial)
          throw new NativePublicWorkerPreviewError(
            "worker-public-definition-denied",
            "The public worker definition was not approved by its host.",
          );
      }
      if (closed || port !== candidate || !frameCurrent()) return;
      const lease = acquireNativeWorkerLease(
        nativeWorkerSource,
        internalSceneId,
        {
          message: (message: NativeWorkerFromGpu) => {
            if (!closed && port === candidate && frameCurrent()) {
              if (
                (message.type === "exported" || message.type === "error") &&
                message.requestId
              )
                pendingExports.delete(message.requestId);
              if (message.type === "committed") {
                for (const generation of pendingAssets.keys())
                  if (generation <= message.generation)
                    pendingAssets.delete(generation);
                const scene = sceneViewports.get(message.generation);
                if (
                  scene &&
                  scene.sourceEpoch === message.sourceEpoch &&
                  message.generation > committedGeneration
                ) {
                  presentation?.commit(scene.viewport);
                  committedGeneration = message.generation;
                }
                for (const generation of sceneViewports.keys())
                  if (generation < committedGeneration)
                    sceneViewports.delete(generation);
              }
              if (message.type === "exported")
                pendingAssets.delete(message.generation);
              const response = { ...message, sceneId: childSceneId };
              candidate.postMessage(
                { type: MESSAGE, message: response },
                message.type === "exported" ? [message.rgba] : [],
              );
            }
          },
          failure: (code, message) => fail(code, message),
        },
      );
      workerLease = lease;
      workerSceneId = internalSceneId;
      candidate.onmessage = (event: MessageEvent) => {
        const packet = event.data;
        if (packet?.type === PONG && packet.nonce === loadProbe) {
          if (loadProbeTimer !== null) clearTimeout(loadProbeTimer);
          loadProbeTimer = null;
          return;
        }
        const receivedBitmap =
          packet?.message?.type === "asset" &&
          packet.message.kind === "bitmap" &&
          packet.message.bitmap instanceof ImageBitmap
            ? packet.message.bitmap
            : null;
        let forwardedBitmap = false;
        try {
          if (packet?.type === DISPOSE) {
            closeLease();
            return;
          }
          if (
            closed ||
            !frameCurrent() ||
            port !== candidate ||
            !hasOnlyKeys(packet, packetKeys) ||
            packet?.type !== MESSAGE ||
            !packet.message ||
            typeof packet.message !== "object"
          ) {
            fail(
              "worker-public-message-invalid",
              "The public worker request is invalid.",
            );
            return;
          }
          const now = performance.now();
          if (now - windowStart >= 1000) {
            windowStart = now;
            windowMessages = 0;
          }
          windowMessages += 1;
          if (windowMessages > MAX_MESSAGES_PER_SECOND) {
            fail(
              "worker-public-rate-exceeded",
              "The public worker request rate is too high.",
            );
            return;
          }
          const message = packet.message as NativeWorkerToGpu;
          if (
            ![
              "init",
              "scene",
              "camera",
              "asset",
              "export",
              "export-scene",
              "cancel-export",
              "visibility",
              "dispose",
            ].includes(message.type) ||
            !hasOnlyKeys(message, messageKeys[message.type]) ||
            ((message.type === "scene" || message.type === "export-scene") &&
              (!message.scene || typeof message.scene !== "object"))
          ) {
            fail(
              "worker-public-message-invalid",
              "The public worker request is invalid.",
            );
            return;
          }
          if (addressedSceneId(message) !== childSceneId) {
            fail(
              "worker-public-scene-mismatch",
              "The public worker scene changed identity.",
            );
            return;
          }
          if (message.type === "init") {
            if (
              initSeen ||
              message.protocol !== 1 ||
              !(message.canvas instanceof OffscreenCanvas)
            ) {
              fail(
                "worker-public-init-invalid",
                "The public worker canvas is invalid.",
              );
              return;
            }
            initSeen = true;
            presentation = createParentPresentation(frame);
            lease.post(
              {
                ...message,
                sceneId: internalSceneId,
                canvas: presentation.offscreen,
              },
              [presentation.offscreen],
            );
            return;
          }
          if (!initSeen) {
            fail(
              "worker-public-init-missing",
              "The public worker was not initialized.",
            );
            return;
          }
          if (message.type === "scene" || message.type === "export-scene") {
            if (!allowed(message.scene)) {
              fail(
                "worker-public-scene-denied",
                "The public worker scene differs from its prepared document.",
              );
              return;
            }
            if (
              [...pendingAssets.keys()].some(
                (generation) => generation > message.scene.generation,
              )
            ) {
              fail(
                "worker-public-asset-generation-invalid",
                "The public worker assets do not match its scene generation.",
              );
              return;
            }
            if (message.type === "scene") {
              if (message.scene.generation <= lastGeneration) {
                fail(
                  "worker-public-generation-invalid",
                  "The public worker scene generation is stale.",
                );
                return;
              }
              lastGeneration = message.scene.generation;
              lastCameraBaseGeneration = null;
              sceneViewports.set(message.scene.generation, {
                sourceEpoch: message.scene.sourceEpoch,
                authoredEpoch: message.scene.authoredEpoch,
                pixelRatio: message.scene.pixelRatio,
                viewport: message.scene.viewport,
              });
              while (sceneViewports.size > 16)
                sceneViewports.delete(sceneViewports.keys().next().value!);
            } else if (
              !boundedExport(message) ||
              pendingExports.has(message.requestId) ||
              pendingExports.size >= MAX_EXPORTS
            ) {
              fail(
                "worker-public-export-limit",
                "The public worker has too many still captures.",
              );
              return;
            } else pendingExports.add(message.requestId);
            lease.post(internalMessage(message, internalSceneId));
            return;
          }
          if (message.type === "camera") {
            const base = sceneViewports.get(committedGeneration);
            if (
              !boundedCamera(message) ||
              !base ||
              message.baseGeneration !== committedGeneration ||
              message.generation <= lastGeneration ||
              message.sourceEpoch !== base.sourceEpoch ||
              message.authoredEpoch !== base.authoredEpoch ||
              message.pixelRatio !== base.pixelRatio ||
              (lastGeneration !== committedGeneration &&
                lastCameraBaseGeneration !== committedGeneration)
            ) {
              fail(
                "worker-public-camera-denied",
                "The public worker camera no longer matches its approved scene.",
              );
              return;
            }
            lastGeneration = message.generation;
            lastCameraBaseGeneration = committedGeneration;
            sceneViewports.set(message.generation, {
              sourceEpoch: message.sourceEpoch,
              authoredEpoch: message.authoredEpoch,
              pixelRatio: message.pixelRatio,
              viewport: message.viewport,
            });
            while (sceneViewports.size > 16)
              sceneViewports.delete(sceneViewports.keys().next().value!);
            lease.post(internalMessage(message, internalSceneId));
            return;
          }
          if (message.type === "asset") {
            if (
              !Number.isSafeInteger(message.generation) ||
              message.generation <= lastGeneration ||
              !Number.isSafeInteger(message.revision) ||
              message.revision < 0 ||
              typeof message.assetId !== "string" ||
              message.assetId.length > 4096
            ) {
              fail(
                "worker-public-asset-invalid",
                "The public worker asset is invalid.",
              );
              return;
            }
            if (
              (message.kind !== "bitmap" && message.kind !== "rgba16float") ||
              (message.kind === "bitmap" &&
                !(message.bitmap instanceof ImageBitmap)) ||
              (message.kind === "rgba16float" &&
                !(message.data instanceof ArrayBuffer)) ||
              (message.kind === "bitmap" &&
                message.sampleEncoding !== undefined &&
                message.sampleEncoding !== "srgb-color" &&
                message.sampleEncoding !== "linear-data") ||
              (message.kind === "rgba16float" && "sampleEncoding" in message)
            ) {
              fail(
                "worker-public-asset-invalid",
                "The public worker asset body is invalid.",
              );
              return;
            }
            const previous = pendingAssets.get(message.generation);
            if (!previous && pendingAssets.size >= 8) {
              fail(
                "worker-public-asset-limit",
                "The public worker has too many uncommitted asset generations.",
              );
              return;
            }
            const width =
              message.kind === "bitmap" ? message.bitmap?.width : message.width;
            const height =
              message.kind === "bitmap"
                ? message.bitmap?.height
                : message.height;
            const bytes =
              message.kind === "bitmap"
                ? width * height * 4
                : message.data?.byteLength;
            if (
              !Number.isSafeInteger(width) ||
              !Number.isSafeInteger(height) ||
              width <= 0 ||
              height <= 0 ||
              width > MAX_ASSET_DIMENSION ||
              height > MAX_ASSET_DIMENSION ||
              width * height > MAX_ASSET_PIXELS ||
              !Number.isSafeInteger(bytes) ||
              bytes <= 0 ||
              bytes > MAX_ASSET_BYTES ||
              (message.kind === "rgba16float" &&
                bytes !== width * height * 8) ||
              (previous?.count ?? 0) + 1 > MAX_ASSETS ||
              [...pendingAssets.values()].reduce(
                (total, value) => total + value.bytes,
                0,
              ) +
                bytes >
                MAX_ASSET_BYTES
            ) {
              fail(
                "worker-public-asset-limit",
                "The public worker asset exceeds its bounded limits.",
              );
              return;
            }
            pendingAssets.set(message.generation, {
              count: (previous?.count ?? 0) + 1,
              bytes: (previous?.bytes ?? 0) + bytes,
            });
            lease.post(
              internalMessage(message, internalSceneId),
              message.kind === "bitmap" ? [message.bitmap] : [message.data],
            );
            forwardedBitmap = message.kind === "bitmap";
            return;
          }
          if (message.type === "export" || message.type === "cancel-export") {
            if (message.type === "export") {
              if (
                !boundedExport(message) ||
                pendingExports.has(message.requestId) ||
                pendingExports.size >= MAX_EXPORTS
              ) {
                fail(
                  "worker-public-export-limit",
                  "The public worker has too many still captures.",
                );
                return;
              }
              pendingExports.add(message.requestId);
            } else pendingExports.delete(message.requestId);
          }
          if (message.type === "dispose") {
            lease.post(internalMessage(message, internalSceneId));
            disposeForwarded = true;
            closeLease();
            return;
          }
          if (
            !["visibility", "export", "cancel-export"].includes(message.type)
          ) {
            fail(
              "worker-public-message-invalid",
              "The public worker request is invalid.",
            );
            return;
          }
          lease.post(internalMessage(message, internalSceneId));
        } catch (error) {
          const issue =
            error instanceof NativePublicWorkerPreviewError
              ? error
              : new NativePublicWorkerPreviewError(
                  "worker-public-message-invalid",
                  "The public worker request could not be forwarded.",
                );
          fail(issue.code, issue.message);
        } finally {
          if (!forwardedBitmap) receivedBitmap?.close();
        }
      };
      candidate.start();
      candidate.postMessage({
        type: CONNECT,
        nonce: prepared.nonce,
        sceneId: childSceneId,
      });
    };
    void accept().catch((error: unknown) => {
      if (port === candidate) {
        const issue =
          error instanceof NativePublicWorkerPreviewError
            ? error
            : new NativePublicWorkerPreviewError(
                "worker-public-unavailable",
                "The public GPU worker is unavailable.",
              );
        fail(issue.code, issue.message);
      }
    });
  };
  host.addEventListener("message", onReady);
  frame.addEventListener("load", onLoad);
  cleanupByFrame.set(frame, cleanup);
  return cleanup;
}
