import { describe, expect, it } from "vitest";

import type { NativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { planNativeSceneFrame } from "./native-effect-frame-policy";

function mount(
  animationCapability: NativeEffectAnimationCapability,
  options: { paused?: boolean; speed?: number; liveSource?: boolean } = {},
) {
  return {
    animationCapability,
    clock: { paused: options.paused ?? false, speed: options.speed ?? 1 },
    provider: { needsContinuousFrames: () => options.liveSource ?? false },
  };
}
function plan(
  mounts: ReturnType<typeof mount>[],
  options: {
    playing?: boolean;
    draftPlaying?: boolean | null;
    benchmarkActive?: boolean;
    previewDirty?: boolean;
    renderBusy?: boolean;
  } = {},
) {
  return planNativeSceneFrame(
    mounts,
    options.playing ?? true,
    options.draftPlaying ?? null,
    options.benchmarkActive ?? false,
    options.previewDirty ?? false,
    options.renderBusy ?? false,
  );
}

describe("native scene RAF policy", () => {
  it("submits a requested static frame but does not keep an all-static scene spinning", () => {
    expect(plan([mount("static"), mount("static", { speed: 2 })])).toEqual({
      enter: true,
      scheduleNext: false,
      maySubmit: true,
    });
  });

  it("preserves video, authored animation, and late play in a static provider", () => {
    let playing = false;
    const source = {
      animationCapability: "static" as const,
      clock: { paused: false, speed: 1 },
      provider: { needsContinuousFrames: () => playing },
    };
    expect(plan([source]).scheduleNext).toBe(false);
    playing = true;
    expect(plan([source]).scheduleNext).toBe(true);
  });

  it("keeps a static parent and animated native child rendering together", () => {
    expect(plan([mount("static"), mount("animated")]).scheduleNext).toBe(true);
  });

  it("treats unreviewed custom definitions conservatively", () => {
    expect(plan([mount("unknown")]).scheduleNext).toBe(true);
    expect(plan([mount("unknown", { paused: true })]).scheduleNext).toBe(false);
    expect(plan([mount("unknown", { speed: 0 })]).scheduleNext).toBe(false);
  });

  it("retries a dirty static frame until an in-flight render completes", () => {
    const scene = [mount("static")];
    expect(plan(scene, { previewDirty: true, renderBusy: true })).toEqual({
      enter: true,
      scheduleNext: true,
      maySubmit: false,
    });
    expect(plan(scene, { previewDirty: true })).toEqual({
      enter: true,
      scheduleNext: true,
      maySubmit: true,
    });
    expect(plan(scene).scheduleNext).toBe(false);
  });

  it("retries a paused scene after a source event without advancing its animation clock", () => {
    const scene = [mount("animated")];
    expect(plan(scene, { playing: false })).toEqual({
      enter: false,
      scheduleNext: false,
      maySubmit: false,
    });
    expect(
      plan(scene, { playing: false, previewDirty: true, renderBusy: true }),
    ).toEqual({ enter: true, scheduleNext: true, maySubmit: false });
    expect(plan(scene, { playing: false, previewDirty: true })).toEqual({
      enter: true,
      scheduleNext: true,
      maySubmit: true,
    });
  });

  it("retries paused drafts at fixed time without advancing unrelated animated mounts", () => {
    const scene = [mount("animated")];
    expect(plan(scene, { draftPlaying: false })).toEqual({
      enter: false,
      scheduleNext: false,
      maySubmit: false,
    });
    expect(
      plan(scene, {
        draftPlaying: false,
        previewDirty: true,
        renderBusy: true,
      }),
    ).toEqual({
      enter: true,
      scheduleNext: true,
      maySubmit: false,
    });
    expect(
      plan(scene, { draftPlaying: false, previewDirty: true }).maySubmit,
    ).toBe(true);
    expect(plan(scene, { draftPlaying: true }).scheduleNext).toBe(true);
  });

  it("keeps a paused draft live for moving source media and a mounted benchmark", () => {
    expect(
      plan([mount("static", { liveSource: true })], { draftPlaying: false })
        .scheduleNext,
    ).toBe(true);
    expect(
      plan([mount("static")], { draftPlaying: false, benchmarkActive: true })
        .scheduleNext,
    ).toBe(true);
  });
});
