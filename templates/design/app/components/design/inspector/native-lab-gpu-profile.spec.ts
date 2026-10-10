import { describe, expect, it } from "vitest";

import { readNativeLabGpuProfile } from "./native-lab-gpu-profile";

describe("Shader Lab GPU profile readout", () => {
  it("keeps a sampled GPU pass sum distinct from CPU wall time", () => {
    expect(
      readNativeLabGpuProfile({
        renderWallMs: { p95: 12 },
        gpu: {
          kind: "ready",
          frameIndex: 120,
          passCount: 2,
          gpuPassSumMs: 3.4,
          passes: [
            { label: "source", gpuMs: 1.1 },
            { label: "effect", gpuMs: 2.3 },
          ],
        },
      }),
    ).toEqual({
      kind: "ready",
      frameIndex: 120,
      passCount: 2,
      gpuPassSumMs: 3.4,
    });
  });

  it("does not turn pending, missing timestamp support, or malformed samples into success", () => {
    expect(
      readNativeLabGpuProfile({
        gpu: { kind: "pending", estimatedResourceBytes: 512 },
      }),
    ).toEqual({ kind: "pending" });
    expect(
      readNativeLabGpuProfile({
        gpu: { kind: "unavailable", code: "timestamp-query-unavailable" },
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      readNativeLabGpuProfile({
        gpu: {
          kind: "ready",
          frameIndex: 8,
          passCount: 1,
          gpuPassSumMs: Number.NaN,
          passes: [{ label: "effect", gpuMs: 2 }],
        },
      }),
    ).toEqual({ kind: "error" });
    expect(readNativeLabGpuProfile({})).toEqual({ kind: "error" });
  });
  it("rejects a different or unacknowledged Shader Lab target in every state", () => {
    const gpuStates = [
      { kind: "pending", estimatedResourceBytes: 0 },
      { kind: "unavailable", code: "target-unavailable" },
      { kind: "error", code: "capacity", estimatedResourceBytes: 0 },
      {
        kind: "ready",
        frameIndex: 1,
        passCount: 1,
        gpuPassSumMs: 1,
        passes: [{ label: "chosen:effect:main", gpuMs: 1 }],
      },
    ];
    for (const gpu of gpuStates) {
      const selected = {
        gpuTargetInstanceId: "chosen",
        gpuScope: "target-mount-command-encoder-not-full-scene",
        gpu,
      };
      expect(readNativeLabGpuProfile(selected, "chosen").kind).toBe(
        gpu.kind === "unavailable" ? "unavailable" : gpu.kind,
      );
      expect(
        readNativeLabGpuProfile(
          { ...selected, gpuTargetInstanceId: "other" },
          "chosen",
        ),
      ).toEqual({ kind: "error" });
      expect(readNativeLabGpuProfile({ gpu }, "chosen")).toEqual({
        kind: "error",
      });
    }
    expect(
      readNativeLabGpuProfile(
        {
          gpuTargetInstanceId: "chosen",
          gpuScope: "target-mount-command-encoder-not-full-scene",
          gpu: {
            ...gpuStates[3],
            passes: [{ label: "other:effect:main", gpuMs: 1 }],
          },
        },
        "chosen",
      ),
    ).toEqual({ kind: "error" });
  });
});
