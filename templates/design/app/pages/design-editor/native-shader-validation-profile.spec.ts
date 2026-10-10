import { nativeShaderValidationSceneProfileSchema } from "@shared/native-shader-validation";
import { describe, expect, it } from "vitest";

import { readMountedSceneProfile } from "./native-shader-validation-profile";

const stats = { count: 3, p50: 2, p95: 4, p99: 4, max: 4 };

function runtime() {
  return {
    profile: () => ({
      renderWallMs: stats,
      rafIntervalMs: { count: 2, p50: 16, p95: 18, p99: 18, max: 18 },
      gpu: {
        kind: "ready",
        frameIndex: 9,
        passCount: 1,
        gpuPassSumMs: 1.25,
        passes: [{ label: "main", gpuMs: 1.25 }],
        estimatedResourceBytes: 2048,
      },
      textures: {
        allocatedBytes: 8192,
        mountedBytes: 4096,
        queuedRetirementBytes: 1024,
        inFlightRetirementBytes: 0,
        sharedBytes: 512,
        unattributedBytes: 2560,
        mounts: [{ id: "private-source", graphBytes: 4096 }],
        omittedMounts: 0,
      },
      source: "private WGSL must not leave the frame",
    }),
    previewStatus: () => ({
      requestedQuality: "auto",
      frameRateTarget: 60,
      devicePixelRatio: 2,
      effectivePixelRatio: 1.5,
      targetFrameIntervalMs: 16.67,
    }),
  };
}

describe("mounted native validation profile", () => {
  it("returns bounded rolling scene metrics and excludes mount IDs and source", () => {
    const measured = readMountedSceneProfile(runtime());
    expect(measured).toMatchObject({
      state: "available",
      scope: "mounted-scene",
      sampleWindow: "rolling-120-render/raf",
      renderWallMs: stats,
      preview: { effectivePixelRatio: 1.5, frameRateTarget: 60 },
      gpu: { kind: "ready", gpuPassSumMs: 1.25, passCount: 1 },
      textures: { allocatedBytes: 8192, mountedBytes: 4096 },
    });
    expect(nativeShaderValidationSceneProfileSchema.parse(measured)).toEqual(
      measured,
    );
    expect(JSON.stringify(measured)).not.toMatch(/private-source|private WGSL/);
  });

  it("distinguishes unavailable, throwing, invalid, and over-cap telemetry from a measured zero", () => {
    expect(readMountedSceneProfile({})).toMatchObject({
      state: "unavailable",
      code: "profile-unavailable",
    });
    expect(
      readMountedSceneProfile({
        profile: () => {
          throw new Error("device lost");
        },
        previewStatus: () => ({}),
      }),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
    const good = runtime();
    expect(
      readMountedSceneProfile({ ...good, profile: () => ({}) }),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
    expect(
      readMountedSceneProfile({
        ...good,
        profile: () => ({
          ...good.profile(),
          renderWallMs: { ...stats, count: 121 },
        }),
      }),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
    expect(
      readMountedSceneProfile({
        ...good,
        profile: () => ({
          ...good.profile(),
          gpu: {
            kind: "ready",
            frameIndex: 0,
            passCount: 33,
            gpuPassSumMs: 0,
            passes: Array.from({ length: 33 }, () => ({
              label: "pass",
              gpuMs: 0,
            })),
            estimatedResourceBytes: 0,
          },
        }),
      }),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
  });
  it("requires exact target acknowledgement for every GPU state and target-prefixed ready passes", () => {
    const good = runtime();
    for (const gpu of [
      good.profile().gpu,
      { kind: "pending", estimatedResourceBytes: 2048 },
      { kind: "unavailable", code: "timestamp-query-unavailable" },
      { kind: "error", code: "capacity", estimatedResourceBytes: 2048 },
    ]) {
      const selected = {
        ...good,
        profile: (options: { instanceId: string }) => ({
          ...good.profile(),
          gpuTargetInstanceId: options.instanceId,
          gpuScope: "target-mount-command-encoder-not-full-scene",
          gpu:
            gpu.kind === "ready"
              ? {
                  ...gpu,
                  passes: [{ label: "chosen:effect:main", gpuMs: 1.25 }],
                }
              : gpu,
        }),
      };
      expect(
        readMountedSceneProfile(selected, { instanceId: "chosen" }),
      ).toMatchObject({
        state: "available",
        gpuTargetInstanceId: "chosen",
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpu: { kind: gpu.kind },
      });
      expect(
        readMountedSceneProfile(
          {
            ...selected,
            profile: () => ({ ...selected.profile({ instanceId: "other" }) }),
          },
          { instanceId: "chosen" },
        ),
      ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
    }
    expect(
      readMountedSceneProfile(
        {
          ...good,
          profile: () => ({
            ...good.profile(),
            gpuTargetInstanceId: "chosen",
            gpuScope: "target-mount-command-encoder-not-full-scene",
          }),
        },
        { instanceId: "chosen" },
      ),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
    expect(
      readMountedSceneProfile(good, { instanceId: "chosen" }),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
  });
  it("requires a sample strictly newer than the measured-window boundary without replacing a stale sample with zero", () => {
    const good = runtime();
    const selected = {
      ...good,
      profile: () => ({
        ...good.profile(),
        gpuTargetInstanceId: "chosen",
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpu: {
          ...good.profile().gpu,
          passes: [{ label: "chosen:effect:main", gpuMs: 1.25 }],
        },
      }),
    };
    expect(
      readMountedSceneProfile(selected, {
        instanceId: "chosen",
        afterFrameIndex: 8,
      }),
    ).toMatchObject({
      state: "available",
      gpu: { kind: "ready", frameIndex: 9 },
    });
    for (const afterFrameIndex of [9, 10])
      expect(
        readMountedSceneProfile(selected, {
          instanceId: "chosen",
          afterFrameIndex,
        }),
      ).toMatchObject({
        state: "available",
        gpu: {
          kind: "error",
          code: "stale-sample",
          estimatedResourceBytes: 2048,
        },
      });
    expect(
      readMountedSceneProfile(selected, {
        instanceId: "chosen",
        afterFrameIndex: NaN,
      }),
    ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
  });
  it("accepts the full bounded instance plus pass ID instead of truncating its ownership label", () => {
    const good = runtime(),
      id = "i".repeat(64),
      label = `${id}:effect:${"p".repeat(64)}`;
    expect(
      readMountedSceneProfile(
        {
          ...good,
          profile: () => ({
            ...good.profile(),
            gpuTargetInstanceId: id,
            gpuScope: "target-mount-command-encoder-not-full-scene",
            gpu: { ...good.profile().gpu, passes: [{ label, gpuMs: 1.25 }] },
          }),
        },
        { instanceId: id },
      ),
    ).toMatchObject({
      state: "available",
      gpu: { kind: "ready", passes: [{ label, gpuMs: 1.25 }] },
    });
  });
});

describe("completed window upper bound", () => {
  it("reports a newer snapshot outside the measured window rather than using it as in-window telemetry", () => {
    const good = runtime();
    const selected = {
      ...good,
      profile: () => ({
        ...good.profile(),
        gpuTargetInstanceId: "chosen",
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpu: {
          ...good.profile().gpu,
          passes: [{ label: "chosen:main", gpuMs: 1.25 }],
        },
      }),
    };
    expect(
      readMountedSceneProfile(selected, {
        instanceId: "chosen",
        afterFrameIndex: 8,
        throughFrameIndex: 9,
      }),
    ).toMatchObject({
      state: "available",
      gpu: { kind: "ready", frameIndex: 9 },
    });
    expect(
      readMountedSceneProfile(selected, {
        instanceId: "chosen",
        afterFrameIndex: 7,
        throughFrameIndex: 8,
      }),
    ).toMatchObject({
      state: "available",
      gpu: {
        kind: "error",
        code: "outside-window",
        estimatedResourceBytes: 2048,
      },
    });
    for (const bounds of [
      { afterFrameIndex: 8, throughFrameIndex: 7 },
      { throughFrameIndex: 9 },
      { afterFrameIndex: 8, throughFrameIndex: NaN },
    ])
      expect(
        readMountedSceneProfile(selected, { instanceId: "chosen", ...bounds }),
      ).toMatchObject({ state: "unavailable", code: "profile-unreadable" });
  });
});
