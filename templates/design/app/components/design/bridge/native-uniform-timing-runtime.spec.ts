// @vitest-environment happy-dom
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PARTICLE_FLOW_EFFECT } from "../../../../shared/native-effect-particle-flow";
import { GRAIN_GRADIENT_EFFECT } from "../../../../shared/native-effect-presets";
import type { EffectInstance } from "../../../../shared/native-effects";

type Runtime = {
  effectPasses(...args: unknown[]): Promise<unknown>;
  simulationPasses(...args: unknown[]): Promise<unknown>;
  renderInternal(time: number, deterministic: boolean): Promise<unknown>;
  setTime(time: number): Promise<void>;
  renderAt(time: number): Promise<unknown>;
  markMountRenderPending(mount: unknown): void;
  assertCompositionIdle(): void;
  mounts: Map<string, unknown>;
  playing: boolean;
  timeOverride: number | null;
  raf: number;
  dispose(): void;
};
let runtime: Runtime;
const ready = Object.getOwnPropertyDescriptor(document, "readyState");
const script = Object.getOwnPropertyDescriptor(document, "currentScript");
beforeAll(async () => {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => "loading",
  });
  const entry = document.createElement("script");
  document.body.append(entry);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    value: entry,
  });
  const built = await build({
    entryPoints: [
      new URL("./native-shader-runtime.bridge.ts", import.meta.url).pathname,
    ],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  new Function(built.outputFiles[0]!.text)();
  runtime = (window as unknown as { __anNativeShaders: Runtime })
    .__anNativeShaders;
});
afterAll(() => {
  runtime.mounts.clear();
  runtime.dispose();
  document.body.replaceChildren();
  for (const [name, descriptor] of [
    ["readyState", ready],
    ["currentScript", script],
  ] as const) {
    if (descriptor) Object.defineProperty(document, name, descriptor);
    else Reflect.deleteProperty(document, name);
  }
  vi.restoreAllMocks();
});
function instance(time = 0, speed = 1): EffectInstance {
  return {
    id: "timed",
    nodeId: "hero",
    definitionId: GRAIN_GRADIENT_EFFECT.id,
    definitionVersion: GRAIN_GRADIENT_EFFECT.version,
    placement: "fill",
    params: {},
    enabled: true,
    opacity: 1,
    seed: 2026,
    clip: "bounds",
    blend: "normal",
    timing: { time, speed, paused: false },
  };
}
describe("native runtime timing preflight", () => {
  it.each(["effectPasses", "simulationPasses"] as const)(
    "%s rejects local time, authored offset, and speed without accessing a GPU",
    async (method) => {
      for (const [time, offset, speed, field] of [
        [1e40, 0, 1, "time"],
        [1, 1e40, 1, "initial-time"],
        [1, 0, 1e40, "speed"],
        [2e38 * 2, 0, 2e38, "time"],
      ] as const) {
        const definition =
          method === "simulationPasses"
            ? PARTICLE_FLOW_EFFECT
            : GRAIN_GRADIENT_EFFECT;
        const value = {
          ...instance(offset, speed),
          definitionId: definition.id,
          definitionVersion: definition.version,
        };
        const mount = { instance: value, definition };
        await expect(
          runtime[method](mount, {}, time, {}, definition, value, true),
        ).rejects.toMatchObject({
          name: "NativeUniformTimingError",
          code: "native-uniform-timing-invalid",
          field,
        });
      }
    },
  );

  it("rejects a top-level f32-overflow time before a device is requested", async () => {
    await expect(runtime.renderInternal(1e40, true)).rejects.toMatchObject({
      code: "native-uniform-timing-invalid",
      field: "time",
    });
  });

  it("preflights every derived local clock before changing playback or earlier mounts", async () => {
    const first = {
      instance: instance(),
      clock: { global: 0, local: 0, speed: 1, paused: false },
    };
    const second = {
      instance: instance(2e38, 2e38),
      clock: { global: 0, local: 2e38, speed: 2e38, paused: false },
    };
    runtime.mounts.set("first", first);
    runtime.mounts.set("second", second);
    const before = {
      first: structuredClone(first.clock),
      second: structuredClone(second.clock),
      playing: runtime.playing,
      timeOverride: runtime.timeOverride,
      raf: runtime.raf,
    };
    const render = vi.spyOn(runtime, "renderAt").mockResolvedValue({});
    const pending = vi
      .spyOn(runtime, "markMountRenderPending")
      .mockImplementation(() => {});
    await expect(runtime.setTime(1)).rejects.toMatchObject({
      code: "native-uniform-timing-invalid",
      field: "time",
    });
    expect(first.clock).toEqual(before.first);
    expect(second.clock).toEqual(before.second);
    expect(runtime.playing).toBe(before.playing);
    expect(runtime.timeOverride).toBe(before.timeOverride);
    expect(runtime.raf).toBe(before.raf);
    expect(render).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    runtime.mounts.delete("second");
    await runtime.setTime(0.25);
    expect(first.clock).toEqual({
      global: 0.25,
      local: 0.25,
      speed: 1,
      paused: false,
    });
    expect(render).toHaveBeenCalledWith(0.25);
    expect(pending).toHaveBeenCalledWith(first);
    runtime.mounts.clear();
  });
});
