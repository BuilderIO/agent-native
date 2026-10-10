import { describe, expect, it } from "vitest";

import { readNativeShaderRuntimeStatus } from "./native-status-bridge";

const ready = {
  type: "native-shader-status",
  schemaVersion: 1,
  runtimeEpoch: "b7c99a08-93df-4e65-aa40-933f43797b0d",
  instanceId: "effect_1",
  nodeId: "frame_1",
  status: "ready",
  backend: "webgpu",
  frames: 5,
  sourceCaptures: 1,
  estimatedResourceBytes: 4096,
  renderWallMs: 2.4,
};

describe("native runtime status transport", () => {
  it("accepts bounded status but rejects source text or unbounded metrics", () => {
    expect(readNativeShaderRuntimeStatus(ready)).toEqual(ready);
    expect(
      readNativeShaderRuntimeStatus({ ...ready, message: "x".repeat(301) }),
    ).toBeNull();
    expect(
      readNativeShaderRuntimeStatus({
        ...ready,
        frames: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
    expect(
      readNativeShaderRuntimeStatus({ ...ready, sourceCaptures: 0.5 }),
    ).toBeNull();
    expect(
      readNativeShaderRuntimeStatus({ ...ready, backend: "unavailable" }),
    ).toBeNull();
    expect(
      readNativeShaderRuntimeStatus({
        ...ready,
        source: "@fragment fn main() {}",
      }),
    ).toEqual(ready);
  });
  it("preserves bounded interactive playback metadata to status consumers", () => {
    const playback = {
      mode: "interactive",
      disposition: "clamped",
      requestedLocalSeconds: 20,
      simulationLocalSeconds: 0.05,
      droppedLocalSeconds: 19.95,
    };
    expect(readNativeShaderRuntimeStatus({ ...ready, playback })).toEqual({
      ...ready,
      playback,
    });
    expect(
      readNativeShaderRuntimeStatus({
        ...ready,
        playback: {
          ...playback,
          disposition: "exact",
          droppedLocalSeconds: 0,
          simulationLocalSeconds: 20,
        },
      })?.playback,
    ).toMatchObject({ disposition: "exact", droppedLocalSeconds: 0 });
  });

  it("rejects malformed or contradictory playback rather than dropping it", () => {
    const playback = {
      mode: "interactive",
      disposition: "clamped",
      requestedLocalSeconds: 20,
      simulationLocalSeconds: 0.05,
      droppedLocalSeconds: 19.95,
    };
    for (const invalid of [
      { ...playback, droppedLocalSeconds: Number.NaN },
      { ...playback, droppedLocalSeconds: -1 },
      { ...playback, disposition: "exact" },
      { ...playback, simulationLocalSeconds: 21 },
      { ...playback, mode: "deterministic" },
      { ...playback, source: "@fragment fn main() {}" },
    ])
      expect(
        readNativeShaderRuntimeStatus({ ...ready, playback: invalid }),
      ).toBeNull();
    expect(
      readNativeShaderRuntimeStatus({
        ...ready,
        status: "last-good",
        playback,
      }),
    ).toBeNull();
    expect(
      readNativeShaderRuntimeStatus({ ...ready, status: "error", playback }),
    ).toBeNull();
  });
});
