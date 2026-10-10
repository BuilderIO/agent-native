import { expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { PARTICLE_FLOW_EFFECT } from "./native-effect-particle-flow";
import { hashEffectDefinition } from "./native-effect-trust";
import { validateEffectDocument } from "./native-effects";

it("plans bounded particle state, instanced draw, and persistent trail in execution order", async () => {
  expect(
    validateEffectDocument({
      schemaVersion: 2,
      definitions: [PARTICLE_FLOW_EFFECT],
      instances: [],
    }).errors,
  ).toEqual([]);
  const plan = planEffectGraph(PARTICLE_FLOW_EFFECT);
  expect(plan.errors).toEqual([]);
  expect(plan.passes.map((pass) => pass.id)).toEqual([
    "advance",
    "particles",
    "trail",
  ]);
  expect(PARTICLE_FLOW_EFFECT.simulation?.count.tiers).toEqual({
    low: 10000,
    medium: 25000,
    high: 50000,
  });
  expect(
    PARTICLE_FLOW_EFFECT.resources?.find(
      (resource) => resource.name === "state",
    ),
  ).toMatchObject({ byteLength: 1_600_000, persistent: true });
  const hash = await hashEffectDefinition(PARTICLE_FLOW_EFFECT);
  const changed = structuredClone(PARTICLE_FLOW_EFFECT);
  changed.simulation!.maxInteractiveSteps = 7 as 8;
  expect(await hashEffectDefinition(changed)).not.toBe(hash);
});
