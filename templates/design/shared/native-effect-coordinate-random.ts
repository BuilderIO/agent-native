import type { EffectDefinition } from "./native-effects";

export const DESIGN_COORDINATE_RANDOM_WGSL = `
fn designRotateCoordinateWord(word: u32, amount: u32) -> u32 {
  return (word << amount) | (word >> (32u - amount));
}
fn designCoordinateRandom(point: vec2f, seed: f32) -> f32 {
  let seedWord = bitcast<u32>(seed);
  let xWord = select(bitcast<u32>(point.x), 0u, point.x == 0.0);
  let yWord = select(bitcast<u32>(point.y), 0u, point.y == 0.0);
  var left = xWord ^ seedWord;
  var right = yWord ^ designRotateCoordinateWord(seedWord ^ 3548017577u, 7u);
  for (var round = 0u; round < 4u; round += 1u) {
    left = designRotateCoordinateWord(left ^ right, 9u) * 3242932741u + 1084941432u + round;
    right = designRotateCoordinateWord(right + left, 17u) * 1755960021u + 736866279u;
  }
  let word = left ^ designRotateCoordinateWord(right, 13u);
  return f32(word >> 8u) / 16777216.0;
}
`;

type CoordinateRandomRewriteCode =
  | "definition-shape"
  | "pass-identity"
  | "helper-identity"
  | "helper-collision";

export class CoordinateRandomRewriteError extends Error {
  constructor(readonly code: CoordinateRandomRewriteCode) {
    super(`Coordinate random successor rejected: ${code}`);
    this.name = "CoordinateRandomRewriteError";
  }
}

export function createCoordinateRandomSuccessor(
  definition: EffectDefinition,
  passId: string,
  functionName: "hash" | "ownedHash",
): EffectDefinition {
  if (!Number.isSafeInteger(definition.version) || definition.version < 1)
    throw new CoordinateRandomRewriteError("definition-shape");
  const passes = definition.passes.filter((pass) => pass.id === passId);
  const [pass] = passes;
  if (passes.length !== 1 || !pass || pass.kind !== "render")
    throw new CoordinateRandomRewriteError("pass-identity");
  if (
    /\bfn\s+design(?:RotateCoordinateWord|CoordinateRandom)\b/.test(pass.wgsl)
  )
    throw new CoordinateRandomRewriteError("helper-collision");
  const helpers = [
    ...pass.wgsl.matchAll(
      /\bfn\s+(hash|ownedHash)\s*\(\s*\w+\s*:\s*vec2f\s*\)\s*->\s*f32\s*\{[^{}]*\}/g,
    ),
  ].filter((match) => match[1] === functionName);
  const [helper] = helpers;
  if (helpers.length !== 1 || !helper || typeof helper.index !== "number")
    throw new CoordinateRandomRewriteError("helper-identity");
  const wrapper = `${DESIGN_COORDINATE_RANDOM_WGSL}
fn ${functionName}(point: vec2f) -> f32 {
  return designCoordinateRandom(point, globals.clock.y);
}`;
  const wgsl =
    pass.wgsl.slice(0, helper.index) +
    wrapper +
    pass.wgsl.slice(helper.index + helper[0].length);
  const nextVersion = definition.version + 1;
  if (!Number.isSafeInteger(nextVersion))
    throw new CoordinateRandomRewriteError("definition-shape");
  return {
    ...structuredClone(definition),
    version: nextVersion,
    passes: definition.passes.map((source) => ({
      ...structuredClone(source),
      ...(source.id === passId ? { wgsl } : {}),
    })),
  };
}
