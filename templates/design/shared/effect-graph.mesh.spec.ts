import { describe, expect, it } from "vitest";

import { planEffectGraph, type EffectMeshSpec } from "./effect-graph";
import { FOLDED_MESH_EFFECT } from "./native-effect-folded-mesh";
import { hashEffectDefinition } from "./native-effect-trust";
import { validateEffectDocument, type EffectDocument } from "./native-effects";

const document = (mesh: unknown): EffectDocument => ({
  schemaVersion: 2 as const,
  definitions: [
    {
      ...FOLDED_MESH_EFFECT,
      passes: [
        { ...FOLDED_MESH_EFFECT.passes[0], mesh: mesh as EffectMeshSpec },
      ],
    },
  ],
  instances: [],
});

describe("native mesh pass contract", () => {
  it("binds mesh topology to the execution hash", async () => {
    const original = FOLDED_MESH_EFFECT;
    const changed = document({ columns: 64, rows: 96 }).definitions[0];
    expect(await hashEffectDefinition(changed)).not.toBe(
      await hashEffectDefinition(original),
    );
  });

  it("rejects malformed and excessive grids at both document and graph boundaries", () => {
    for (const mesh of [
      { columns: 256, rows: 256 },
      { columns: 128.5, rows: 96 },
      { columns: 128, rows: 96, extra: true },
    ]) {
      const candidate = document(mesh);
      expect(validateEffectDocument(candidate).errors.length).toBeGreaterThan(
        0,
      );
      expect(
        planEffectGraph(candidate.definitions[0]).errors.length,
      ).toBeGreaterThan(0);
    }
  });

  it("rejects mesh metadata on a draw pass", () => {
    const candidate = document({ columns: 16, rows: 16 });
    candidate.definitions[0].passes[0].draw = {
      vertices: 6,
      instances: "simulation-count",
    };
    expect(validateEffectDocument(candidate).errors.length).toBeGreaterThan(0);
    expect(
      planEffectGraph(candidate.definitions[0]).errors.length,
    ).toBeGreaterThan(0);
  });
});
