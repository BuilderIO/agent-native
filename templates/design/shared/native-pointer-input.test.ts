import { describe, expect, it } from "vitest";

import { POINTER_RUN_SORT_DEFINITIONS } from "./native-effect-owned-an-pointer-sort";
import { GRAIN_GRADIENT_EFFECT } from "./native-effect-presets";
import { packNativeProperties, type EffectDefinition } from "./native-effects";
import {
  NativePointerHistory,
  NativePointerHistoryError,
  sampleNativePointerHistory,
  validateNativePointerHistorySnapshot,
} from "./native-pointer-history";
import {
  mapNativePointerInput,
  packNativePointerProperties,
  resolveNativeFeedbackPointerInput,
  NativePointerInputError,
} from "./native-pointer-input";

const definition: EffectDefinition = {
  ...GRAIN_GRADIENT_EFFECT,
  interaction: {
    positionProperty: "pointerPosition",
    activeProperty: "pointerActive",
  },
  properties: {
    ...GRAIN_GRADIENT_EFFECT.properties,
    pointerPosition: {
      type: "vec2",
      label: "Pointer position",
      default: [0.25, 0.75],
      min: 0,
      max: 1,
    },
    pointerActive: {
      type: "bool",
      label: "Pointer active",
      default: false,
    },
  },
};

describe("native pointer input", () => {
  it("maps client coordinates through capture extent and effect transform", () => {
    const mapped = mapNativePointerInput({
      clientX: 100,
      clientY: 50,
      clientToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      targetSize: { width: 200, height: 100 },
      width: 300,
      height: 200,
      pixelRatio: 1,
      extent: { left: 50, top: 50, sourceWidth: 200, sourceHeight: 100 },
    });
    expect(mapped).toEqual({
      ok: true,
      pointer: { x: 0.5, y: 0.5, active: true },
    });
    const translated = mapNativePointerInput({
      clientX: 100,
      clientY: 50,
      clientToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      targetSize: { width: 200, height: 100 },
      width: 300,
      height: 200,
      pixelRatio: 1,
      extent: { left: 50, top: 50, sourceWidth: 200, sourceHeight: 100 },
      transform: { translate: [300, 0] },
    });
    expect(translated.ok && translated.pointer.active).toBe(false);
  });

  it("inverts rotated and skewed target geometry before mapping UVs", () => {
    const rotated = mapNativePointerInput({
      clientX: 80,
      clientY: 25,
      clientToTarget: { a: 0, b: -1, c: 1, d: 0, e: 0, f: 100 },
      targetSize: { width: 100, height: 100 },
      width: 100,
      height: 100,
      pixelRatio: 1,
    });
    expect(rotated).toEqual({
      ok: true,
      pointer: { x: 0.25, y: 0.2, active: true },
    });
    const skewed = mapNativePointerInput({
      clientX: 75,
      clientY: 50,
      clientToTarget: { a: 1, b: 0, c: -0.5, d: 1, e: 0, f: 0 },
      targetSize: { width: 100, height: 100 },
      width: 100,
      height: 100,
      pixelRatio: 1,
    });
    expect(skewed).toEqual({
      ok: true,
      pointer: { x: 0.5, y: 0.5, active: true },
    });
    expect(
      mapNativePointerInput({
        clientX: 75,
        clientY: 50,
        clientToTarget: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        targetSize: { width: 0, height: 100 },
        width: 100,
        height: 100,
        pixelRatio: 1,
      }).ok,
    ).toBe(false);
  });

  it("overrides only opted slots in live frames and preserves authored deterministic values", () => {
    const params = { pointerPosition: [0.25, 0.75] as [number, number] };
    const authored = packNativeProperties(definition, params);
    const live = packNativePointerProperties(
      definition,
      params,
      { x: 0.8, y: 0.2, active: true },
      false,
    );
    expect(Array.from(live.slice(0, 20))).toEqual(
      Array.from(authored.slice(0, 20)),
    );
    expect(Array.from(live.slice(20, 25))).toEqual([
      Math.fround(0.8),
      Math.fround(0.2),
      0,
      0,
      1,
    ]);
    expect(
      packNativePointerProperties(
        definition,
        params,
        { x: 0.8, y: 0.2, active: true },
        true,
      ),
    ).toEqual(authored);
    expect(params).toEqual({ pointerPosition: [0.25, 0.75] });
    expect(() =>
      packNativePointerProperties(
        definition,
        params,
        { x: Number.NaN, y: 0.2, active: true },
        false,
      ),
    ).toThrow(NativePointerInputError);
  });

  it("resolves authored feedback cursors for export and live motion only from mapped input", () => {
    const feedback = POINTER_RUN_SORT_DEFINITIONS[0];
    const params = {
      cursorPosition: [0.3, 0.6] as [number, number],
      cursorActive: true,
    };
    expect(
      resolveNativeFeedbackPointerInput(
        feedback,
        params,
        { x: 0.9, y: 0.1, active: true },
        true,
        { x: 0.2, y: 0.2, active: true },
      ),
    ).toEqual({ x: 0.3, y: 0.6, dx: 0, dy: 0, active: true });
    expect(
      resolveNativeFeedbackPointerInput(
        feedback,
        params,
        { x: 0.6, y: 0.45, active: true },
        false,
        { x: 0.5, y: 0.5, active: true },
      ),
    ).toEqual({
      x: 0.6,
      y: 0.45,
      dx: expect.closeTo(0.1),
      dy: expect.closeTo(-0.05),
      active: true,
    });
    expect(
      resolveNativeFeedbackPointerInput(
        feedback,
        params,
        { x: 1.3, y: 0.45, active: false },
        false,
        null,
      ),
    ).toEqual({ x: 0.3, y: 0.6, dx: 0, dy: 0, active: false });
  });
});

describe("bounded native pointer history", () => {
  it("replays active, motion positions, and leave at fixed-step timestamps", () => {
    const history = new NativePointerHistory(0);
    history.record(0.04, { x: 0.2, y: 0.3, active: true });
    history.record(0.08, { x: 0.7, y: 0.3, active: true });
    history.record(0.12, { x: 0.7, y: 0.3, active: false });
    const snapshot = history.snapshot(0, 0.14, 0.15);
    validateNativePointerHistorySnapshot(snapshot, 0, 0.14);
    const initial = { x: 0.5, y: 0.5, active: false };
    expect(sampleNativePointerHistory(snapshot, 0, initial)).toEqual(initial);
    expect(sampleNativePointerHistory(snapshot, 0.05, initial)).toEqual({
      x: 0.2,
      y: 0.3,
      active: true,
    });
    expect(sampleNativePointerHistory(snapshot, 0.09, initial)).toEqual({
      x: 0.7,
      y: 0.3,
      active: true,
    });
    expect(sampleNativePointerHistory(snapshot, 0.14, initial)).toEqual({
      x: 0.7,
      y: 0.3,
      active: false,
    });
  });

  it("distinguishes known authored-static input from missing or invalidated live history", () => {
    const staticHistory = new NativePointerHistory(0);
    expect(staticHistory.snapshot(0, 1, 1)).toEqual({
      mode: "authored-static",
    });
    staticHistory.invalidate();
    staticHistory.reset(0);
    expect(staticHistory.snapshot(0, 1, 1)).toEqual({
      mode: "authored-static",
    });
    const history = new NativePointerHistory(0);
    history.record(0.5, { x: 0.3, y: 0.5, active: true });
    expect(() => history.snapshot(0, 2, 1)).toThrow(NativePointerHistoryError);
    history.invalidate();
    expect(() => history.snapshot(0, 1, 1)).toThrow(NativePointerHistoryError);
    history.reset(0);
    expect(() => history.snapshot(0, 1, 1)).toThrow(NativePointerHistoryError);
    const unreadableInput = new NativePointerHistory(0);
    unreadableInput.invalidate(true);
    expect(() => unreadableInput.snapshot(0, 1, 1)).toThrow(
      NativePointerHistoryError,
    );
  });
});
