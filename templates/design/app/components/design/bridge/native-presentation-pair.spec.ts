// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  isNativePresentationPairSwap,
  canDetachPresentationFromSources,
  NativePresentationPair,
} from "./native-presentation-pair";

afterEach(() => document.body.replaceChildren());

type FakeSurface = {
  canvas: HTMLCanvasElement;
  context: { pixels: Uint8Array; error: boolean };
};
const surface = (pixels: number[]): FakeSurface => ({
  canvas: document.createElement("canvas"),
  context: { pixels: Uint8Array.from(pixels), error: false },
});
const bytes = (surface: FakeSurface) => [...surface.context.pixels];

describe("two-surface presentation transaction", () => {
  it("keeps the visible pixels after submitted hidden work fails validation", async () => {
    const first = surface([9, 8, 7, 255]);
    first.canvas.width = 4;
    first.canvas.height = 3;
    first.canvas.style.left = "11px";
    document.body.append(first.canvas);
    const retired: FakeSurface[] = [];
    const pair = new NativePresentationPair(
      first,
      () => surface([0, 0, 0, 0]),
      (entry) => retired.push(entry),
    );
    const visibleBefore = pair.visible();
    const hidden = pair.prepare();
    expect(hidden.canvas.isConnected).toBe(false);
    expect(hidden.canvas.width).toBe(4);
    expect(hidden.canvas.height).toBe(3);
    expect(hidden.canvas.style.left).toBe("11px");
    hidden.context.pixels.set([50, 40, 30, 255]);
    hidden.context.error = true;
    const validation = Promise.resolve(
      hidden.context.error ? new Error("gpu-validation") : null,
    );
    expect(await validation).toBeInstanceOf(Error);
    expect(pair.visible()).toBe(visibleBefore);
    expect(document.body.firstElementChild).toBe(first.canvas);
    expect(bytes(first)).toEqual([9, 8, 7, 255]);
    expect(bytes(hidden)).toEqual([50, 40, 30, 255]);
    pair.dispose();
    expect(retired).toEqual([hidden]);
  });

  it("publishes exactly once after validation and refuses stale epoch or duplicate commit", async () => {
    const first = surface([1, 2, 3, 255]);
    document.body.append(first.canvas);
    const pair = new NativePresentationPair(
      first,
      () => surface([0, 0, 0, 0]),
      () => {},
    );
    const old = pair.visible();
    const hidden = pair.prepare();
    hidden.context.pixels.set([4, 5, 6, 255]);
    let epoch = 7;
    const captured = epoch;
    expect(await Promise.resolve(null)).toBeNull();
    expect(epoch).toBe(captured);
    pair.publish(old, hidden);
    expect(document.body.firstElementChild).toBe(hidden.canvas);
    expect(bytes(pair.visible())).toEqual([4, 5, 6, 255]);
    expect(bytes(old)).toEqual([1, 2, 3, 255]);
    expect(() => pair.publish(old, hidden)).toThrow("presentation-pair-stale");
    const nextHidden = pair.prepare();
    nextHidden.context.pixels.set([11, 12, 13, 255]);
    epoch = 8;
    expect(epoch).not.toBe(captured);
    expect(bytes(pair.visible())).toEqual([4, 5, 6, 255]);
    expect(document.body.firstElementChild).toBe(hidden.canvas);
  });

  it("refuses a disconnected front before staging or publishing", () => {
    const first = surface([1, 1, 1, 255]);
    document.body.append(first.canvas);
    const pair = new NativePresentationPair(
      first,
      () => surface([0, 0, 0, 0]),
      () => {},
    );
    const hidden = pair.prepare();
    first.canvas.remove();
    expect(() => pair.publish(first, hidden)).toThrow(
      "presentation-pair-dom-stale",
    );
    expect(() => pair.prepare()).toThrow("presentation-front-disconnected");
  });

  it("recognizes only the exact committed canvas swap as runtime-owned", async () => {
    const first = surface([1, 2, 3, 255]);
    document.body.append(first.canvas);
    const pair = new NativePresentationPair(
      first,
      () => surface([0, 0, 0, 0]),
      () => {},
    );
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) =>
      records.push(...mutations),
    );
    observer.observe(document.body, { childList: true });
    const hidden = pair.prepare();
    pair.publish(first, hidden);
    await Promise.resolve();
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(
      records.every((record) => isNativePresentationPairSwap(record, pair)),
    ).toBe(true);
    const authored = document.createElement("div");
    document.body.append(authored);
    await Promise.resolve();
    expect(
      isNativePresentationPairSwap(records[records.length - 1]!, pair),
    ).toBe(false);
    observer.disconnect();
  });
});

it("detached presentation refuses authored live and nested native sources", () => {
  expect(canDetachPresentationFromSources([])).toBe(true);
  expect(canDetachPresentationFromSources([{ kind: "image" }])).toBe(true);
  expect(canDetachPresentationFromSources([{ kind: "text" }])).toBe(true);
  for (const record of [
    { kind: "video" },
    { kind: "canvas" },
    { kind: "native", nativeInstanceId: "child" },
    { kind: "image", nativeInstanceId: "child" },
  ])
    expect(canDetachPresentationFromSources([{ kind: "text" }, record])).toBe(
      false,
    );
});
