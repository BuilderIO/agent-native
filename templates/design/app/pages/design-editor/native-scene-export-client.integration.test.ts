// @vitest-environment jsdom

import { Blob as NodeBlob } from "node:buffer";
import { CompressionStream as NodeCompressionStream } from "node:stream/web";
import { inflateSync } from "node:zlib";

import { callAction } from "@agent-native/core/client/hooks";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PARTICLE_FLOW_EFFECT } from "../../../shared/native-effect-particle-flow";
import { writeEffectsToHtml } from "../../../shared/native-effects";
import {
  renderSelectedNativeCodePackage,
  renderSelectedNativeSceneBlob,
  type NativePixelRuntime,
} from "./native-scene-export-client";

vi.mock("@agent-native/core/client/hooks", () => ({ callAction: vi.fn() }));

const rgba = Uint8Array.from([187, 31, 203, 128, 11, 157, 43, 0]);
const viewport = { width: 2, height: 1 };
const instance = {
  id: "effect-1",
  nodeId: "selected-node",
  definitionId: PARTICLE_FLOW_EFFECT.id,
  definitionVersion: PARTICLE_FLOW_EFFECT.version,
  placement: "fill" as const,
  params: { quality: "low" },
  enabled: true,
  opacity: 1,
  seed: 73,
  clip: "bounds" as const,
  blend: "normal" as const,
  timing: { speed: 1, paused: true, time: 0 },
};
const html = writeEffectsToHtml(
  '<!doctype html><html><head><title>Owned scene</title><script data-agent-native-native-shader-runtime data-agent-native-export-initial-pixel-ratio="1" nonce="YWJj"></script></head><body><main data-agent-native-node-id="selected-node"></main></body></html>',
  {
    schemaVersion: 2,
    definitions: [PARTICLE_FLOW_EFFECT],
    instances: [instance],
  },
);
const prepared = {
  designId: "design-1",
  fileId: "file-1",
  viewport,
  initialPixelRatio: 1,
  html,
  approvedDefinitionHashes: [],
  instanceTargets: [{ instanceId: instance.id, nodeId: instance.nodeId }],
  sourceVersions: [
    { fileId: "file-1", filename: "index.html", versionHash: "v1" },
  ],
  localQaSinkEnabled: false,
};
const args = {
  designId: "design-1",
  fileId: "file-1",
  viewport,
  pixelRatio: 1,
  expectedVersionHash: "v1",
};

function decodePng(bytes: Uint8Array): Uint8Array {
  const png = Buffer.from(bytes);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (type === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset = end;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  expect([...raw]).toEqual([0, ...rgba]);
  return Uint8Array.from(raw.subarray(1));
}

function preparedFrame() {
  vi.mocked(callAction).mockResolvedValue(prepared);
  const runtime: NativePixelRuntime = {
    scan: vi.fn(async () => {}),
    beginSimulationExportSession: vi.fn(async () => ({ sessionId: "held-1" })),
    endSimulationExportSession: vi.fn(async () => {}),
    renderCompositionFramePixels: vi.fn(async () => ({
      width: 2,
      height: 1,
      colorSpace: "srgb" as const,
      alpha: "straight" as const,
      rgba: rgba.slice(),
    })),
  };
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement) {
      const frame = node;
      const target = frame.contentWindow;
      expect(target).not.toBeNull();
      Object.assign(target!, { __anNativeShaders: runtime });
      vi.spyOn(target!, "postMessage").mockImplementation((message) => {
        if (message.type !== "native-shader-status-request") return;
        queueMicrotask(() =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: target,
              origin: window.location.origin,
              data: {
                type: "native-shader-status",
                schemaVersion: 1,
                runtimeEpoch: "test-epoch",
                requestId: message.requestId,
                instanceId: instance.id,
                nodeId: instance.nodeId,
                status: "ready",
                backend: "webgpu",
                frames: 1,
                sourceCaptures: 1,
                estimatedResourceBytes: 8,
              },
            }),
          ),
        );
      });
      queueMicrotask(() => node.dispatchEvent(new Event("load")));
    }
    return result;
  }) as typeof document.body.appendChild);
  return runtime;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("CompressionStream", NodeCompressionStream);
});

describe("selected native straight PNG exports", () => {
  it("preserves exact partial-alpha and transparent RGB in the selected PNG", async () => {
    const runtime = preparedFrame();
    const png = await renderSelectedNativeSceneBlob({ ...args, format: "png" });
    expect(png.type).toBe("image/png");
    expect([...decodePng(new Uint8Array(await png.arrayBuffer()))]).toEqual([
      ...rgba,
    ]);
    expect(runtime.renderCompositionFramePixels).toHaveBeenCalledOnce();
    expect(callAction).toHaveBeenCalledWith(
      "prepare-native-scene-export",
      expect.objectContaining({ pixelRatio: 1 }),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses the same exact straight pixels for the public code package poster", async () => {
    const runtime = preparedFrame();
    const packageBlob = await renderSelectedNativeCodePackage(args);
    const zip = await JSZip.loadAsync(
      Buffer.from(await packageBlob.arrayBuffer()),
    );
    const poster = await zip.file("design-preview.png")!.async("uint8array");
    expect([...decodePng(poster)]).toEqual([...rgba]);
    expect(runtime.renderCompositionFramePixels).toHaveBeenCalledOnce();
  });

  it.each(["png", "package"] as const)(
    "maps missing PNG compression to a typed %s export error",
    async (kind) => {
      preparedFrame();
      vi.stubGlobal("CompressionStream", undefined);
      const exportWork =
        kind === "png"
          ? renderSelectedNativeSceneBlob({ ...args, format: "png" })
          : renderSelectedNativeCodePackage(args);
      await expect(exportWork).rejects.toMatchObject({
        code: "pixels-unreadable",
      });
    },
  );
});
