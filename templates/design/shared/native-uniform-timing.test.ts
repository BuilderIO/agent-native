import { describe, expect, it } from "vitest";

import { editNativeEffectHtml } from "./native-effect-edits";
import { GRAIN_GRADIENT_EFFECT } from "./native-effect-presets";
import {
  parseEffectsFromHtml,
  validateEffectDocument,
  writeEffectsToHtml,
  type EffectDocument,
} from "./native-effects";
import {
  assertNativeUniformTiming,
  isFiniteNativeUniformTiming,
  NativeUniformTimingError,
  packNativeUniformClock,
} from "./native-uniform-timing";

const maximumF32 = (2 - 2 ** -23) * 2 ** 127;
const overflowMidpoint = 2 ** 128 - 2 ** 103;
const html =
  '<html><body><div data-agent-native-node-id="hero">Timing</div></body></html>';
const instance = {
  id: "timed",
  nodeId: "hero",
  definitionId: GRAIN_GRADIENT_EFFECT.id,
  definitionVersion: GRAIN_GRADIENT_EFFECT.version,
  placement: "fill" as const,
  params: {},
  enabled: true,
  opacity: 1,
  seed: 2026,
  clip: "bounds" as const,
  blend: "normal" as const,
  timing: { time: 0, speed: 1, paused: false },
};
function document(): EffectDocument {
  return {
    schemaVersion: 2,
    definitions: [GRAIN_GRADIENT_EFFECT],
    instances: [structuredClone(instance)],
    presets: [
      {
        id: "timed-preset",
        name: "Timed",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
        placement: "fill",
        params: {},
        clip: "bounds",
        timing: { time: 0, speed: 1, paused: false },
        provenance: { origin: "user-authored" },
      },
    ],
  };
}

describe("finite f32 native timing", () => {
  it.each([
    0,
    Number.MIN_VALUE,
    2 ** -149,
    0.1,
    1e20,
    maximumF32,
    maximumF32 + 2 ** 102,
    overflowMidpoint - 2 ** 75,
  ])(
    "retains finite packable value %s without changing authored precision",
    (value) => {
      expect(isFiniteNativeUniformTiming(value)).toBe(true);
      expect(() => assertNativeUniformTiming(value, "time")).not.toThrow();
      expect(
        packNativeUniformClock({ time: value, seed: 2026, pixelRatio: 1.3 }),
      ).toEqual(new Float32Array([value, 2026, 1.3, 0]));
      const authored = document();
      authored.instances[0]!.timing.time = value;
      authored.presets![0]!.timing!.time = value;
      expect(validateEffectDocument(authored).errors).toEqual([]);
      expect(
        parseEffectsFromHtml(writeEffectsToHtml(html, authored)).document,
      ).toEqual(authored);
    },
  );

  it("retains signed zero at packing while preserving existing JSON wire semantics", () => {
    expect(
      Object.is(
        packNativeUniformClock({ time: -0, seed: 1, pixelRatio: 1 })[0],
        -0,
      ),
    ).toBe(true);
    const authored = document();
    authored.instances[0]!.timing.time = -0;
    const parsed = parseEffectsFromHtml(
      writeEffectsToHtml(html, authored),
    ).document;
    expect(Object.is(parsed!.instances[0]!.timing.time, 0)).toBe(true);
  });

  it.each([overflowMidpoint, 1e40, Number.MAX_VALUE, Infinity, -Infinity, NaN])(
    "rejects unrepresentable value %s with a typed field",
    (value) => {
      expect(isFiniteNativeUniformTiming(value)).toBe(false);
      for (const field of [
        "time",
        "speed",
        "step-time",
        "initial-time",
        "delta-time",
      ] as const) {
        try {
          assertNativeUniformTiming(value, field);
          throw new Error("missing failure");
        } catch (error) {
          expect(error).toBeInstanceOf(NativeUniformTimingError);
          expect(error).toMatchObject({
            code: "native-uniform-timing-invalid",
            field,
          });
        }
      }
      expect(() =>
        packNativeUniformClock({ time: value, seed: 1, pixelRatio: 1 }),
      ).toThrow(NativeUniformTimingError);
      expect(() =>
        packNativeUniformClock({
          time: 1,
          seed: 1,
          pixelRatio: 1,
          deltaTime: value,
        }),
      ).toThrow(NativeUniformTimingError);
    },
  );

  it.each([null, undefined, "1", {}, true])("rejects nonnumber %s", (value) => {
    expect(isFiniteNativeUniformTiming(value)).toBe(false);
  });

  it("does not treat explicit malformed delta time as an omitted default", () => {
    expect(() =>
      packNativeUniformClock({
        time: 1,
        seed: 1,
        pixelRatio: 1,
        deltaTime: null as unknown as number,
      }),
    ).toThrow(NativeUniformTimingError);
  });

  it.each(["time", "speed"] as const)(
    "rejects persisted instance and preset %s",
    (field) => {
      const authored = document();
      authored.instances[0]!.timing[field] = 1e40;
      authored.presets![0]!.timing![field] = 1e40;
      expect(validateEffectDocument(authored)).toMatchObject({
        valid: false,
        errors: [
          "instance[0].timing is invalid",
          "preset[0].timing is invalid",
        ],
      });
    },
  );

  it.each(["time", "speed"] as const)(
    "keeps source unchanged when a playback edit exceeds f32 %s",
    (field) => {
      const authored = writeEffectsToHtml(html, document());
      const result = editNativeEffectHtml(authored, {
        kind: "playback",
        instanceId: "timed",
        [field]: 1e40,
      });
      expect(result.html).toBe(authored);
      expect(result.errors).toContain("instance[0].timing is invalid");
    },
  );

  it("keeps existing nonnegative authored timing semantics", () => {
    const authored = document();
    authored.instances[0]!.timing.time = -1;
    authored.presets![0]!.timing!.speed = -1;
    expect(validateEffectDocument(authored).valid).toBe(false);
    expect(isFiniteNativeUniformTiming(-1)).toBe(true);
  });
});
