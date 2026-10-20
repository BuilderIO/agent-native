import { describe, expect, it } from "vitest";

import {
  type LayerStateOverrides,
  reconcileLayerStateIds,
  scopedLayerStateId,
  type SourceLayerStateIds,
} from "./layer-state-scope";

function builtState(
  fileId: string,
  layerIds: string[],
  hiddenLayerIds: string[] = [],
): SourceLayerStateIds {
  return {
    locked: [],
    hidden: hiddenLayerIds.map((id) => scopedLayerStateId(fileId, id)),
    all: new Set(layerIds.map((id) => scopedLayerStateId(fileId, id))),
  };
}

describe("reconcileLayerStateIds", () => {
  it("keeps a hidden layer of a screen whose layer model is not built", () => {
    const hiddenLayer = scopedLayerStateId("screen-a", "card");
    const overrides: LayerStateOverrides = new Map([
      [hiddenLayer, { hidden: true }],
    ]);

    const next = reconcileLayerStateIds({
      current: new Set([hiddenLayer]),
      kind: "hidden",
      liveFileIds: new Set(["screen-a", "screen-b"]),
      builtStateByFileId: new Map([
        ["screen-b", builtState("screen-b", ["title"])],
      ]),
      overrides,
    });

    expect(next.has(hiddenLayer)).toBe(true);
    expect(overrides.get(hiddenLayer)).toEqual({ hidden: true });
  });

  it("drops the override of a layer its built screen no longer has", () => {
    const removedLayer = scopedLayerStateId("screen-a", "gone");
    const overrides: LayerStateOverrides = new Map([
      [removedLayer, { hidden: true }],
    ]);

    const next = reconcileLayerStateIds({
      current: new Set([removedLayer]),
      kind: "hidden",
      liveFileIds: new Set(["screen-a"]),
      builtStateByFileId: new Map([
        ["screen-a", builtState("screen-a", ["title"])],
      ]),
      overrides,
    });

    expect(next.has(removedLayer)).toBe(false);
    expect(overrides.has(removedLayer)).toBe(false);
  });

  it("drops the state of a deleted screen", () => {
    const layer = scopedLayerStateId("deleted", "card");
    const overrides: LayerStateOverrides = new Map([[layer, { hidden: true }]]);

    const next = reconcileLayerStateIds({
      current: new Set([layer, "deleted"]),
      kind: "hidden",
      liveFileIds: new Set(["screen-a"]),
      builtStateByFileId: new Map(),
      overrides,
    });

    expect([...next]).toEqual([]);
    expect(overrides.size).toBe(0);
  });

  it("clears an override once the source agrees with it", () => {
    const layer = scopedLayerStateId("screen-a", "card");
    const overrides: LayerStateOverrides = new Map([[layer, { hidden: true }]]);

    const next = reconcileLayerStateIds({
      current: new Set([layer]),
      kind: "hidden",
      liveFileIds: new Set(["screen-a"]),
      builtStateByFileId: new Map([
        ["screen-a", builtState("screen-a", ["card"], ["card"])],
      ]),
      overrides,
    });

    expect(next.has(layer)).toBe(true);
    expect(overrides.has(layer)).toBe(false);
  });
});
