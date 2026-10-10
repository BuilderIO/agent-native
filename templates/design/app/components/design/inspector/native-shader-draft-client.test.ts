// @vitest-environment happy-dom

import type { NativeDraftPreviewRequest } from "@shared/native-draft-preview-contract";
import { afterEach, expect, it, vi } from "vitest";

import {
  findNativeDraftFrame,
  NativeDraftClientError,
  readNativeDraftPreviewResult,
  sendNativeDraftMessage,
} from "./native-shader-draft-client";

const hash = "a".repeat(64);
const request: NativeDraftPreviewRequest = {
  type: "native-shader-draft-preview",
  schemaVersion: 1,
  requestId: "lab_1",
  runtimeEpoch: "runtime_1",
  instanceId: "instance-1",
  nodeId: "node-1",
  baseExecutionHash: hash,
  expectedExecutionHash: hash,
  draftDefinition: {} as NativeDraftPreviewRequest["draftDefinition"],
  params: {},
  seed: 1,
  time: 0,
};

const ready = {
  type: "native-shader-draft-result",
  schemaVersion: 1,
  requestId: request.requestId,
  runtimeEpoch: request.runtimeEpoch,
  instanceId: request.instanceId,
  executionHash: hash,
  status: "ready",
  displayed: "draft-current",
  diagnostics: [],
  timings: { compileWallMs: 4.2, renderWallMs: 2.1 },
} as const;

function emit(source: Window, origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source, origin, data }));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("rejects malformed or impossible draft results", () => {
  expect(readNativeDraftPreviewResult(ready)).toEqual(ready);
  expect(
    readNativeDraftPreviewResult({
      ...ready,
      status: "last-good",
      displayed: "draft-current",
    }),
  ).toBeNull();
  expect(
    readNativeDraftPreviewResult({
      ...ready,
      diagnostics: [
        { code: "wgsl", message: "x".repeat(501), severity: "error" },
      ],
    }),
  ).toBeNull();
  expect(
    readNativeDraftPreviewResult({
      ...ready,
      timings: { renderWallMs: Number.NaN },
    }),
  ).toBeNull();
});

it("waits for a terminal result from only the exact frame, origin, and request", async () => {
  const target = { postMessage: vi.fn() } as unknown as Window;
  const other = { postMessage: vi.fn() } as unknown as Window;
  const pending = vi.fn();
  const result = sendNativeDraftMessage({
    targetWindow: target,
    message: request,
    onPending: pending,
  });
  expect(target.postMessage).toHaveBeenCalledWith(
    request,
    window.location.origin,
  );
  emit(other, window.location.origin, ready);
  emit(target, "https://wrong.example", ready);
  emit(target, window.location.origin, { ...ready, requestId: "old" });
  emit(target, window.location.origin, {
    ...ready,
    status: "pending",
    displayed: "published",
  });
  expect(pending).toHaveBeenCalledOnce();
  emit(target, window.location.origin, ready);
  await expect(result).resolves.toEqual(ready);
});

it("rejects a matching but unreadable reply instead of claiming a timeout", async () => {
  const target = { postMessage: vi.fn() } as unknown as Window;
  const result = sendNativeDraftMessage({
    targetWindow: target,
    message: request,
  });
  emit(target, window.location.origin, { ...ready, diagnostics: "bad" });
  await expect(result).rejects.toMatchObject({ code: "reply-unreadable" });
});

it("cancels an in-flight request and rejects a later response", async () => {
  const target = { postMessage: vi.fn() } as unknown as Window;
  const controller = new AbortController();
  const result = sendNativeDraftMessage({
    targetWindow: target,
    message: request,
    signal: controller.signal,
  });
  controller.abort();
  emit(target, window.location.origin, ready);
  await expect(result).rejects.toMatchObject({ code: "request-aborted" });
});

it("rejects missing and ambiguous preview frames", () => {
  expect(() => findNativeDraftFrame("screen-1")).toThrow(
    NativeDraftClientError,
  );
  for (let index = 0; index < 2; index++) {
    const frame = document.createElement("iframe");
    frame.dataset.designPreviewIframe = "";
    frame.dataset.screenIframeId = "screen-1";
    document.body.append(frame);
  }
  expect(() => findNativeDraftFrame("screen-1")).toThrow(
    NativeDraftClientError,
  );
  document.body.lastElementChild?.remove();
  expect(findNativeDraftFrame("screen-1")).toBeInstanceOf(HTMLIFrameElement);
});

it("targets the unique board surface only when the authoritative file is the board", () => {
  const layer = document.createElement("div");
  layer.dataset.boardSurfaceLayer = "";
  const board = document.createElement("iframe");
  board.dataset.designPreviewIframe = "";
  layer.append(board);
  document.body.append(layer);

  expect(() => findNativeDraftFrame("board-file-id")).toThrow(
    NativeDraftClientError,
  );
  expect(findNativeDraftFrame("board-file-id", true)).toBe(board);

  const secondLayer = layer.cloneNode(true);
  document.body.append(secondLayer);
  expect(() => findNativeDraftFrame("board-file-id", true)).toThrow(
    NativeDraftClientError,
  );
});
